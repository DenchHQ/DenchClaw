import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import register from "./index.js";

function writeAuthProfiles(stateDir: string, key: string): void {
	const authDir = path.join(stateDir, "agents", "main", "agent");
	mkdirSync(authDir, { recursive: true });
	writeFileSync(
		path.join(authDir, "auth-profiles.json"),
		JSON.stringify({
			version: 1,
			profiles: {
				"dench-cloud:default": { type: "api_key", provider: "dench-cloud", key },
			},
		}),
	);
}

function writeOpenClawConfig(stateDir: string): void {
	writeFileSync(
		path.join(stateDir, "openclaw.json"),
		JSON.stringify({
			models: {
				providers: {
					"dench-cloud": {},
				},
			},
		}),
	);
}

function createApi() {
	const tools: any[] = [];
	const api = {
		config: {
			plugins: {
				entries: {
					"dench-ai-gateway": {
						config: {
							enabled: true,
							gatewayUrl: "https://gateway.example.com",
						},
					},
				},
			},
		},
		registerTool(tool: any) {
			tools.push(tool);
		},
		logger: {
			info: vi.fn(),
		},
	} as unknown as Parameters<typeof register>[0];
	return { api, tools };
}

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/** Pull the single fetch call's parsed url/method/headers/body. */
function readFetchCall(fetchMock: ReturnType<typeof vi.fn>) {
	expect(fetchMock).toHaveBeenCalledTimes(1);
	const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
	const url = new URL(String(input));
	return {
		path: url.origin + url.pathname,
		search: url.searchParams,
		method: init?.method,
		headers: (init?.headers ?? {}) as Record<string, string>,
		body: init?.body ? JSON.parse(String(init.body)) : undefined,
	};
}

function setupState(): string {
	const stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-enrich-state-"));
	process.env.OPENCLAW_STATE_DIR = stateDir;
	writeAuthProfiles(stateDir, "dc-key");
	writeOpenClawConfig(stateDir);
	return stateDir;
}

describe("dench_enrich tool", () => {
	const originalFetch = globalThis.fetch;
	const originalStateDir = process.env.OPENCLAW_STATE_DIR;
	let stateDir: string | undefined;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
		if (stateDir) {
			rmSync(stateDir, { recursive: true, force: true });
			stateDir = undefined;
		}
		if (originalStateDir !== undefined) {
			process.env.OPENCLAW_STATE_DIR = originalStateDir;
		} else {
			delete process.env.OPENCLAW_STATE_DIR;
		}
	});

	it("registers a single tool named dench_enrich", () => {
		stateDir = setupState();
		const { api, tools } = createApi();
		register(api);
		expect(tools).toHaveLength(1);
		expect(tools[0].name).toBe("dench_enrich");
	});

	it("does not register the tool when no Dench Cloud API key is present", () => {
		stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-enrich-state-"));
		process.env.OPENCLAW_STATE_DIR = stateDir;
		writeOpenClawConfig(stateDir); // no auth profiles written
		const { api, tools } = createApi();
		register(api);
		expect(tools).toHaveLength(0);
	});

	it("person contact: returns a cached person immediately", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				status: "completed",
				enrichmentId: null,
				queuedCount: 0,
				cachedResults: [
					{ full_name: "Jane Doe", emails: [{ email: "jane@acme.com" }], phones: [] },
				],
			}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		const result = await tools[0].execute("call_1", {
			action: "people",
			linkedinUrl: "https://www.linkedin.com/in/janedoe",
		});

		const call = readFetchCall(fetchMock);
		expect(call.path).toBe("https://gateway.example.com/v1/enrichment/person/contact");
		expect(call.method).toBe("POST");
		expect(call.headers.authorization).toBe("Bearer dc-key");
		expect(call.headers["x-dench-scope"]).toBe("data:enrichment");
		expect(call.body.preferCache).toBe(true);
		expect(call.body.contacts[0]).toMatchObject({
			linkedinUrl: "https://www.linkedin.com/in/janedoe",
		});
		// Hybrid async: cache hit returns the person, not a job id.
		expect(result.details.person).toBeDefined();
		expect(result.details.person.email).toBe("jane@acme.com");
		expect(result.details.enrichmentId).toBeUndefined();
	});

	it("person contact: returns enrichmentId + pollPath for a queued job (no blocking poll)", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				status: "queued",
				enrichmentId: "job_123",
				queuedCount: 1,
				cachedResults: [],
			}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		const result = await tools[0].execute("call_1", {
			action: "people",
			firstName: "Mark",
			lastName: "Rachapoom",
			organizationName: "Dench",
		});

		// The agent tool must NOT poll — exactly one request is made.
		const call = readFetchCall(fetchMock);
		expect(call.body.contacts[0]).toMatchObject({
			firstName: "Mark",
			lastName: "Rachapoom",
			companyName: "Dench",
		});
		expect(result.details.enrichmentId).toBe("job_123");
		expect(result.details.status).toBe("queued");
		expect(result.details.pollPath).toBe("/v1/enrichment/jobs/job_123");
		expect(result.details.person).toBeUndefined();
	});

	it("person contact: maps legacy requiredFields to enrichFields tokens", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () =>
			jsonResponse({ status: "queued", enrichmentId: "job_1", queuedCount: 1, cachedResults: [] }),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		await tools[0].execute("call_1", {
			action: "people",
			linkedinUrl: "https://www.linkedin.com/in/janedoe",
			requiredFields: ["phone", "email"],
		});

		const call = readFetchCall(fetchMock);
		expect(call.body.contacts[0].enrichFields).toEqual(
			expect.arrayContaining(["phones", "work_emails"]),
		);
	});

	it("person contact: omits enrichFields entirely when the caller supplies none", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () =>
			jsonResponse({ status: "queued", enrichmentId: "job_1", queuedCount: 1, cachedResults: [] }),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		await tools[0].execute("call_1", {
			action: "people",
			linkedinUrl: "https://www.linkedin.com/in/janedoe",
		});

		const call = readFetchCall(fetchMock);
		// No legacy default-backfill list; the gateway applies its own default.
		expect(call.body.contacts[0].enrichFields).toBeUndefined();
		expect(call.body.contacts[0].requiredFields).toBeUndefined();
		expect(call.body.mode).toBeUndefined();
	});

	it("person contact: rejects email-only input without calling the gateway", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () => jsonResponse({}));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		const result = await tools[0].execute("call_1", {
			action: "people",
			email: "jane@acme.com",
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.details.error).toMatch(/linkedinUrl OR firstName\+lastName/);
	});

	it("company: looks up by domain via /company/search", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () =>
			jsonResponse({ companies: [{ name: "Acme", website: "acme.com" }] }),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		const result = await tools[0].execute("call_1", {
			action: "company",
			domain: "acme.com",
		});

		const call = readFetchCall(fetchMock);
		expect(call.path).toBe("https://gateway.example.com/v1/enrichment/company/search");
		expect(call.method).toBe("POST");
		expect(call.body).toMatchObject({ domain: "acme.com", limit: 1 });
		expect(result.details.company.name).toBe("Acme");
		expect(result.details.organization).toBeDefined();
	});

	it("company: errors without a domain and does not call the gateway", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () => jsonResponse({}));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		const result = await tools[0].execute("call_1", { action: "company" });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.details.error).toMatch(/requires a domain/);
	});

	it("people_search: posts gateway filter body and returns people", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () => jsonResponse({ people: [{ id: "p1" }] }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		const result = await tools[0].execute("call_1", {
			action: "people_search",
			personTitles: ["Founder"],
			personLocations: ["San Francisco"],
			organizationDomains: ["dench.com"],
			perPage: 5,
		});

		const call = readFetchCall(fetchMock);
		expect(call.path).toBe("https://gateway.example.com/v1/enrichment/people/search");
		expect(call.body).toMatchObject({
			titles: ["Founder"],
			locations: ["San Francisco"],
			companyDomain: "dench.com",
			limit: 5,
		});
		// people_search must NOT carry person-contact enrichFields/requiredFields.
		expect(call.body.requiredFields).toBeUndefined();
		expect(result.details.people).toHaveLength(1);
	});

	it("job_status: resolves a succeeded job into person/people", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				enrichmentId: "job_123",
				status: "succeeded",
				people: [{ full_name: "Jane Doe", emails: [{ email: "jane@acme.com" }] }],
			}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		const result = await tools[0].execute("call_1", {
			action: "job_status",
			enrichmentId: "job_123",
		});

		const call = readFetchCall(fetchMock);
		expect(call.path).toBe("https://gateway.example.com/v1/enrichment/jobs/job_123");
		expect(call.method).toBe("GET");
		expect(result.details.status).toBe("succeeded");
		expect(result.details.person.email).toBe("jane@acme.com");
		expect(result.details.people).toHaveLength(1);
	});

	it("job_status: reports a still-pending job", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () =>
			jsonResponse({ enrichmentId: "job_123", status: "pending" }),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		const result = await tools[0].execute("call_1", {
			action: "job_status",
			enrichmentId: "job_123",
		});

		expect(result.details.status).toBe("pending");
		expect(result.details.message).toMatch(/retry job_status/);
	});

	it("job_status: errors when enrichmentId is missing", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () => jsonResponse({}));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		const result = await tools[0].execute("call_1", { action: "job_status" });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.details.error).toMatch(/requires enrichmentId/);
	});

	it("rejects unknown actions", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () => jsonResponse({}));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		const result = await tools[0].execute("call_1", { action: "nope" });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.details.error).toMatch(/Unknown action/);
	});

	it("surfaces gateway provider-unavailable errors", async () => {
		stateDir = setupState();
		const fetchMock = vi.fn(async () =>
			jsonResponse({ error: { code: "provider_unavailable" } }, 503),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { api, tools } = createApi();
		register(api);
		const result = await tools[0].execute("call_1", {
			action: "people",
			linkedinUrl: "https://www.linkedin.com/in/janedoe",
		});

		expect(result.details.error).toBe("Gateway providers unavailable");
	});
});
