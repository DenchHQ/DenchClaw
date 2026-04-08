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

describe("dench-ai-gateway composio bridge", () => {
  const originalFetch = globalThis.fetch;
  const originalStateDir = process.env.OPENCLAW_STATE_DIR;
  let workspaceDir: string | undefined;
  let stateDir: string | undefined;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (workspaceDir) {
      rmSync(workspaceDir, { recursive: true, force: true });
      workspaceDir = undefined;
    }
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

  it("strips the raw composio MCP server and registers the generic Composio dispatcher", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    workspaceDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-"));
    writeFileSync(
      path.join(workspaceDir, "composio-tool-index.json"),
      JSON.stringify(
        {
          generated_at: "2026-04-02T00:00:00.000Z",
          managed_tools: ["composio_search_tools", "composio_call_tool"],
          connected_apps: [
            {
              toolkit_slug: "gmail",
              toolkit_name: "Gmail",
              account_count: 1,
              accounts: [
                {
                  connected_account_id: "conn_gmail_1",
                  account_identity: "user@gmail.com",
                  account_identity_source: "gateway_stable_id",
                  identity_confidence: "high",
                  display_label: "user@gmail.com",
                  related_connection_ids: [],
                  is_same_account_reconnect: false,
                },
              ],
              tools: [
                {
                  name: "GMAIL_FETCH_EMAILS",
                  title: "Fetch emails",
                  description_short: "Fetch recent Gmail messages.",
                  required_args: [],
                  arg_hints: {
                    label_ids: 'Must be an array like ["INBOX"].',
                  },
                  default_args: { label_ids: ["INBOX"], max_results: 10 },
                  input_schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      label_ids: {
                        type: "array",
                        items: { type: "string" },
                      },
                      max_results: {
                        type: "number",
                      },
                    },
                  },
                },
                {
                  name: "GMAIL_SEND_EMAIL",
                  title: "Send email",
                  description_short: "Send a Gmail message.",
                  required_args: ["to", "subject", "body"],
                  arg_hints: {},
                  input_schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      to: { type: "string" },
                      subject: { type: "string" },
                      body: { type: "string" },
                    },
                    required: ["to", "subject", "body"],
                  },
                },
              ],
              recipes: {
                "Read recent emails": "GMAIL_FETCH_EMAILS",
                "Send email": "GMAIL_SEND_EMAIL",
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const providers: any[] = [];
    const tools: any[] = [];
    const services: any[] = [];
    const info = vi.fn();

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const payload = JSON.parse(String(init?.body ?? "{}"));
      expect(url).toBe("https://gateway.example.com/v1/composio/tool-router/execute");
      expect(payload).toEqual({
        execution_ref: "exec_gmail_1",
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
          tool_slug: "GMAIL_FETCH_EMAILS",
          tool_router_session_id: "trs_gmail_1",
          toolkit: "gmail",
          execution_ref_version: 1,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const api: any = {
      config: {
        agents: {
          defaults: {
            workspace: workspaceDir,
          },
        },
        models: {
          providers: {
            "dench-cloud": {
              apiKey: "dc-key",
            },
          },
        },
        mcp: {
          servers: {
            composio: {
              url: "https://gateway.example.com/v1/composio/mcp",
              transport: "streamable-http",
              headers: {
                Authorization: "Bearer dc-key",
              },
            },
          },
        },
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

    register(api);

    expect(providers).toHaveLength(1);
    expect(services).toHaveLength(1);
    expect(tools.map((tool) => tool.name)).toEqual(["composio_call_tool"]);
    expect(api.config.mcp).toBeUndefined();

    const result = await tools[0].execute("call-1", {
      execution_ref: "exec_gmail_1",
      arguments: {
        label_ids: ["INBOX"],
        max_results: 10,
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      composioBridge: true,
      composioMode: "gateway_tool_router",
      toolRouterSessionId: "trs_gmail_1",
      mcpTool: "GMAIL_FETCH_EMAILS",
      toolkit: "gmail",
      executionRef: "exec_gmail_1",
      executionRefVersion: 1,
    });
    expect(result.content[0]?.text).toContain('"subject": "Hello"');
  });

  it("registers a stable generic schema for composio_call_tool", () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    workspaceDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-"));
    writeFileSync(
      path.join(workspaceDir, "composio-tool-index.json"),
      JSON.stringify(
        {
          generated_at: "2026-04-02T00:00:00.000Z",
          managed_tools: ["composio_search_tools", "composio_call_tool"],
          connected_apps: [
            {
              toolkit_slug: "gmail",
              toolkit_name: "Gmail",
              account_count: 1,
              accounts: [
                {
                  connected_account_id: "conn_gmail_1",
                  account_identity: "user@gmail.com",
                  account_identity_source: "gateway_stable_id",
                  identity_confidence: "high",
                  display_label: "user@gmail.com",
                  related_connection_ids: [],
                  is_same_account_reconnect: false,
                },
              ],
              tools: [
                {
                  name: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
                  title: "Fetch message",
                  description_short: "Fetch one Gmail message.",
                  required_args: ["message_id"],
                  arg_hints: {
                    message_id: "Use the Gmail message id.",
                  },
                },
              ],
              recipes: {
                "Read one email": "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const tools: any[] = [];
    const api: any = {
      config: {
        agents: {
          defaults: {
            workspace: workspaceDir,
          },
        },
        models: {
          providers: {
            "dench-cloud": {
              apiKey: "dc-key",
            },
          },
        },
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
      registerProvider() {},
      registerTool(tool: any) {
        tools.push(tool);
      },
      registerService() {},
      logger: {
        info: vi.fn(),
      },
    };

    register(api);

    expect(tools).toHaveLength(1);
    expect(tools[0].parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["execution_ref"],
      properties: {
        execution_ref: {
          type: "string",
        },
        arguments: {
          type: "object",
          additionalProperties: true,
        },
      },
    });
  });

  it("executes gateway-backed Composio search results through the tool-router endpoint", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    workspaceDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-"));
    writeFileSync(
      path.join(workspaceDir, "composio-tool-index.json"),
      JSON.stringify(
        {
          generated_at: "2026-04-02T00:00:00.000Z",
          managed_tools: ["composio_search_tools", "composio_call_tool"],
          connected_apps: [
            {
              toolkit_slug: "stripe",
              toolkit_name: "Stripe",
              account_count: 1,
              tools: [
                {
                  name: "STRIPE_LIST_SUBSCRIPTIONS",
                  title: "List subscriptions",
                  description_short: "List subscriptions.",
                  required_args: [],
                  arg_hints: {},
                },
              ],
              recipes: {
                "List subscriptions": "STRIPE_LIST_SUBSCRIPTIONS",
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const tools: any[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      expect(url).toBe("https://gateway.example.com/v1/composio/tool-router/execute");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
        execution_ref: "exec_stripe_123",
        arguments: {
          limit: 100,
          starting_after: "sub_prev",
        },
      });

      return new Response(
        JSON.stringify({
          data: {
            has_more: true,
            next_cursor: "sub_next",
            data: [{ id: "sub_123" }],
          },
          error: null,
          log_id: "log_123",
          tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
          tool_router_session_id: "trs_123",
          toolkit: "stripe",
          account: "acct_primary",
          execution_ref_version: 1,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const api: any = {
      config: {
        agents: { defaults: { workspace: workspaceDir } },
        plugins: {
          entries: {
            "dench-ai-gateway": {
              config: { enabled: true, gatewayUrl: "https://gateway.example.com" },
            },
          },
        },
      },
      registerProvider() {},
      registerTool(tool: any) {
        tools.push(tool);
      },
      registerService() {},
      logger: { info: vi.fn() },
    };

    register(api);

    const result = await tools[0].execute("call-1", {
      execution_ref: "exec_stripe_123",
      arguments: {
        limit: 100,
        starting_after: "sub_prev",
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      composioBridge: true,
      composioMode: "gateway_tool_router",
      toolRouterSessionId: "trs_123",
      mcpTool: "STRIPE_LIST_SUBSCRIPTIONS",
      toolkit: "stripe",
      account: "acct_primary",
      executionRef: "exec_stripe_123",
      executionRefVersion: 1,
      pagination: {
        has_more: true,
        next_cursor: "sub_next",
      },
    });
    expect(result.content[0]?.text).toContain('"sub_123"');
  });

  it("surfaces gateway recovery metadata from an auto-healed execution", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    workspaceDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-"));
    writeFileSync(
      path.join(workspaceDir, "composio-tool-index.json"),
      JSON.stringify(
        {
          generated_at: "2026-04-02T00:00:00.000Z",
          managed_tools: ["composio_search_tools", "composio_call_tool"],
          connected_apps: [],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const tools: any[] = [];
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            items: [{ id: "sub_recovered_1" }],
          },
          error: null,
          log_id: "log_recovered_1",
          tool_slug: "YOUTUBE_LIST_USER_SUBSCRIPTIONS",
          tool_router_session_id: "trs_youtube_1",
          toolkit: "youtube",
          account: "ca_youtube_1",
          execution_ref_version: 1,
          recovery: {
            recovered: true,
            recovered_via: "auto_bind_single_active_account",
            retried_with_account: "ca_youtube_1",
            refreshed_execution_ref: "exec_youtube_refreshed",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const api: any = {
      config: {
        agents: { defaults: { workspace: workspaceDir } },
        plugins: {
          entries: {
            "dench-ai-gateway": {
              config: { enabled: true, gatewayUrl: "https://gateway.example.com" },
            },
          },
        },
      },
      registerProvider() {},
      registerTool(tool: any) {
        tools.push(tool);
      },
      registerService() {},
      logger: { info: vi.fn() },
    };

    register(api);

    const result = await tools[0].execute("call-1", {
      execution_ref: "exec_youtube_old",
      arguments: {
        maxResults: 50,
        part: "snippet,contentDetails",
      },
    });

    expect(result.details).toMatchObject({
      composioBridge: true,
      composioMode: "gateway_tool_router",
      toolRouterSessionId: "trs_youtube_1",
      mcpTool: "YOUTUBE_LIST_USER_SUBSCRIPTIONS",
      toolkit: "youtube",
      account: "ca_youtube_1",
      executionRef: "exec_youtube_old",
      executionRefVersion: 1,
      recovery: {
        recovered: true,
        recovered_via: "auto_bind_single_active_account",
        retried_with_account: "ca_youtube_1",
        refreshed_execution_ref: "exec_youtube_refreshed",
      },
    });
    expect(result.content[0]?.text).toContain('"recovered_via": "auto_bind_single_active_account"');
    expect(result.content[0]?.text).toContain('"refreshed_execution_ref": "exec_youtube_refreshed"');
  });

  it("falls back to direct MCP execution when a single active connection exists globally", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    workspaceDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-"));
    writeFileSync(
      path.join(workspaceDir, "composio-tool-index.json"),
      JSON.stringify(
        {
          generated_at: "2026-04-02T00:00:00.000Z",
          managed_tools: ["composio_search_tools", "composio_call_tool"],
          connected_apps: [],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const tools: any[] = [];
    const executionRef = `${Buffer.from(JSON.stringify({
      version: 1,
      mode: "gateway_tool_router",
      session_id: "trs_youtube_1",
      tool_slug: "YOUTUBE_LIST_USER_SUBSCRIPTIONS",
      toolkit: "youtube",
    })).toString("base64url")}.sig`;
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/composio/tool-router/execute")) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                "No active connection found for toolkit(s) 'youtube' in this session. To fix this, call COMPOSIO_MANAGE_CONNECTIONS with toolkits=['youtube'] to establish a connection, then retry this tool call.",
            },
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }
      if (url.endsWith("/v1/composio/connections")) {
        return new Response(
          JSON.stringify([
            {
              id: "ca_youtube_1",
              toolkit_slug: "youtube",
              status: "ACTIVE",
            },
          ]),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }
      if (url.includes("/v1/composio/mcp")) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              structuredContent: {
                items: [{ id: "sub_direct_1" }],
              },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const api: any = {
      config: {
        agents: { defaults: { workspace: workspaceDir } },
        plugins: {
          entries: {
            "dench-ai-gateway": {
              config: { enabled: true, gatewayUrl: "https://gateway.example.com" },
            },
          },
        },
      },
      registerProvider() {},
      registerTool(tool: any) {
        tools.push(tool);
      },
      registerService() {},
      logger: { info: vi.fn() },
    };

    register(api);

    const result = await tools[0].execute("call-1", {
      execution_ref: executionRef,
      arguments: {
        maxResults: 1,
      },
    });

    expect(result.details).toMatchObject({
      composioBridge: true,
      composioMode: "gateway_tool_router",
      toolRouterSessionId: "trs_youtube_1",
      mcpTool: "YOUTUBE_LIST_USER_SUBSCRIPTIONS",
      toolkit: "youtube",
      connectedAccountId: "ca_youtube_1",
      executionRef,
      executionRefVersion: 1,
      recovery: {
        recovered: true,
        recovered_via: "direct_mcp_single_active_account",
        retried_with_account: "ca_youtube_1",
      },
      structuredContent: {
        items: [{ id: "sub_direct_1" }],
      },
    });
    expect(result.content[0]?.text).toContain('"recovered_via": "direct_mcp_single_active_account"');
    expect(result.content[0]?.text).toContain('"sub_direct_1"');
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
  });

  it("falls back to direct MCP execution for account-issue tool-router failures", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    workspaceDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-"));
    writeFileSync(
      path.join(workspaceDir, "composio-tool-index.json"),
      JSON.stringify(
        {
          generated_at: "2026-04-02T00:00:00.000Z",
          managed_tools: ["composio_search_tools", "composio_call_tool"],
          connected_apps: [],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const tools: any[] = [];
    const executionRef = `${Buffer.from(JSON.stringify({
      version: 1,
      mode: "gateway_tool_router",
      session_id: "trs_youtube_1",
      tool_slug: "YOUTUBE_LIST_USER_PLAYLISTS",
      toolkit: "youtube",
      account: "ca_youtube_1",
    })).toString("base64url")}.sig`;
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/composio/tool-router/execute")) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                "The 'account' parameter is not supported for this project. Multi-account selection is not enabled.",
            },
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }
      if (url.endsWith("/v1/composio/connections")) {
        return new Response(
          JSON.stringify([
            {
              id: "ca_youtube_1",
              toolkit_slug: "youtube",
              status: "ACTIVE",
            },
          ]),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }
      if (url.includes("/v1/composio/mcp")) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              structuredContent: {
                items: [{ id: "playlist_direct_1" }],
              },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const api: any = {
      config: {
        agents: { defaults: { workspace: workspaceDir } },
        plugins: {
          entries: {
            "dench-ai-gateway": {
              config: { enabled: true, gatewayUrl: "https://gateway.example.com" },
            },
          },
        },
      },
      registerProvider() {},
      registerTool(tool: any) {
        tools.push(tool);
      },
      registerService() {},
      logger: { info: vi.fn() },
    };

    register(api);

    const result = await tools[0].execute("call-1", {
      execution_ref: executionRef,
      arguments: {
        maxResults: 1,
      },
    });

    expect(result.details).toMatchObject({
      composioBridge: true,
      composioMode: "gateway_tool_router",
      toolRouterSessionId: "trs_youtube_1",
      mcpTool: "YOUTUBE_LIST_USER_PLAYLISTS",
      toolkit: "youtube",
      account: "ca_youtube_1",
      connectedAccountId: "ca_youtube_1",
      executionRef,
      executionRefVersion: 1,
      recovery: {
        recovered: true,
        recovered_via: "direct_mcp_single_active_account",
        retried_with_account: "ca_youtube_1",
      },
      structuredContent: {
        items: [{ id: "playlist_direct_1" }],
      },
    });
    expect(result.content[0]?.text).toContain('"recovered_via": "direct_mcp_single_active_account"');
    expect(result.content[0]?.text).toContain('"playlist_direct_1"');
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
  });

  it("classifies no-active-connection session failures as connection issues", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    workspaceDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-"));
    writeFileSync(
      path.join(workspaceDir, "composio-tool-index.json"),
      JSON.stringify(
        {
          generated_at: "2026-04-02T00:00:00.000Z",
          managed_tools: ["composio_search_tools", "composio_call_tool"],
          connected_apps: [],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const tools: any[] = [];
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            message:
              "No active connection found for toolkit(s) 'youtube' in this session. To fix this, call COMPOSIO_MANAGE_CONNECTIONS with toolkits=['youtube'] to establish a connection, then retry this tool call.",
          },
          tool_slug: "YOUTUBE_LIST_USER_SUBSCRIPTIONS",
          tool_router_session_id: "trs_youtube_1",
          toolkit: "youtube",
          execution_ref_version: 1,
        }),
        {
          status: 400,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const api: any = {
      config: {
        agents: { defaults: { workspace: workspaceDir } },
        plugins: {
          entries: {
            "dench-ai-gateway": {
              config: { enabled: true, gatewayUrl: "https://gateway.example.com" },
            },
          },
        },
      },
      registerProvider() {},
      registerTool(tool: any) {
        tools.push(tool);
      },
      registerService() {},
      logger: { info: vi.fn() },
    };

    register(api);

    const result = await tools[0].execute("call-1", {
      execution_ref: "exec_youtube_old",
      arguments: {},
    });

    expect(result.details).toMatchObject({
      composioBridge: true,
      composioMode: "gateway_tool_router",
      toolRouterSessionId: "trs_youtube_1",
      mcpTool: "YOUTUBE_LIST_USER_SUBSCRIPTIONS",
      toolkit: "youtube",
      executionRef: "exec_youtube_old",
      executionRefVersion: 1,
      status: "error",
      failureKind: "connection_issue",
    });
    expect(result.content[0]?.text).toContain('"failure_kind": "connection_issue"');
  });

  it("surfaces account metadata returned by a gateway-issued execution ref", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    workspaceDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-"));
    writeFileSync(
      path.join(workspaceDir, "composio-tool-index.json"),
      JSON.stringify(
        {
          generated_at: "2026-04-02T00:00:00.000Z",
          managed_tools: ["composio_search_tools", "composio_call_tool"],
          connected_apps: [
            {
              toolkit_slug: "stripe",
              toolkit_name: "Stripe",
              account_count: 2,
              accounts: [
                {
                  connected_account_id: "acct_primary",
                  account_identity: "stripe:acct_primary",
                  account_identity_source: "gateway_stable_id",
                  identity_confidence: "high",
                  display_label: "Primary Stripe",
                  related_connection_ids: [],
                  is_same_account_reconnect: false,
                },
                {
                  connected_account_id: "acct_secondary",
                  account_identity: "stripe:acct_secondary",
                  account_identity_source: "gateway_stable_id",
                  identity_confidence: "high",
                  display_label: "Secondary Stripe",
                  related_connection_ids: [],
                  is_same_account_reconnect: false,
                },
              ],
              tools: [],
              recipes: {},
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const tools: any[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const payload = JSON.parse(String(init?.body ?? "{}"));
      expect(url).toBe("https://gateway.example.com/v1/composio/tool-router/execute");
      expect(payload).toEqual({
        execution_ref: "exec_stripe_primary",
        arguments: {
          limit: 25,
        },
      });

      return new Response(
        JSON.stringify({
          data: {
            data: [{ id: "sub_primary" }],
            has_more: false,
          },
          error: null,
          log_id: "log_stripe_primary",
          tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
          tool_router_session_id: "trs_456",
          toolkit: "stripe",
          account: "acct_primary",
          execution_ref_version: 1,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const api: any = {
      config: {
        agents: { defaults: { workspace: workspaceDir } },
        plugins: {
          entries: {
            "dench-ai-gateway": {
              config: { enabled: true, gatewayUrl: "https://gateway.example.com" },
            },
          },
        },
      },
      registerProvider() {},
      registerTool(tool: any) {
        tools.push(tool);
      },
      registerService() {},
      logger: { info: vi.fn() },
    };

    register(api);

    const result = await tools[0].execute("call-1", {
      execution_ref: "exec_stripe_primary",
      arguments: {
        limit: 25,
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      composioBridge: true,
      composioMode: "gateway_tool_router",
      toolRouterSessionId: "trs_456",
      mcpTool: "STRIPE_LIST_SUBSCRIPTIONS",
      toolkit: "stripe",
      account: "acct_primary",
      executionRef: "exec_stripe_primary",
      executionRefVersion: 1,
    });
    expect(result.content[0]?.text).toContain('"sub_primary"');
  });

  it("requires execution_ref for gateway-backed execution", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    workspaceDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-"));
    writeFileSync(
      path.join(workspaceDir, "composio-tool-index.json"),
      JSON.stringify(
        {
          generated_at: "2026-04-02T00:00:00.000Z",
          managed_tools: ["composio_search_tools", "composio_call_tool"],
          connected_apps: [
            {
              toolkit_slug: "stripe",
              toolkit_name: "Stripe",
              account_count: 2,
              accounts: [
                {
                  connected_account_id: "acct_primary",
                  account_identity: "stripe:acct_primary",
                  account_identity_source: "gateway_stable_id",
                  identity_confidence: "high",
                  display_label: "Primary Stripe",
                  related_connection_ids: [],
                  is_same_account_reconnect: false,
                },
                {
                  connected_account_id: "acct_secondary",
                  account_identity: "stripe:acct_secondary",
                  account_identity_source: "gateway_stable_id",
                  identity_confidence: "high",
                  display_label: "Secondary Stripe",
                  related_connection_ids: [],
                  is_same_account_reconnect: false,
                },
              ],
              tools: [],
              recipes: {},
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const tools: any[] = [];
    globalThis.fetch = vi.fn() as typeof fetch;

    const api: any = {
      config: {
        agents: { defaults: { workspace: workspaceDir } },
        plugins: {
          entries: {
            "dench-ai-gateway": {
              config: { enabled: true, gatewayUrl: "https://gateway.example.com" },
            },
          },
        },
      },
      registerProvider() {},
      registerTool(tool: any) {
        tools.push(tool);
      },
      registerService() {},
      logger: { info: vi.fn() },
    };

    register(api);

    const result = await tools[0].execute("call-1", {
      arguments: {},
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("execution_ref");
  });

  it("surfaces structured gateway account-selection errors directly", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeAuthProfiles(stateDir, "dc-key");

    workspaceDir = mkdtempSync(path.join(os.tmpdir(), "dench-ai-gateway-"));
    writeFileSync(
      path.join(workspaceDir, "composio-tool-index.json"),
      JSON.stringify(
        {
          generated_at: "2026-04-02T00:00:00.000Z",
          managed_tools: ["composio_search_tools", "composio_call_tool"],
          connected_apps: [
            {
              toolkit_slug: "stripe",
              toolkit_name: "Stripe",
              account_count: 2,
              accounts: [
                {
                  connected_account_id: "conn_stripe_1",
                  account_identity: "stripe:acct_prod",
                  account_identity_source: "gateway_stable_id",
                  identity_confidence: "high",
                  display_label: "Prod Stripe",
                  account_email: "ops@example.com",
                  related_connection_ids: [],
                  is_same_account_reconnect: false,
                },
                {
                  connected_account_id: "conn_stripe_2",
                  account_identity: "stripe:acct_test",
                  account_identity_source: "gateway_stable_id",
                  identity_confidence: "high",
                  display_label: "Test Stripe",
                  account_email: "dev@example.com",
                  related_connection_ids: [],
                  is_same_account_reconnect: false,
                },
              ],
              tools: [],
              recipes: {},
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const tools: any[] = [];
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            message:
              'Multiple active connections are available for toolkit "stripe". Re-run the search and choose the desired account before executing STRIPE_LIST_SUBSCRIPTIONS.',
            type: "invalid_request_error",
            code: "composio_client_error",
          },
          tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
          tool_router_session_id: "trs_789",
          toolkit: "stripe",
          execution_ref_version: 1,
        }),
        {
          status: 400,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;
    const api: any = {
      config: {
        agents: { defaults: { workspace: workspaceDir } },
        plugins: {
          entries: {
            "dench-ai-gateway": {
              config: { enabled: true, gatewayUrl: "https://gateway.example.com" },
            },
          },
        },
      },
      registerProvider() {},
      registerTool(tool: any) {
        tools.push(tool);
      },
      registerService() {},
      logger: { info: vi.fn() },
    };

    register(api);

    const result = await tools[0].execute("call-1", {
      execution_ref: "exec_stripe_789",
      arguments: {},
    });
    expect(result.content[0]?.text).toContain("Multiple active connections are available for toolkit");
    expect(result.details).toMatchObject({
      composioBridge: true,
      composioMode: "gateway_tool_router",
      toolRouterSessionId: "trs_789",
      mcpTool: "STRIPE_LIST_SUBSCRIPTIONS",
      toolkit: "stripe",
      executionRef: "exec_stripe_789",
      executionRefVersion: 1,
      status: "error",
    });
  });
});
