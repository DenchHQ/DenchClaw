import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "./index.js";
import { _resetSyncTriggerForTests, armSyncTrigger } from "./sync-trigger.js";

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

function writeWebRuntimeProcessFile(stateDir: string, port: number): void {
  const runtimeDir = path.join(stateDir, "web-runtime");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    path.join(runtimeDir, "process.json"),
    JSON.stringify({
      pid: 99999,
      port,
      gatewayPort: 19001,
      startedAt: new Date().toISOString(),
      runtimeAppDir: path.join(runtimeDir, "app"),
    }),
  );
}

/**
 * Build a minimal plugin api shim with optional sync-trigger config.
 * Mirrors the shape `dench-ai-gateway/index.ts`'s `register()` reads.
 */
function createSyncTriggerApi(params?: {
  syncTrigger?: Record<string, unknown> | null;
}): { api: any; logs: string[] } {
  const logs: string[] = [];
  const api: any = {
    config: {
      plugins: {
        entries: {
          "dench-ai-gateway": {
            config: {
              enabled: true,
              gatewayUrl: "https://gateway.example.com",
              ...(params?.syncTrigger !== null
                ? { syncTrigger: params?.syncTrigger ?? {} }
                : {}),
            },
          },
        },
      },
    },
    logger: {
      info: (msg: string) => logs.push(msg),
    },
  };
  return { api, logs };
}

function createApi(params?: { gatewayUrl?: string; withMcp?: boolean }) {
  const gatewayUrl = params?.gatewayUrl ?? "https://gateway.example.com";
  const providers: any[] = [];
  const tools: any[] = [];
  const services: any[] = [];
  const info = vi.fn();

  const api: any = {
    config: {
      ...(params?.withMcp
        ? {
            mcp: {
              servers: {
                composio: {
                  url: `${gatewayUrl}/v1/composio/mcp`,
                  transport: "streamable-http",
                  headers: {
                    Authorization: "Bearer dc-key",
                  },
                },
              },
            },
          }
        : {}),
      plugins: {
        entries: {
          "dench-ai-gateway": {
            config: {
              enabled: true,
              gatewayUrl,
              // Disable the gateway-side sync trigger in composio bridge
              // tests — they assert exact `fetch` call counts on the
              // composio gateway URL, and the trigger would fire its
              // own loopback fetch on register() and corrupt the count.
              // The sync-trigger has its own dedicated test block below.
              syncTrigger: { enabled: false },
            },
          },
        },
      },
    },
    registerProvider(provider: any) {
      providers.push(provider);
    },
    registerTool(tool: any) {
      tools.push(tool);
    },
    registerService(service: any) {
      services.push(service);
    },
    logger: {
      info,
    },
  };

  return { api, providers, tools, services, info };
}

describe("dench-ai-gateway composio bridge", () => {
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

  it("strips the raw composio MCP server and registers the Dench Integrations execute bridge", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      expect(url).toBe("https://gateway.example.com/v1/composio/tools/execute");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        accept: "application/json",
        authorization: "Bearer dc-key",
      });
      expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
        tool_slug: "GMAIL_FETCH_EMAILS",
        arguments: {
          label_ids: ["INBOX"],
          max_results: 10,
        },
      });

      return new Response(
        JSON.stringify({
          data: {
            messages: [{ id: "m1", subject: "Hello" }],
          },
          error: null,
          log_id: "log_gmail_1",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const { api, providers, tools, services, info } = createApi({ withMcp: true });
    register(api);

    expect(providers).toHaveLength(1);
    expect(services).toHaveLength(1);
    expect(tools.map((tool) => tool.name)).toEqual(["dench_execute_integrations"]);
    expect(api.config.mcp).toBeUndefined();
    expect(info).toHaveBeenCalledWith(
      "[dench-ai-gateway] registered dench_execute_integrations bridge tool",
    );

    const result = await tools[0].execute("call-1", {
      tool_slug: "GMAIL_FETCH_EMAILS",
      arguments: {
        label_ids: ["INBOX"],
        max_results: 10,
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      denchIntegrations: true,
      tool_slug: "GMAIL_FETCH_EMAILS",
      logId: "log_gmail_1",
      structuredContent: {
        messages: [{ id: "m1", subject: "Hello" }],
      },
    });
    expect(result.content[0]?.text).toContain('"subject": "Hello"');
  });

  it("registers a stable generic schema for dench_execute_integrations", () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    const { api, tools } = createApi();
    register(api);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("dench_execute_integrations");
    expect(tools[0].parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["tool_slug"],
      properties: {
        tool_slug: {
          type: "string",
        },
        arguments: {
          type: "object",
          additionalProperties: true,
        },
        connected_account_id: {
          type: "string",
        },
      },
    });
  });

  it("passes connected_account_id through to gateway execution when provided", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      expect(url).toBe("https://gateway.example.com/v1/composio/tools/execute");
      expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
        tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
        arguments: {
          limit: 100,
        },
        connected_account_id: "acct_primary",
      });

      return new Response(
        JSON.stringify({
          data: {
            data: [{ id: "sub_123" }],
          },
          error: null,
          log_id: "log_stripe_1",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const { api, tools } = createApi();
    register(api);

    const result = await tools[0].execute("call-1", {
      tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
      connected_account_id: "acct_primary",
      arguments: {
        limit: 100,
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      denchIntegrations: true,
      tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
      connectedAccountId: "acct_primary",
      logId: "log_stripe_1",
    });
    expect(result.content[0]?.text).toContain('"sub_123"');
  });

  it("surfaces account selection required responses from the gateway", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "composio_account_selection_required",
              message: "Stripe requires an explicit account selection.",
            },
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    ) as typeof fetch;

    const { api, tools } = createApi();
    register(api);

    const result = await tools[0].execute("call-1", {
      tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
      arguments: {},
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      status: "error",
      errorCode: "composio_account_selection_required",
      tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
    });
    expect(result.content[0]?.text).toContain("requires an explicit account selection");
    expect(result.content[0]?.text).toContain("connected_account_id");
  });

  it("surfaces not-connected responses from the gateway", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "composio_not_connected",
              message: "Slack is not connected.",
            },
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    ) as typeof fetch;

    const { api, tools } = createApi();
    register(api);

    const result = await tools[0].execute("call-1", {
      tool_slug: "SLACK_LIST_CHANNELS",
      arguments: {},
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      status: "error",
      errorCode: "composio_not_connected",
      tool_slug: "SLACK_LIST_CHANNELS",
    });
    expect(result.content[0]?.text).toContain("Slack is not connected.");
    expect(result.content[0]?.text).toContain('"not_connected": true');
  });

  it("requires tool_slug and skips gateway execution when it is missing", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    globalThis.fetch = vi.fn() as typeof fetch;

    const { api, tools } = createApi();
    register(api);

    const result = await tools[0].execute("call-1", {
      arguments: {},
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("The `tool_slug` field is required");
    expect(result.content[0]?.text).toContain("dench_search_integrations");
  });
});

// ---------------------------------------------------------------------------
// sync-trigger: gateway-driven Gmail/Calendar poll-tick fan-out
// ---------------------------------------------------------------------------

describe("dench-ai-gateway sync-trigger", () => {
  const originalFetch = globalThis.fetch;
  const originalStateDir = process.env.OPENCLAW_STATE_DIR;
  const originalWebBaseUrlEnv = process.env.DENCHCLAW_WEB_BASE_URL;
  let stateDir: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    _resetSyncTriggerForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    if (originalWebBaseUrlEnv !== undefined) {
      process.env.DENCHCLAW_WEB_BASE_URL = originalWebBaseUrlEnv;
    } else {
      delete process.env.DENCHCLAW_WEB_BASE_URL;
    }
  });

  it("does NOT arm when no Dench Cloud API key is present", () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    // No auth-profiles.json written → no key.
    delete process.env.DENCH_CLOUD_API_KEY;
    delete process.env.DENCH_API_KEY;

    const fetchMock = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api, logs } = createSyncTriggerApi();

    armSyncTrigger(api);

    // Advance well past the default 5-min interval; no fetch should fire.
    vi.advanceTimersByTime(20 * 60 * 1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.some((m) => m.includes("No Dench Cloud API key"))).toBe(true);
  });

  it("does NOT arm when syncTrigger.enabled === false even with a key present", () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    const fetchMock = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api, logs } = createSyncTriggerApi({
      syncTrigger: { enabled: false },
    });

    armSyncTrigger(api);

    vi.advanceTimersByTime(20 * 60 * 1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.some((m) => m.includes("syncTrigger.enabled=false"))).toBe(true);
  });

  it("does NOT arm when intervalMs is below the safety floor", () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    const fetchMock = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api, logs } = createSyncTriggerApi({
      syncTrigger: { intervalMs: 100 },
    });

    armSyncTrigger(api);

    vi.advanceTimersByTime(60 * 1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.some((m) => m.includes("below safety floor"))).toBe(true);
  });

  it("does NOT fire an immediate tick on arm (waits for first interval)", async () => {
    // Regression: an earlier version called `void tick()` synchronously
    // inside `armSyncTrigger`, which produced 404/ECONNREFUSED noise during
    // `denchclaw update` when the gateway booted before the web runtime
    // was ready. The new contract is "no fetch until the first interval".
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");
    writeWebRuntimeProcessFile(stateDir, 4242);

    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api, logs } = createSyncTriggerApi({
      syncTrigger: { intervalMs: 5000 },
    });

    armSyncTrigger(api);
    // Flush microtasks just in case; nothing should fire.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    // First fetch should land at intervalMs, not earlier.
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second interval → second fetch.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(logs.some((m) => m.includes("sync-trigger armed"))).toBe(true);
  });

  it("uses the right URL + Bearer auth + JSON body when ticking", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");
    writeWebRuntimeProcessFile(stateDir, 4242);

    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api } = createSyncTriggerApi({
      syncTrigger: { intervalMs: 5000 },
    });

    armSyncTrigger(api);
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:4242/api/sync/poll-tick");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer dc-key");
    expect(headers["content-type"]).toBe("application/json");
    expect((init as RequestInit).body).toBe("{}");
  });

  it("respects DENCHCLAW_WEB_BASE_URL env override", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");
    process.env.DENCHCLAW_WEB_BASE_URL = "http://127.0.0.1:9999";

    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api } = createSyncTriggerApi({
      syncTrigger: { intervalMs: 5000 },
    });

    armSyncTrigger(api);
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:9999/api/sync/poll-tick");
  });

  it("falls back to default web port (3100) when no process.json + no env override", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");
    delete process.env.DENCHCLAW_WEB_BASE_URL;
    // Intentionally NOT writing process.json.

    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api } = createSyncTriggerApi({
      syncTrigger: { intervalMs: 5000 },
    });

    armSyncTrigger(api);
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:3100/api/sync/poll-tick");
  });

  it("swallows fetch errors so a downed web app doesn't crash the gateway", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api, logs } = createSyncTriggerApi({
      syncTrigger: { intervalMs: 5000 },
    });

    expect(() => armSyncTrigger(api)).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs.some((m) => m.includes("ECONNREFUSED"))).toBe(true);
  });

  it("is idempotent: a second armSyncTrigger call is a no-op", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api } = createSyncTriggerApi({
      syncTrigger: { intervalMs: 5000 },
    });

    armSyncTrigger(api);
    armSyncTrigger(api); // second call should not double-arm
    await vi.advanceTimersByTimeAsync(5000);

    // Only one interval handler → only one tick per interval, not two.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ---- Throttled-error logging ----

  it("logs first failure in a streak only once until the failure mode changes", async () => {
    // Same 404 ten times in a row → exactly one log line. This was the
    // user-visible noise during the stale-runtime episode that motivated
    // the throttling.
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    const fetchMock = vi.fn(
      async () => new Response("not found", { status: 404 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api, logs } = createSyncTriggerApi({
      syncTrigger: { intervalMs: 5000 },
    });

    armSyncTrigger(api);
    for (let i = 0; i < 10; i += 1) {
      await vi.advanceTimersByTimeAsync(5000);
    }

    expect(fetchMock).toHaveBeenCalledTimes(10);
    const failureLogs = logs.filter((m) => m.includes("HTTP 404"));
    expect(failureLogs).toHaveLength(1);
  });

  it("logs again when failure mode changes (404 → 500)", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    let status = 404;
    const fetchMock = vi.fn(
      async () => new Response("err", { status }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api, logs } = createSyncTriggerApi({
      syncTrigger: { intervalMs: 5000 },
    });

    armSyncTrigger(api);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    status = 500;
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    const httpLogs = logs.filter((m) => m.includes("HTTP "));
    expect(httpLogs).toHaveLength(2);
    expect(httpLogs[0]).toContain("HTTP 404");
    expect(httpLogs[1]).toContain("HTTP 500");
  });

  it("logs a recovery line when a failure streak ends with a 200", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    let ok = false;
    const fetchMock = vi.fn(async () =>
      ok ? new Response("{}", { status: 200 }) : new Response("err", { status: 404 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api, logs } = createSyncTriggerApi({
      syncTrigger: { intervalMs: 5000 },
    });

    armSyncTrigger(api);
    await vi.advanceTimersByTimeAsync(5000); // 404 (logged)
    await vi.advanceTimersByTimeAsync(5000); // 404 (suppressed)
    ok = true;
    await vi.advanceTimersByTimeAsync(5000); // 200 (recovery logged)
    await vi.advanceTimersByTimeAsync(5000); // 200 (no log)

    const httpLogs = logs.filter((m) => m.includes("HTTP "));
    const recoveryLogs = logs.filter((m) => m.includes("recovered"));
    expect(httpLogs).toHaveLength(1);
    expect(recoveryLogs).toHaveLength(1);
    expect(recoveryLogs[0]).toContain("http:4xx");
  });

  it("treats AbortError (timeout) as a distinct failure mode", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-trigger-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    const fetchMock = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const { api, logs } = createSyncTriggerApi({
      syncTrigger: { intervalMs: 5000 },
    });

    armSyncTrigger(api);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    const timeoutLogs = logs.filter((m) => m.includes("timed out"));
    expect(timeoutLogs).toHaveLength(1);
  });
});
