import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./workspace", () => ({
	resolveActiveAgentId: () => "main",
	resolveOpenClawStateDir: () => "/tmp/__agent_runner_test_state",
}));

// Valid client IDs the Gateway accepts (from ui/src/ui/contracts/gateway-client-info.ts).
// Hardcoded here so the test breaks if our code drifts from the Gateway's enum.
const VALID_GATEWAY_CLIENT_IDS = new Set([
	"webchat-ui",
	"openclaw-control-ui",
	"webchat",
	"cli",
	"gateway-client",
	"openclaw-macos",
	"openclaw-ios",
	"openclaw-android",
	"node-host",
	"test",
	"fingerprint",
	"openclaw-probe",
]);

const VALID_GATEWAY_CLIENT_MODES = new Set([
	"webchat",
	"cli",
	"ui",
	"backend",
	"node",
	"probe",
	"test",
]);

/**
 * Mock that replaces the `ws` module's default export.
 * Mimics the ws package's EventEmitter-based API (.on, .once, .emit)
 * and tracks constructor args so we can assert on Origin header.
 */
function installMockWsModule() {
	type ReqFrame = {
		type: "req";
		id: string;
		method: string;
		params?: unknown;
	};
	type ResFrame = {
		type: "res";
		id: string;
		ok: boolean;
		payload?: unknown;
		error?: unknown;
	};

	class MockNodeWebSocket extends EventEmitter {
		static OPEN = 1;
		static instances: MockNodeWebSocket[] = [];
		static responseOverrides: Record<
			string,
			ResFrame | ((frame: ReqFrame) => ResFrame)
		> = {};
		static failOpenForUrls = new Set<string>();

		readyState = 0;
		methods: string[] = [];
		requestFrames: ReqFrame[] = [];
		constructorUrl: string;
		constructorOpts: Record<string, unknown>;

		constructor(url: string, opts?: Record<string, unknown>) {
			super();
			this.constructorUrl = url;
			this.constructorOpts = opts ?? {};
			MockNodeWebSocket.instances.push(this);
			queueMicrotask(() => {
				if (MockNodeWebSocket.failOpenForUrls.has(this.constructorUrl)) {
					this.emit("error", new Error("mock gateway open failure"));
					return;
				}
				this.readyState = MockNodeWebSocket.OPEN;
				this.emit("open");
			});
		}

		send(payload: string) {
			const frame = JSON.parse(payload) as ReqFrame;
			this.methods.push(frame.method);
			this.requestFrames.push(frame);
			const override = MockNodeWebSocket.responseOverrides[frame.method];
			const resolved =
				typeof override === "function" ? override(frame) : override;
			const response = JSON.stringify(
				resolved ?? {
					type: "res",
					id: frame.id,
					ok: true,
					payload: {},
				},
			);
			this.emit("message", Buffer.from(response));
		}

		emitJson(frame: Record<string, unknown>) {
			this.emit("message", Buffer.from(JSON.stringify(frame)));
		}

		close() {
			this.readyState = 3;
			queueMicrotask(() => this.emit("close", 1000, Buffer.alloc(0)));
		}
	}

	vi.doMock("ws", () => ({
		default: MockNodeWebSocket,
		__esModule: true,
	}));

	return MockNodeWebSocket;
}

async function waitFor(
	predicate: () => boolean,
	options?: { attempts?: number; delayMs?: number },
): Promise<void> {
	const attempts = options?.attempts ?? 60;
	const delayMs = options?.delayMs ?? 10;
	for (let i = 0; i < attempts; i++) {
		if (predicate()) {
			return;
		}
		await new Promise((r) => setTimeout(r, delayMs));
	}
	throw new Error("Condition not met in waitFor");
}

describe("agent-runner", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	// ── buildConnectParams ───────────────────────────────────────────

	describe("buildConnectParams", () => {
		it("uses a client.id that the Gateway actually accepts (prevents connect rejection)", async () => {
			const { buildConnectParams } = await import("./agent-runner.js");
			const params = buildConnectParams({ url: "ws://127.0.0.1:19001" }) as {
				client: { id: string; mode: string };
			};
			expect(VALID_GATEWAY_CLIENT_IDS.has(params.client.id)).toBe(true);
		});

		it("uses a client.mode the Gateway accepts (prevents schema validation failure)", async () => {
			const { buildConnectParams } = await import("./agent-runner.js");
			const params = buildConnectParams({ url: "ws://127.0.0.1:19001" }) as {
				client: { id: string; mode: string };
			};
			expect(VALID_GATEWAY_CLIENT_MODES.has(params.client.mode)).toBe(true);
		});

		it("includes auth.token when settings have a token", async () => {
			const { buildConnectParams } = await import("./agent-runner.js");
			const params = buildConnectParams({
				url: "ws://127.0.0.1:19001",
				token: "secret-token",
			}) as { auth?: { token?: string; password?: string } };
			expect(params.auth?.token).toBe("secret-token");
		});

		it("includes auth.password when settings have a password", async () => {
			const { buildConnectParams } = await import("./agent-runner.js");
			const params = buildConnectParams({
				url: "ws://127.0.0.1:19001",
				password: "secret-pass",
			}) as { auth?: { token?: string; password?: string } };
			expect(params.auth?.password).toBe("secret-pass");
		});

		it("omits auth when no token or password is set", async () => {
			const { buildConnectParams } = await import("./agent-runner.js");
			const params = buildConnectParams({ url: "ws://127.0.0.1:19001" }) as {
				auth?: unknown;
			};
			expect(params.auth).toBeUndefined();
		});

		it("requests protocol version 3 (current Gateway protocol)", async () => {
			const { buildConnectParams } = await import("./agent-runner.js");
			const params = buildConnectParams({ url: "ws://127.0.0.1:19001" }) as {
				minProtocol: number;
				maxProtocol: number;
			};
			expect(params.minProtocol).toBe(3);
			expect(params.maxProtocol).toBe(3);
		});

		it("uses backend mode so sessions.patch is allowed", async () => {
			const { buildConnectParams } = await import("./agent-runner.js");
			const params = buildConnectParams({ url: "ws://127.0.0.1:19001" }) as {
				client: { mode: string };
			};
			expect(params.client.mode).toBe("backend");
		});

		it("requests operator.admin only so agent startup works with admin-scoped gateway auth", async () => {
			const { buildConnectParams } = await import("./agent-runner.js");
			const params = buildConnectParams({ url: "ws://127.0.0.1:19001" }) as {
				scopes?: string[];
			};
			expect(params.scopes).toEqual(["operator.admin"]);
		});

		it("advertises tool-events capability for tool stream parity", async () => {
			const { buildConnectParams } = await import("./agent-runner.js");
			const params = buildConnectParams({ url: "ws://127.0.0.1:19001" }) as {
				caps?: string[];
			};
			expect(Array.isArray(params.caps)).toBe(true);
			expect(params.caps).toContain("tool-events");
		});
	});

	// ── spawnAgentProcess (ws transport) ─────────────────────────────

	describe("spawnAgentProcess", () => {
		it("connects via ws module with Origin header matching the gateway URL (prevents origin rejection)", async () => {
			const MockWs = installMockWsModule();
			const { spawnAgentProcess } = await import("./agent-runner.js");

			const proc = spawnAgentProcess("hello", "sess-1");
			await waitFor(() =>  MockWs.instances[0]?.methods.includes("agent"));

			const ws = MockWs.instances[0];
			expect(ws).toBeDefined();

			const headers = ws.constructorOpts.headers as Record<string, string>;
			expect(headers?.Origin).toMatch(/^http:\/\//);
			expect(ws.constructorUrl).toMatch(/^ws:\/\//);
			// Origin must be the HTTP equivalent of the ws URL
			expect(headers.Origin).toBe(
				ws.constructorUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:"),
			);

			expect(ws.methods).toContain("connect");
			expect(ws.methods).toContain("sessions.patch");
			expect(ws.methods).toContain("agent");
			expect(ws.methods.slice(0, 3)).toEqual(["connect", "sessions.patch", "agent"]);
			proc.kill("SIGTERM");
		});

		it("sets wss: origin to https: (prevents origin mismatch on TLS gateways)", async () => {
			const MockWs = installMockWsModule();
			process.env.OPENCLAW_GATEWAY_URL = "wss://gateway.example.com:443";
			const { spawnAgentProcess } = await import("./agent-runner.js");

			const proc = spawnAgentProcess("hello");
			await waitFor(() =>  MockWs.instances[0]?.methods.includes("connect"));

			const ws = MockWs.instances[0];
			const headers = ws.constructorOpts.headers as Record<string, string>;
			expect(headers.Origin).toMatch(/^https:\/\//);
			proc.kill("SIGTERM");
		});

		it("falls back to config gateway port when env port is stale", async () => {
			const MockWs = installMockWsModule();
			process.env.OPENCLAW_HOME = "/tmp/__ironclaw_agent_runner_test_no_config";
			process.env.OPENCLAW_GATEWAY_PORT = "19001";
			MockWs.failOpenForUrls.add("ws://127.0.0.1:19001/");

			const { spawnAgentProcess } = await import("./agent-runner.js");
			const proc = spawnAgentProcess("hello");

			await waitFor(
				() =>  MockWs.instances.length >= 2,
				{ attempts: 80, delayMs: 10 },
			);

			const [primaryAttempt] = MockWs.instances;
			const fallbackAttempt = MockWs.instances.find(
				(instance) => instance.constructorUrl !== primaryAttempt?.constructorUrl,
			);
			expect(primaryAttempt?.constructorUrl).toBe("ws://127.0.0.1:19001/");
			expect(fallbackAttempt).toBeDefined();

			await waitFor(
				() =>  Boolean(fallbackAttempt?.methods.includes("connect")),
				{ attempts: 80, delayMs: 10 },
			);

			proc.kill("SIGTERM");
		});

	});

	describe("spawnAgentSubscribeProcess", () => {
		it("subscribes via connect -> sessions.patch -> agent.subscribe", async () => {
			const MockWs = installMockWsModule();
			const { spawnAgentSubscribeProcess } = await import("./agent-runner.js");

			const proc = spawnAgentSubscribeProcess("agent:main:web:sess-sub", 12);
			await waitFor(
				() =>  MockWs.instances[0]?.methods.includes("agent.subscribe"),
				{ attempts: 80, delayMs: 10 },
			);

			const ws = MockWs.instances[0];
			expect(ws.methods.slice(0, 3)).toEqual([
				"connect",
				"sessions.patch",
				"agent.subscribe",
			]);
			const subscribeFrame = ws.requestFrames.find(
				(frame) => frame.method === "agent.subscribe",
			);
			expect(subscribeFrame?.params).toMatchObject({
				sessionKey: "agent:main:web:sess-sub",
				afterSeq: 12,
			});
			proc.kill("SIGTERM");
		});

		it("uses payload.globalSeq (not frame seq) for cursor filtering", async () => {
			const MockWs = installMockWsModule();
			const { spawnAgentSubscribeProcess } = await import("./agent-runner.js");

			const proc = spawnAgentSubscribeProcess("agent:main:web:sess-gseq", 5);
			await waitFor(
				() =>  MockWs.instances[0]?.methods.includes("agent.subscribe"),
				{ attempts: 80, delayMs: 10 },
			);
			const ws = MockWs.instances[0];

			let stdout = "";
			proc.stdout?.on("data", (chunk: Buffer | string) => {
				stdout += chunk.toString();
			});

			// Drop: payload.globalSeq <= afterSeq
			ws.emitJson({
				type: "event",
				event: "agent",
				seq: 100,
				payload: {
					runId: "r-gseq",
					sessionKey: "agent:main:web:sess-gseq",
					stream: "assistant",
					data: { delta: "old" },
					seq: 1,
					ts: Date.now(),
					globalSeq: 5,
				},
			});
			// Keep: payload.globalSeq > afterSeq even if frame.seq is smaller
			ws.emitJson({
				type: "event",
				event: "agent",
				seq: 3,
				payload: {
					runId: "r-gseq",
					sessionKey: "agent:main:web:sess-gseq",
					stream: "assistant",
					data: { delta: "new" },
					seq: 2,
					ts: Date.now(),
					globalSeq: 6,
				},
			});

			await waitFor(() => stdout.includes("\n"), { attempts: 80, delayMs: 10 });
			const lines = stdout
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);
			expect(lines).toHaveLength(1);
			const parsed = JSON.parse(lines[0]) as {
				globalSeq?: number;
				data?: { delta?: string };
			};
			expect(parsed.globalSeq).toBe(6);
			expect(parsed.data?.delta).toBe("new");
			proc.kill("SIGTERM");
		});

		it("keeps subscribe workers alive across lifecycle end events", async () => {
			const MockWs = installMockWsModule();
			const { spawnAgentSubscribeProcess } = await import("./agent-runner.js");

			const proc = spawnAgentSubscribeProcess("agent:main:web:sess-sticky", 0);
			await waitFor(
				() =>  MockWs.instances[0]?.methods.includes("agent.subscribe"),
				{ attempts: 80, delayMs: 10 },
			);
			const ws = MockWs.instances[0];

			let stdout = "";
			let closed = false;
			proc.stdout?.on("data", (chunk: Buffer | string) => {
				stdout += chunk.toString();
			});
			proc.on("close", () => {
				closed = true;
			});

			ws.emitJson({
				type: "event",
				event: "agent",
				seq: 10,
				payload: {
					runId: "r-sticky",
					sessionKey: "agent:main:web:sess-sticky",
					stream: "lifecycle",
					data: { phase: "end" },
					globalSeq: 10,
					ts: Date.now(),
				},
			});

			await new Promise((resolve) => setTimeout(resolve, 40));
			expect(closed).toBe(false);

			ws.emitJson({
				type: "event",
				event: "agent",
				seq: 11,
				payload: {
					runId: "r-sticky",
					sessionKey: "agent:main:web:sess-sticky",
					stream: "assistant",
					data: { delta: "after-end" },
					globalSeq: 11,
					ts: Date.now(),
				},
			});

			await waitFor(() => stdout.includes("after-end"), { attempts: 80, delayMs: 10 });
			proc.kill("SIGTERM");
		});

		it("drops subscribe events missing a matching session key", async () => {
			const MockWs = installMockWsModule();
			const { spawnAgentSubscribeProcess } = await import("./agent-runner.js");

			const proc = spawnAgentSubscribeProcess("agent:main:web:sess-filter", 0);
			await waitFor(
				() =>  MockWs.instances[0]?.methods.includes("agent.subscribe"),
				{ attempts: 80, delayMs: 10 },
			);
			const ws = MockWs.instances[0];

			let stdout = "";
			proc.stdout?.on("data", (chunk: Buffer | string) => {
				stdout += chunk.toString();
			});

			ws.emitJson({
				type: "event",
				event: "agent",
				seq: 1,
				payload: {
					runId: "r-filter",
					stream: "assistant",
					data: { delta: "missing-session" },
					globalSeq: 1,
					ts: Date.now(),
				},
			});
			ws.emitJson({
				type: "event",
				event: "agent",
				seq: 2,
				payload: {
					runId: "r-filter",
					sessionKey: "agent:main:web:sess-filter",
					stream: "assistant",
					data: { delta: "accepted-session" },
					globalSeq: 2,
					ts: Date.now(),
				},
			});

			await waitFor(() => stdout.includes("accepted-session"), {
				attempts: 80,
				delayMs: 10,
			});
			expect(stdout).not.toContain("missing-session");
			proc.kill("SIGTERM");
		});

		it("falls back to passive mode when agent.subscribe is unsupported", async () => {
			const MockWs = installMockWsModule();
			MockWs.responseOverrides["agent.subscribe"] = (frame) => ({
				type: "res",
				id: frame.id,
				ok: false,
				error: { message: "unknown method: agent.subscribe" },
			});
			const { spawnAgentSubscribeProcess } = await import("./agent-runner.js");

			const proc = spawnAgentSubscribeProcess("agent:main:web:sess-passive", 0);
			await waitFor(() =>  MockWs.instances[0]?.methods.includes("agent.subscribe"));

			const ws = MockWs.instances[0];
			let stdout = "";
			proc.stdout?.on("data", (chunk: Buffer | string) => {
				stdout += chunk.toString();
			});

			ws.emitJson({
				type: "event",
				event: "agent",
				seq: 8,
				payload: {
					runId: "r-passive",
					sessionKey: "agent:main:web:sess-passive",
					stream: "assistant",
					data: { delta: "passive works" },
					globalSeq: 8,
					ts: Date.now(),
				},
			});

			await waitFor(() => stdout.includes("passive works"), {
				attempts: 80,
				delayMs: 10,
			});
			proc.kill("SIGTERM");
		});

		it("caches unsupported agent.subscribe and skips retrying it", async () => {
			const MockWs = installMockWsModule();
			MockWs.responseOverrides["agent.subscribe"] = (frame) => ({
				type: "res",
				id: frame.id,
				ok: false,
				error: { message: "unknown method: agent.subscribe" },
			});
			const { spawnAgentSubscribeProcess } = await import("./agent-runner.js");

			const first = spawnAgentSubscribeProcess("agent:main:web:sess-cache", 0);
			await waitFor(() =>  MockWs.instances[0]?.methods.includes("agent.subscribe"));
			first.kill("SIGTERM");

			const second = spawnAgentSubscribeProcess("agent:main:web:sess-cache", 0);
			await waitFor(() => MockWs.instances.length >= 2);
			await new Promise((r) => setTimeout(r, 20));
			const secondMethods = MockWs.instances[1]?.methods ?? [];
			expect(secondMethods).toContain("connect");
			expect(secondMethods).toContain("sessions.patch");
			expect(secondMethods).not.toContain("agent.subscribe");
			second.kill("SIGTERM");
		});
	});

	// ── parseAgentErrorMessage ────────────────────────────────────────

	describe("parseAgentErrorMessage", () => {
		it("extracts message from error field", async () => {
			const { parseAgentErrorMessage } = await import("./agent-runner.js");
			expect(parseAgentErrorMessage({ error: "something went wrong" })).toBe(
				"something went wrong",
			);
		});

		it("extracts message from JSON error body", async () => {
			const { parseAgentErrorMessage } = await import("./agent-runner.js");
			const result = parseAgentErrorMessage({
				errorMessage: '402 {"error":{"message":"Insufficient funds"}}',
			});
			expect(result).toBe("Insufficient funds");
		});

		it("returns undefined for empty data", async () => {
			const { parseAgentErrorMessage } = await import("./agent-runner.js");
			expect(parseAgentErrorMessage(undefined)).toBeUndefined();
			expect(parseAgentErrorMessage({})).toBeUndefined();
		});
	});

	// ── parseErrorFromStderr ─────────────────────────────────────────

	describe("parseErrorFromStderr", () => {
		it("extracts JSON error message from stderr", async () => {
			const { parseErrorFromStderr } = await import("./agent-runner.js");
			const stderr = `Some log line\n{"error":{"message":"Rate limit exceeded"}}\n`;
			expect(parseErrorFromStderr(stderr)).toBe("Rate limit exceeded");
		});

		it("returns undefined for empty stderr", async () => {
			const { parseErrorFromStderr } = await import("./agent-runner.js");
			expect(parseErrorFromStderr("")).toBeUndefined();
		});
	});

	// ── parseErrorBody ───────────────────────────────────────────────

	describe("parseErrorBody", () => {
		it("extracts error message from JSON error body", async () => {
			const { parseErrorBody } = await import("./agent-runner.js");
			expect(parseErrorBody('{"error":{"message":"Something failed"}}')).toBe(
				"Something failed",
			);
		});

		it("returns raw string for non-JSON body", async () => {
			const { parseErrorBody } = await import("./agent-runner.js");
			expect(parseErrorBody("plain text error")).toBe("plain text error");
		});
	});
});
