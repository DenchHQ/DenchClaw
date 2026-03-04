import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import NodeWebSocket from "ws";
import {
	getEffectiveProfile,
	resolveActiveAgentId,
	resolveOpenClawStateDir,
	resolveWorkspaceRoot,
} from "./workspace";

export type AgentEvent = {
	event: string;
	runId?: string;
	stream?: string;
	data?: Record<string, unknown>;
	seq?: number;
	globalSeq?: number;
	ts?: number;
	sessionKey?: string;
	status?: string;
	result?: {
		payloads?: Array<{ text?: string; mediaUrl?: string | null }>;
		meta?: Record<string, unknown>;
	};
};

/** Extracted text + details from a tool result event. */
export type ToolResult = {
	text?: string;
	details?: Record<string, unknown>;
};

export type AgentCallback = {
	onTextDelta: (delta: string) => void;
	onThinkingDelta: (delta: string) => void;
	onToolStart: (
		toolCallId: string,
		toolName: string,
		args?: Record<string, unknown>,
	) => void;
	onToolEnd: (
		toolCallId: string,
		toolName: string,
		isError: boolean,
		result?: ToolResult,
	) => void;
	/** Called when the agent run is picked up and starts executing. */
	onLifecycleStart?: () => void;
	onLifecycleEnd: () => void;
	/** Called when session auto-compaction begins. */
	onCompactionStart?: () => void;
	/** Called when session auto-compaction finishes. */
	onCompactionEnd?: (willRetry: boolean) => void;
	/** Called when a running tool emits a progress update. */
	onToolUpdate?: (
		toolCallId: string,
		toolName: string,
	) => void;
	onError: (error: Error) => void;
	onClose: (code: number | null) => void;
	/** Called when the agent encounters an API or runtime error (402, rate limit, etc.) */
	onAgentError?: (message: string) => void;
};

/**
 * Extract text content from the agent's tool result object.
 * The result has `content: Array<{ type: "text", text: string } | ...>` and
 * optional `details` (exit codes, file paths, etc.).
 *
 * Falls back gracefully when the result doesn't follow the standard wrapper:
 * - If no `content` array, tries to use the raw object as details directly.
 * - If the raw value is a string, treats it as text.
 */
export function extractToolResult(
	raw: unknown,
): ToolResult | undefined {
	if (!raw) {return undefined;}
	// String result — treat the whole thing as text
	if (typeof raw === "string") {return { text: raw, details: undefined };}
	if (typeof raw !== "object") {return undefined;}
	const r = raw as Record<string, unknown>;

	// Extract text from content blocks
	const content = Array.isArray(r.content) ? r.content : [];
	const textParts: string[] = [];
	for (const block of content) {
		if (
			block &&
			typeof block === "object" &&
			(block as Record<string, unknown>).type === "text" &&
			typeof (block as Record<string, unknown>).text === "string"
		) {
			textParts.push((block as Record<string, unknown>).text as string);
		}
	}

	const text = textParts.length > 0 ? textParts.join("\n") : undefined;
	const details =
		r.details && typeof r.details === "object"
			? (r.details as Record<string, unknown>)
			: undefined;

	// Fallback: if neither content nor details were found, the raw object
	// might BE the tool payload itself (e.g. { query, results, url, ... }).
	// Use it as details so buildToolOutput can extract web tool fields.
	if (!text && !details && !Array.isArray(r.content)) {
		return { text: undefined, details: r };
	}

	return { text, details };
}

export type RunAgentOptions = {
	/** When set, the agent runs in an isolated web chat session. */
	sessionId?: string;
};

export type AgentProcessHandle = {
	stdout: NodeJS.ReadableStream | null;
	stderr: NodeJS.ReadableStream | null;
	kill: (signal?: NodeJS.Signals | number) => boolean;
	on: {
		(
			event: "close",
			listener: (code: number | null, signal: NodeJS.Signals | null) => void,
		): AgentProcessHandle;
		(event: string, listener: (...args: unknown[]) => void): AgentProcessHandle;
	};
	once: {
		(
			event: "close",
			listener: (code: number | null, signal: NodeJS.Signals | null) => void,
		): AgentProcessHandle;
		(event: string, listener: (...args: unknown[]) => void): AgentProcessHandle;
	};
};

type GatewayReqFrame = {
	type: "req";
	id: string;
	method: string;
	params?: unknown;
};

type GatewayResFrame = {
	type: "res";
	id: string;
	ok: boolean;
	payload?: unknown;
	error?: unknown;
};

type GatewayEventFrame = {
	type: "event";
	event: string;
	seq?: number;
	payload?: unknown;
};

type GatewayFrame =
	| GatewayReqFrame
	| GatewayResFrame
	| GatewayEventFrame
	| { type?: string; [key: string]: unknown };

type GatewayConnectionSettings = {
	url: string;
	token?: string;
	password?: string;
};

type PendingGatewayRequest = {
	resolve: (value: GatewayResFrame) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
};

type SpawnGatewayProcessParams = {
	mode: "start" | "subscribe";
	message?: string;
	sessionKey?: string;
	afterSeq: number;
	lane?: string;
};

type BuildConnectParamsOptions = {
	clientMode?: "webchat" | "backend" | "cli" | "ui" | "node" | "probe" | "test";
	caps?: string[];
};

const DEFAULT_GATEWAY_PORT = 18_789;
const OPEN_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_GATEWAY_CLIENT_CAPS = ["tool-events"];
const SESSIONS_PATCH_RETRY_DELAY_MS = 150;
const SESSIONS_PATCH_MAX_ATTEMPTS = 2;

type AgentSubscribeSupport = "unknown" | "supported" | "unsupported";
let cachedAgentSubscribeSupport: AgentSubscribeSupport = "unknown";

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(raw) as unknown;
		return asRecord(parsed);
	} catch {
		return null;
	}
}

function parsePort(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return undefined;
}

function normalizeWsUrl(raw: string, fallbackPort: number): string {
	const withScheme = raw.includes("://") ? raw : `ws://${raw}`;
	const url = new URL(withScheme);
	if (url.protocol === "http:") {
		url.protocol = "ws:";
	} else if (url.protocol === "https:") {
		url.protocol = "wss:";
	}
	if (!url.port) {
		url.port = url.protocol === "wss:" ? "443" : String(fallbackPort);
	}
	return url.toString();
}

function readGatewayConfigFromStateDir(
	stateDir: string,
): Record<string, unknown> | null {
	const candidates = [join(stateDir, "openclaw.json"), join(stateDir, "config.json")];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) {
			continue;
		}
		try {
			const parsed = parseJsonObject(readFileSync(candidate, "utf-8"));
			if (parsed) {
				return parsed;
			}
		} catch {
			// Ignore malformed config and continue to fallback behavior.
		}
	}
	return null;
}

function resolveGatewayConnectionSettings(): GatewayConnectionSettings {
	const envUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
	const envToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
	const envPassword = process.env.OPENCLAW_GATEWAY_PASSWORD?.trim();
	const envPort = parsePort(process.env.OPENCLAW_GATEWAY_PORT);

	const stateDir = resolveOpenClawStateDir();
	const config = readGatewayConfigFromStateDir(stateDir);
	const gateway = asRecord(config?.gateway);
	const remote = asRecord(gateway?.remote);
	const auth = asRecord(gateway?.auth);

	const gatewayPort = envPort ?? parsePort(gateway?.port) ?? DEFAULT_GATEWAY_PORT;
	const gatewayMode =
		typeof gateway?.mode === "string" ? gateway.mode.trim().toLowerCase() : "";
	const remoteUrl =
		typeof remote?.url === "string" ? remote.url.trim() : undefined;
	const useRemote = !envUrl && gatewayMode === "remote" && Boolean(remoteUrl);

	const rawUrl = envUrl || (useRemote ? remoteUrl! : `ws://127.0.0.1:${gatewayPort}`);
	const url = normalizeWsUrl(rawUrl, gatewayPort);

	const token =
		envToken ||
		(useRemote && typeof remote?.token === "string"
			? remote.token.trim()
			: undefined) ||
		(typeof auth?.token === "string" ? auth.token.trim() : undefined);

	const password =
		envPassword ||
		(useRemote && typeof remote?.password === "string"
			? remote.password.trim()
			: undefined) ||
		(typeof auth?.password === "string" ? auth.password.trim() : undefined);

	return { url, token, password };
}

export function buildConnectParams(
	settings: GatewayConnectionSettings,
	options?: BuildConnectParamsOptions,
): Record<string, unknown> {
	const optionCaps = options?.caps;
	const caps = Array.isArray(optionCaps)
		? optionCaps.filter(
				(cap): cap is string => typeof cap === "string" && cap.trim().length > 0,
			)
		: DEFAULT_GATEWAY_CLIENT_CAPS;
	const clientMode = options?.clientMode ?? "backend";
	const auth =
		settings.token || settings.password
			? {
					...(settings.token ? { token: settings.token } : {}),
					...(settings.password ? { password: settings.password } : {}),
				}
			: undefined;

	return {
		minProtocol: 3,
		maxProtocol: 3,
		client: {
			id: "gateway-client",
			version: "dev",
			platform: process.platform,
			mode: clientMode,
			instanceId: "ironclaw-web-server",
		},
		locale: "en-US",
		userAgent: "ironclaw-web",
		role: "operator",
		scopes: ["operator.read", "operator.write", "operator.admin"],
		caps,
		...(auth ? { auth } : {}),
	};
}

function frameErrorMessage(frame: GatewayResFrame): string {
	const error = asRecord(frame.error);
	if (typeof error?.message === "string" && error.message.trim()) {
		return error.message;
	}
	if (typeof frame.error === "string" && frame.error.trim()) {
		return frame.error;
	}
	return "Gateway request failed";
}

function isUnknownMethodResponse(
	frame: GatewayResFrame,
	methodName: string,
): boolean {
	const message = frameErrorMessage(frame).trim().toLowerCase();
	if (!message.includes("unknown method")) {
		return false;
	}
	return message.includes(methodName.toLowerCase());
}

function isRetryableGatewayMessage(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	return (
		normalized.includes("timeout") ||
		normalized.includes("timed out") ||
		normalized.includes("temporar") ||
		normalized.includes("unavailable") ||
		normalized.includes("try again") ||
		normalized.includes("connection closed") ||
		normalized.includes("connection reset")
	);
}

function toMessageText(data: unknown): string | null {
	if (typeof data === "string") {
		return data;
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString("utf-8");
	}
	if (ArrayBuffer.isView(data)) {
		return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
			"utf-8",
		);
	}
	return null;
}

class GatewayWsClient {
	private ws: NodeWebSocket | null = null;
	private pending = new Map<string, PendingGatewayRequest>();
	private closed = false;

	constructor(
		private readonly settings: GatewayConnectionSettings,
		private readonly onEvent: (frame: GatewayEventFrame) => void,
		private readonly onClose: (code: number, reason: string) => void,
	) {}

	async open(timeoutMs = OPEN_TIMEOUT_MS): Promise<void> {
		if (this.ws) {
			return;
		}
		const gatewayOrigin = this.settings.url
			.replace(/^ws:/, "http:")
			.replace(/^wss:/, "https:");
		const ws = new NodeWebSocket(this.settings.url, {
			headers: { Origin: gatewayOrigin },
		});
		this.ws = ws;

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) {
					return;
				}
				settled = true;
				reject(new Error("Gateway WebSocket open timeout"));
			}, timeoutMs);

			const onOpen = () => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				resolve();
			};

			const onError = () => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				reject(new Error("Gateway WebSocket connection failed"));
			};

			ws.once("open", onOpen);
			ws.once("error", onError);
		});

		ws.on("message", (data: NodeWebSocket.RawData) => {
			const text = toMessageText(data);
			if (text != null) {
				this.handleMessageText(text);
			}
		});

		ws.on("close", (code: number, reason: Buffer) => {
			if (this.closed) {
				return;
			}
			this.closed = true;
			this.flushPending(new Error("Gateway connection closed"));
			this.onClose(code, reason.toString("utf-8"));
		});
	}

	request(
		method: string,
		params?: unknown,
		timeoutMs = REQUEST_TIMEOUT_MS,
	): Promise<GatewayResFrame> {
		const ws = this.ws;
		if (!ws || ws.readyState !== NodeWebSocket.OPEN) {
			return Promise.reject(new Error("Gateway WebSocket is not connected"));
		}

		return new Promise<GatewayResFrame>((resolve, reject) => {
			const id = randomUUID();
			const frame: GatewayReqFrame = { type: "req", id, method, params };
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Gateway request timed out (${method})`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timeout });
			ws.send(JSON.stringify(frame));
		});
	}

	close(code?: number, reason?: string): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.flushPending(new Error("Gateway connection closed"));
		try {
			this.ws?.close(code, reason);
		} catch {
			// Ignore socket close failures.
		}
	}

	private flushPending(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pending.clear();
	}

	private handleMessageText(text: string): void {
		let frame: GatewayFrame | null = null;
		try {
			frame = JSON.parse(text) as GatewayFrame;
		} catch {
			return;
		}
		if (!frame || typeof frame !== "object" || !("type" in frame)) {
			return;
		}

		if (frame.type === "res") {
			const response = frame as GatewayResFrame;
			const pending = this.pending.get(response.id);
			if (!pending) {
				return;
			}
			this.pending.delete(response.id);
			clearTimeout(pending.timeout);
			pending.resolve(response);
			return;
		}

		if (frame.type === "event") {
			this.onEvent(frame as GatewayEventFrame);
		}
	}
}

class GatewayProcessHandle
	extends EventEmitter
	implements AgentProcessHandle
{
	public readonly stdout: NodeJS.ReadableStream | null = new PassThrough();
	public readonly stderr: NodeJS.ReadableStream | null = new PassThrough();
	private client: GatewayWsClient | null = null;
	private finished = false;
	private closeScheduled = false;
	private requestedClose = false;
	private runId: string | null = null;

	constructor(private readonly params: SpawnGatewayProcessParams) {
		super();
		void this.start();
	}

	kill(signal?: NodeJS.Signals | number): boolean {
		if (this.finished) {
			return false;
		}
		this.requestedClose = true;
		this.client?.close();
		const closeSignal = typeof signal === "string" ? signal : null;
		this.finish(0, closeSignal);
		return true;
	}

	private async start(): Promise<void> {
		try {
			const settings = resolveGatewayConnectionSettings();
			this.client = new GatewayWsClient(
				settings,
				(frame) => this.handleGatewayEvent(frame),
				(code, reason) => this.handleSocketClose(code, reason),
			);
			await this.client.open();
			const connectRes = await this.client.request(
				"connect",
				buildConnectParams(settings),
			);
			if (!connectRes.ok) {
				throw new Error(frameErrorMessage(connectRes));
			}

			if (this.params.sessionKey) {
				await this.ensureFullToolVerbose(this.params.sessionKey);
			}

			if (this.params.mode === "start") {
				const sessionKey = this.params.sessionKey;
				const startRes = await this.client.request("agent", {
					message: this.params.message ?? "",
					idempotencyKey: randomUUID(),
					...(sessionKey ? { sessionKey } : {}),
					deliver: false,
					channel: "webchat",
					lane: this.params.lane ?? "web",
					timeout: 0,
				});
				if (!startRes.ok) {
					throw new Error(frameErrorMessage(startRes));
				}
				const payload = asRecord(startRes.payload);
				const runId =
					payload && typeof payload.runId === "string" ? payload.runId : null;
				this.runId = runId;
			} else {
				const sessionKey = this.params.sessionKey;
				if (!sessionKey) {
					throw new Error("Missing session key for subscribe mode");
				}
				if (cachedAgentSubscribeSupport !== "unsupported") {
					const subscribeRes = await this.client.request("agent.subscribe", {
						sessionKey,
						afterSeq: Math.max(
							0,
							Number.isFinite(this.params.afterSeq) ? this.params.afterSeq : 0,
						),
					});
					if (!subscribeRes.ok) {
						if (isUnknownMethodResponse(subscribeRes, "agent.subscribe")) {
							cachedAgentSubscribeSupport = "unsupported";
							(this.stderr as PassThrough).write(
								"[gateway] agent.subscribe unavailable; using passive session filter mode\n",
							);
						} else {
							throw new Error(frameErrorMessage(subscribeRes));
						}
					} else {
						cachedAgentSubscribeSupport = "supported";
					}
				}
			}
		} catch (error) {
			const err =
				error instanceof Error ? error : new Error(String(error));
			(this.stderr as PassThrough).write(`${err.message}\n`);
			this.emit("error", err);
			this.finish(1, null);
		}
	}

	private async ensureFullToolVerbose(sessionKey: string): Promise<void> {
		if (!this.client || !sessionKey.trim()) {
			return;
		}
		let attempt = 0;
		let lastMessage = "";
		while (attempt < SESSIONS_PATCH_MAX_ATTEMPTS) {
			attempt += 1;
			try {
				const patch = await this.client.request("sessions.patch", {
					key: sessionKey,
					verboseLevel: "full",
					reasoningLevel: "on",
				});
				if (patch.ok) {
					return;
				}
				lastMessage = frameErrorMessage(patch);
				if (
					attempt >= SESSIONS_PATCH_MAX_ATTEMPTS ||
					!isRetryableGatewayMessage(lastMessage)
				) {
					break;
				}
			} catch (error) {
				lastMessage =
					error instanceof Error ? error.message : String(error);
				if (
					attempt >= SESSIONS_PATCH_MAX_ATTEMPTS ||
					!isRetryableGatewayMessage(lastMessage)
				) {
					break;
				}
			}
			await new Promise((resolve) =>
				setTimeout(resolve, SESSIONS_PATCH_RETRY_DELAY_MS),
			);
		}
		if (lastMessage.trim()) {
			(this.stderr as PassThrough).write(
				`[gateway] sessions.patch verboseLevel=full failed: ${lastMessage}\n`,
			);
		}
	}

	private shouldAcceptSessionEvent(sessionKey: string | undefined): boolean {
		const expected = this.params.sessionKey;
		if (!expected) {
			return true;
		}
		if (this.params.mode === "subscribe") {
			// Subscribe mode should only accept explicit events for the target session.
			return sessionKey === expected;
		}
		if (!sessionKey) {
			return true;
		}
		return sessionKey === expected;
	}

	private handleGatewayEvent(frame: GatewayEventFrame): void {
		if (this.finished) {
			return;
		}
		if (frame.event === "connect.challenge") {
			return;
		}

		if (frame.event === "agent") {
			const payload = asRecord(frame.payload);
			if (!payload) {
				return;
			}
			const sessionKey =
				typeof payload.sessionKey === "string" ? payload.sessionKey : undefined;
			if (!this.shouldAcceptSessionEvent(sessionKey)) {
				return;
			}
			const runId = typeof payload.runId === "string" ? payload.runId : undefined;
			if (this.runId && runId && runId !== this.runId) {
				return;
			}
			const payloadGlobalSeq =
				typeof payload.globalSeq === "number" ? payload.globalSeq : undefined;
			const eventGlobalSeq =
				payloadGlobalSeq ??
				(typeof frame.seq === "number" ? frame.seq : undefined);
			if (
				typeof eventGlobalSeq === "number" &&
				eventGlobalSeq <= this.params.afterSeq
			) {
				return;
			}

			const event: AgentEvent = {
				event: "agent",
				...(runId ? { runId } : {}),
				...(typeof payload.stream === "string" ? { stream: payload.stream } : {}),
				...(asRecord(payload.data) ? { data: payload.data as Record<string, unknown> } : {}),
				...(typeof payload.seq === "number" ? { seq: payload.seq } : {}),
				...(typeof eventGlobalSeq === "number"
					? { globalSeq: eventGlobalSeq }
					: {}),
				...(typeof payload.ts === "number" ? { ts: payload.ts } : {}),
				...(sessionKey ? { sessionKey } : {}),
			};

			(this.stdout as PassThrough).write(`${JSON.stringify(event)}\n`);

			const stream = typeof payload.stream === "string" ? payload.stream : "";
			const data = asRecord(payload.data);
			const phase = data && typeof data.phase === "string" ? data.phase : "";
			if (
				this.params.mode === "start" &&
				stream === "lifecycle" &&
				(phase === "end" || phase === "error")
			) {
				this.scheduleClose();
			}
			return;
		}

		if (frame.event === "error") {
			const payload = asRecord(frame.payload) ?? {};
			const sessionKey =
				typeof payload.sessionKey === "string" ? payload.sessionKey : undefined;
			if (!this.shouldAcceptSessionEvent(sessionKey)) {
				return;
			}
			const payloadGlobalSeq =
				typeof payload.globalSeq === "number" ? payload.globalSeq : undefined;
			const eventGlobalSeq =
				payloadGlobalSeq ??
				(typeof frame.seq === "number" ? frame.seq : undefined);
			const event: AgentEvent = {
				event: "error",
				data: payload,
				...(typeof eventGlobalSeq === "number"
					? { globalSeq: eventGlobalSeq }
					: {}),
				...(sessionKey ? { sessionKey } : {}),
			};
			(this.stdout as PassThrough).write(`${JSON.stringify(event)}\n`);
			if (this.params.mode === "start") {
				this.scheduleClose();
			}
		}
	}

	private scheduleClose(): void {
		if (this.closeScheduled || this.finished) {
			return;
		}
		this.closeScheduled = true;
		setTimeout(() => {
			if (this.finished) {
				return;
			}
			this.requestedClose = true;
			this.client?.close();
			this.finish(0, null);
		}, 25);
	}

	private handleSocketClose(code: number, reason: string): void {
		if (this.finished) {
			return;
		}
		if (!this.requestedClose) {
			const detail = reason.trim() || `code ${code}`;
			(this.stderr as PassThrough).write(`Gateway connection closed: ${detail}\n`);
		}
		const exitCode = this.requestedClose || code === 1000 || code === 1005 ? 0 : 1;
		this.finish(exitCode, null);
	}

	private finish(code: number | null, signal: NodeJS.Signals | null): void {
		if (this.finished) {
			return;
		}
		this.finished = true;
		try {
			(this.stdout as PassThrough).end();
			(this.stderr as PassThrough).end();
		} catch {
			// Ignore stream close errors.
		}
		this.emit("close", code, signal);
	}
}

function shouldForceLegacyStream(): boolean {
	const raw = process.env.IRONCLAW_WEB_FORCE_LEGACY_STREAM?.trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes";
}

export async function callGatewayRpc(
	method: string,
	params?: Record<string, unknown>,
	options?: { timeoutMs?: number },
): Promise<GatewayResFrame> {
	const settings = resolveGatewayConnectionSettings();
	let closed = false;
	const client = new GatewayWsClient(settings, () => {}, () => {
		closed = true;
	});
	await client.open();
	try {
		const connect = await client.request(
			"connect",
			buildConnectParams(settings),
			options?.timeoutMs ?? REQUEST_TIMEOUT_MS,
		);
		if (!connect.ok) {
			throw new Error(frameErrorMessage(connect));
		}
		const result = await client.request(
			method,
			params,
			options?.timeoutMs ?? REQUEST_TIMEOUT_MS,
		);
		return result;
	} finally {
		if (!closed) {
			client.close();
		}
	}
}

/**
 * Spawn an agent child process and return the ChildProcess handle.
 * Shared between `runAgent` (legacy callback API) and the ActiveRunManager.
 */
export function spawnAgentProcess(
	message: string,
	agentSessionId?: string,
): AgentProcessHandle {
	if (shouldForceLegacyStream()) {
		return spawnLegacyAgentProcess(message, agentSessionId);
	}
	const agentId = resolveActiveAgentId();
	const sessionKey = agentSessionId
		? `agent:${agentId}:web:${agentSessionId}`
		: undefined;
	return new GatewayProcessHandle({
		mode: "start",
		message,
		sessionKey,
		afterSeq: 0,
	});
}

function spawnLegacyAgentProcess(
	message: string,
	agentSessionId?: string,
): ReturnType<typeof spawn> {
	return spawnCliAgentProcess(message, agentSessionId);
}

function spawnCliAgentProcess(
	message: string,
	agentSessionId?: string,
): ReturnType<typeof spawn> {
	const cliAgentId = resolveActiveAgentId();
	const args = [
		"agent",
		"--agent",
		cliAgentId,
		"--message",
		message,
		"--stream-json",
	];

	if (agentSessionId) {
		const sessionKey = `agent:${cliAgentId}:web:${agentSessionId}`;
		args.push("--session-key", sessionKey, "--lane", "web", "--channel", "webchat");
	}

	const profile = getEffectiveProfile();
	const workspace = resolveWorkspaceRoot();
	return spawn("openclaw", args, {
		env: {
			...process.env,
			...(profile ? { OPENCLAW_PROFILE: profile } : {}),
			...(workspace ? { OPENCLAW_WORKSPACE: workspace } : {}),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/**
 * Spawn a subscribe-only agent child process that tails a session key's events.
 * Uses the same runtime/env wiring as spawnAgentProcess.
 */
export function spawnAgentSubscribeProcess(
	sessionKey: string,
	afterSeq = 0,
): AgentProcessHandle {
	if (shouldForceLegacyStream()) {
		return spawnLegacyAgentSubscribeProcess(sessionKey, afterSeq);
	}
	return new GatewayProcessHandle({
		mode: "subscribe",
		sessionKey,
		afterSeq: Math.max(0, Number.isFinite(afterSeq) ? afterSeq : 0),
	});
}

/**
 * Spawn a start-mode agent process for a subagent follow-up message.
 * Uses the `agent` RPC which receives ALL events (including tool events)
 * on the same WebSocket connection, unlike passive subscribe mode.
 */
export function spawnAgentStartForSession(
	message: string,
	sessionKey: string,
): AgentProcessHandle {
	return new GatewayProcessHandle({
		mode: "start",
		message,
		sessionKey,
		afterSeq: 0,
		lane: "subagent",
	});
}

function spawnLegacyAgentSubscribeProcess(
	sessionKey: string,
	afterSeq = 0,
): ReturnType<typeof spawn> {
	const args = [
		"agent",
		"--stream-json",
		"--subscribe-session-key",
		sessionKey,
		"--after-seq",
		String(Math.max(0, Number.isFinite(afterSeq) ? afterSeq : 0)),
	];

	const profile = getEffectiveProfile();
	const workspace = resolveWorkspaceRoot();
	return spawn("openclaw", args, {
		env: {
			...process.env,
			...(profile ? { OPENCLAW_PROFILE: profile } : {}),
			...(workspace ? { OPENCLAW_WORKSPACE: workspace } : {}),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/**
 * Build a flat output object from the agent's tool result so the frontend
 * can render tool output text, exit codes, etc.
 *
 * Passes through ALL details fields — no whitelist filtering so the UI gets
 * the full picture (exit codes, file paths, search results, diffs, etc.).
 */
export function buildToolOutput(
	result?: ToolResult,
): Record<string, unknown> {
	if (!result) {return {};}
	const out: Record<string, unknown> = {};
	if (result.text) {out.text = result.text;}
	if (result.details) {
		// Pass through all details keys — don't filter so nothing is lost
		for (const [key, value] of Object.entries(result.details)) {
			if (value !== undefined) {out[key] = value;}
		}
	}
	// If we have details but no text, synthesize a text field from the JSON so
	// domain-extraction regex in the frontend can find URLs from search results.
	if (!out.text && result.details) {
		try {
			const json = JSON.stringify(result.details);
			if (json.length <= 50_000) {
				out.text = json;
			}
		} catch {
			/* ignore */
		}
	}
	return out;
}

/**
 * Spawn the openclaw agent and stream its output.
 * Pass an AbortSignal to kill the child process when the caller cancels.
 *
 * When `options.sessionId` is set the child process gets `--session-id <id>`,
 * which creates an isolated agent session that won't interfere with the main
 * agent or other sidebar chats.
 */
export async function runAgent(
	message: string,
	signal: AbortSignal | undefined,
	callback: AgentCallback,
	options?: RunAgentOptions,
): Promise<void> {
	return new Promise<void>((resolve) => {
		const child = spawnAgentProcess(message, options?.sessionId);

		// Kill the child process if the caller aborts (e.g. user hit stop).
		if (signal) {
			const onAbort = () => child.kill("SIGTERM");
			if (signal.aborted) {
				child.kill("SIGTERM");
			} else {
				signal.addEventListener("abort", onAbort, { once: true });
				child.on("close", () =>
					signal.removeEventListener("abort", onAbort),
				);
			}
		}

		// Collect stderr so we can surface errors to the UI
		const stderrChunks: string[] = [];
		let agentErrorReported = false;

		const rl = createInterface({ input: child.stdout! });

		// Prevent unhandled 'error' events when the child process fails
		// to start (e.g. ENOENT). The child's own 'error' handler below
		// surfaces the real error to the caller.
		rl.on("error", () => { /* handled by child error/close */ });

		rl.on("line", (line: string) => {
			if (!line.trim()) {return;}

			let event: AgentEvent;
			try {
				event = JSON.parse(line) as AgentEvent;
			} catch {
				console.log("[agent-runner] Non-JSON line:", line);
				return; // skip non-JSON lines
			}

			// Handle assistant text deltas
			if (event.event === "agent" && event.stream === "assistant") {
				const delta =
					typeof event.data?.delta === "string"
						? event.data.delta
						: undefined;
				if (delta) {
					callback.onTextDelta(delta);
				}
				// Forward media URLs (images, files generated by the agent)
				const mediaUrls = event.data?.mediaUrls;
				if (Array.isArray(mediaUrls)) {
					for (const url of mediaUrls) {
						if (typeof url === "string" && url.trim()) {
							callback.onTextDelta(`\n![media](${url.trim()})\n`);
						}
					}
				}
			}

			// Handle thinking/reasoning deltas
			if (event.event === "agent" && event.stream === "thinking") {
				const delta =
					typeof event.data?.delta === "string"
						? event.data.delta
						: undefined;
				if (delta) {
					callback.onThinkingDelta(delta);
				}
			}

			// Handle tool execution events
			if (event.event === "agent" && event.stream === "tool") {
				const phase =
					typeof event.data?.phase === "string"
						? event.data.phase
						: undefined;
				const toolCallId =
					typeof event.data?.toolCallId === "string"
						? event.data.toolCallId
						: "";
				const toolName =
					typeof event.data?.name === "string"
						? event.data.name
						: "";

				if (phase === "start") {
					const args =
						event.data?.args &&
						typeof event.data.args === "object"
							? (event.data.args as Record<string, unknown>)
							: undefined;
					callback.onToolStart(toolCallId, toolName, args);
				} else if (phase === "update") {
					callback.onToolUpdate?.(toolCallId, toolName);
				} else if (phase === "result") {
					const isError = event.data?.isError === true;
					const result = extractToolResult(event.data?.result);
					callback.onToolEnd(toolCallId, toolName, isError, result);
				}
			}

			// Handle lifecycle start
			if (
				event.event === "agent" &&
				event.stream === "lifecycle" &&
				event.data?.phase === "start"
			) {
				callback.onLifecycleStart?.();
			}

			// Handle lifecycle end
			if (
				event.event === "agent" &&
				event.stream === "lifecycle" &&
				event.data?.phase === "end"
			) {
				callback.onLifecycleEnd();
			}

			// Handle session compaction events
			if (event.event === "agent" && event.stream === "compaction") {
				const phase =
					typeof event.data?.phase === "string"
						? event.data.phase
						: undefined;
				if (phase === "start") {
					callback.onCompactionStart?.();
				} else if (phase === "end") {
					const willRetry = event.data?.willRetry === true;
					callback.onCompactionEnd?.(willRetry);
				}
			}

			// ── Surface agent-level errors (API 402, rate limits, etc.) ──

			// Lifecycle error phase
			if (
				event.event === "agent" &&
				event.stream === "lifecycle" &&
				event.data?.phase === "error"
			) {
				const msg = parseAgentErrorMessage(event.data);
				if (msg && !agentErrorReported) {
					agentErrorReported = true;
					callback.onAgentError?.(msg);
				}
			}

			// Top-level error events
			if (event.event === "error") {
				const msg = parseAgentErrorMessage(event.data ?? event);
				if (msg && !agentErrorReported) {
					agentErrorReported = true;
					callback.onAgentError?.(msg);
				}
			}

			// Messages with stopReason "error" (some agents inline errors this way)
			if (
				event.event === "agent" &&
				event.stream === "assistant" &&
				typeof event.data?.stopReason === "string" &&
				event.data.stopReason === "error" &&
				typeof event.data?.errorMessage === "string"
			) {
				if (!agentErrorReported) {
					agentErrorReported = true;
					callback.onAgentError?.(
						parseErrorBody(event.data.errorMessage),
					);
				}
			}
		});

		child.on("close", (code) => {
			// If no error was reported yet, check stderr for useful info
			if (!agentErrorReported && stderrChunks.length > 0) {
				const stderr = stderrChunks.join("").trim();
				const msg = parseErrorFromStderr(stderr);
				if (msg) {
					agentErrorReported = true;
					callback.onAgentError?.(msg);
				}
			}
			callback.onClose(code);
			resolve();
		});

		child.on("error", (err) => {
			const error = err instanceof Error ? err : new Error(String(err));
			callback.onError(error);
			resolve();
		});

		// Capture stderr for debugging + error surfacing
		child.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stderrChunks.push(text);
			console.error("[ironclaw stderr]", text);
		});
	});
}

// ── Error message extraction helpers ──

/**
 * Extract a user-friendly error message from an agent event's data object.
 * Handles various shapes: `{ error: "..." }`, `{ message: "..." }`,
 * `{ errorMessage: "402 {...}" }`, etc.
 */
export function parseAgentErrorMessage(
	data: Record<string, unknown> | undefined,
): string | undefined {
	if (!data) {return undefined;}

	// Direct error string
	if (typeof data.error === "string") {return parseErrorBody(data.error);}
	// Message field
	if (typeof data.message === "string") {return parseErrorBody(data.message);}
	// errorMessage field (may contain "402 {json}")
	if (typeof data.errorMessage === "string")
		{return parseErrorBody(data.errorMessage);}

	return undefined;
}

/**
 * Parse a raw error string that may contain an HTTP status + JSON body,
 * e.g. `402 {"error":{"message":"Insufficient funds..."}}`.
 * Returns a clean, user-readable message.
 */
export function parseErrorBody(raw: string): string {
	// Try to extract JSON body from "STATUS {json}" pattern
	const jsonIdx = raw.indexOf("{");
	if (jsonIdx >= 0) {
		try {
			const parsed = JSON.parse(raw.slice(jsonIdx));
			const msg =
				parsed?.error?.message ?? parsed?.message ?? parsed?.error;
			if (typeof msg === "string") {return msg;}
		} catch {
			// not valid JSON, fall through
		}
	}
	return raw;
}

/**
 * Extract a meaningful error message from raw stderr output.
 * Strips ANSI codes and looks for common error patterns.
 */
export function parseErrorFromStderr(stderr: string): string | undefined {
	if (!stderr) {return undefined;}

	// Strip ANSI escape codes
	// eslint-disable-next-line no-control-regex
	const clean = stderr.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");

	// Look for JSON error bodies (e.g. from API responses)
	const jsonMatch = clean.match(/\{"error":\{[^}]*"message":"([^"]+)"[^}]*\}/);
	if (jsonMatch?.[1]) {return jsonMatch[1];}

	// Look for lines containing "error" (case-insensitive)
	const lines = clean.split("\n").filter(Boolean);
	for (const line of lines) {
		const trimmed = line.trim();
		if (/\b(error|failed|fatal)\b/i.test(trimmed)) {
			// Strip common prefixes like "[openclaw]", timestamps, etc.
			const stripped = trimmed
				.replace(/^\[.*?\]\s*/, "")
				.replace(/^Error:\s*/i, "");
			if (stripped.length > 5) {return stripped;}
		}
	}

	// Last resort: return last non-empty line if it's short enough
	const last = lines[lines.length - 1]?.trim();
	if (last && last.length <= 300) {return last;}

	return undefined;
}
