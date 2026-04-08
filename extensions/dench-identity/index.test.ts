import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import { buildIdentityPrompt, resolveWorkspaceDir } from "./index.ts";
import register from "./index.ts";
import path from "node:path";

function getRegisteredTool(api: { registerTool: ReturnType<typeof vi.fn> }, name: string) {
  return api.registerTool.mock.calls
    .map((call) => call[0])
    .find((tool) => tool?.name === name);
}

async function executeTool(tool: { execute: (toolCallId: string, input: Record<string, unknown>) => Promise<any> }, input: Record<string, unknown>) {
  return await tool.execute("tool-call-1", input);
}

function mockGatewaySearch(responsePayload: Record<string, unknown>) {
  process.env.DENCH_API_KEY = "dench-test-key";
  process.env.DENCH_GATEWAY_URL = "https://gateway.example.com";
  const toolSchemas = responsePayload.tool_schemas as Record<string, Record<string, unknown>> | undefined;
  const normalizedPayload = toolSchemas
    ? {
        ...responsePayload,
        tool_schemas: Object.fromEntries(
          Object.entries(toolSchemas).map(([toolSlug, schema]) => [
            toolSlug,
            {
              ...schema,
              execution_ref:
                typeof schema.execution_ref === "string"
                  ? schema.execution_ref
                  : `exec_${toolSlug.toLowerCase()}`,
              execution_ref_version:
                typeof schema.execution_ref_version === "number"
                  ? schema.execution_ref_version
                  : 1,
            },
          ]),
        ),
      }
    : responsePayload;
  globalThis.fetch = vi.fn(async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    expect(url).toBe("https://gateway.example.com/v1/composio/tool-router/search");
    expect(init?.method).toBe("POST");
    return new Response(
      JSON.stringify(normalizedPayload),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;
}

describe("buildIdentityPrompt", () => {
  const workspaceDir = "/home/user/workspace";

  it("includes chat history path so agent can reference past conversations", () => {
    const prompt = buildIdentityPrompt(workspaceDir);
    expect(prompt).toContain(".openclaw/web-chat/");
    expect(prompt).toContain(
      path.join(workspaceDir, ".openclaw/web-chat/"),
    );
  });

  it("includes all workspace context paths (prevents agent losing orientation)", () => {
    const prompt = buildIdentityPrompt(workspaceDir);
    expect(prompt).toContain(`**Root**: \`${workspaceDir}\``);
    expect(prompt).toContain(path.join(workspaceDir, "workspace.duckdb"));
    expect(prompt).toContain(path.join(workspaceDir, "skills"));
    expect(prompt).toContain(path.join(workspaceDir, "apps"));
  });

  it("includes CRM skill path for delegation (prevents agent using wrong skill path)", () => {
    const prompt = buildIdentityPrompt(workspaceDir);
    expect(prompt).toContain(
      path.join(workspaceDir, "skills", "crm", "SKILL.md"),
    );
  });

  it("includes composio-apps skill path and Dench Integrations guidance", () => {
    const prompt = buildIdentityPrompt(workspaceDir);
    expect(prompt).toContain(
      path.join(workspaceDir, "skills", "composio-apps", "SKILL.md"),
    );
    expect(prompt).toContain("Dench Integrations");
    expect(prompt).not.toContain("Composio MCP");
    expect(prompt).toContain("Never");
    expect(prompt).toContain("composio_search_tools");
    expect(prompt).toContain("composio_call_tool");
  });

  it("teaches the agent to emit direct composio connect links for any app", () => {
    const prompt = buildIdentityPrompt(workspaceDir);
    expect(prompt).toContain("ANY third-party app or service");
    expect(prompt).toContain("always call `composio_search_tools`");
    expect(prompt).toContain("action_link_markdown");
    expect(prompt).toContain("MUST end the assistant reply with that exact markdown link");
    expect(prompt).toContain("dench://composio/connect");
    expect(prompt).toContain("Only suggest a reconnect link");
    expect(prompt).toContain("connect_required");
  });

  it("includes enrichment guidance for Apollo and Exa", () => {
    const prompt = buildIdentityPrompt(workspaceDir);
    expect(prompt).toContain("default tool for enrichment requests");
    expect(prompt).toContain('`action: "people"`');
    expect(prompt).toContain('`action: "company"`');
    expect(prompt).toContain('`action: "people_search"`');
    expect(prompt).toContain("Use Apollo for structured CRM enrichment and Exa for broader web research");
  });

  it("prefers Dench Integrations over gog without workspace cache files", () => {
    const prompt = buildIdentityPrompt(workspaceDir);
    expect(prompt).toContain("Dench Integrations gateway-backed search plus execute is the default integration layer");
    expect(prompt).toContain("Never use `gog`");
    expect(prompt).toContain("If the integration search succeeds, do not stop because of a separate health warning");
    expect(prompt).toContain("live integration schema");
  });

  it("does not advertise the removed browser skill contract", () => {
    const prompt = buildIdentityPrompt(workspaceDir);
    expect(prompt).not.toContain(
      path.join(workspaceDir, "skills", "browser", "SKILL.md"),
    );
    expect(prompt).not.toContain("Browser Agent");
  });

  it("includes exec approval policy (prevents agent stalling on exec confirmation)", () => {
    const prompt = buildIdentityPrompt(workspaceDir);
    expect(prompt).toContain("elevated: true");
    expect(prompt).toContain("automatically approved");
  });

  it("references DenchClaw branding, not OpenClaw (prevents identity confusion)", () => {
    const prompt = buildIdentityPrompt(workspaceDir);
    expect(prompt).toContain("You are **DenchClaw**");
    expect(prompt).toContain("always use **DenchClaw** (not OpenClaw)");
  });
});

describe("buildIdentityPrompt composio cache files", () => {
  let tmp: string;
  const originalFetch = globalThis.fetch;
  const originalDenchApiKey = process.env.DENCH_API_KEY;
  const originalDenchGatewayUrl = process.env.DENCH_GATEWAY_URL;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDenchApiKey !== undefined) {
      process.env.DENCH_API_KEY = originalDenchApiKey;
    } else {
      delete process.env.DENCH_API_KEY;
    }
    if (originalDenchGatewayUrl !== undefined) {
      process.env.DENCH_GATEWAY_URL = originalDenchGatewayUrl;
    } else {
      delete process.env.DENCH_GATEWAY_URL;
    }
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not depend on composio-tool-index.json for runtime integration guidance", () => {
    tmp = path.join(
      os.tmpdir(),
      `dench-identity-composio-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      path.join(tmp, "composio-tool-index.json"),
      JSON.stringify({
        generated_at: "2026-04-01T00:00:00.000Z",
        connected_apps: [
          {
            toolkit_slug: "gmail",
            toolkit_name: "Gmail",
            account_count: 1,
            tools: [
              {
                name: "GMAIL_FETCH_EMAILS",
                title: "Fetch emails",
                description_short: "List inbox messages.",
                required_args: [],
                arg_hints: {
                  label_ids: 'Use ["INBOX"] as JSON array.',
                },
              },
            ],
            recipes: { "Read recent emails": "GMAIL_FETCH_EMAILS" },
          },
        ],
      }),
      "utf-8",
    );

    const prompt = buildIdentityPrompt(tmp);
    expect(prompt).toContain("Connected App Tools (Dench Integrations)");
    expect(prompt).toContain("Do not rely on `composio-tool-index.json`");
    expect(prompt).not.toContain("GMAIL_FETCH_EMAILS");
  });
});

describe("resolveWorkspaceDir", () => {
  it("returns workspace path when config is a valid string", () => {
    const api = { config: { agents: { defaults: { workspace: "/home/user/ws" } } } };
    expect(resolveWorkspaceDir(api)).toBe("/home/user/ws");
  });

  it("returns undefined when api is null (prevents crash on missing config)", () => {
    expect(resolveWorkspaceDir(null)).toBeUndefined();
  });

  it("returns undefined when api is undefined (prevents crash on missing config)", () => {
    expect(resolveWorkspaceDir(undefined)).toBeUndefined();
  });

  it("returns undefined when config chain is missing (prevents crash on partial config)", () => {
    expect(resolveWorkspaceDir({})).toBeUndefined();
    expect(resolveWorkspaceDir({ config: {} })).toBeUndefined();
    expect(resolveWorkspaceDir({ config: { agents: {} } })).toBeUndefined();
    expect(resolveWorkspaceDir({ config: { agents: { defaults: {} } } })).toBeUndefined();
  });

  it("returns undefined when workspace is empty string (prevents empty path injection)", () => {
    const api = { config: { agents: { defaults: { workspace: "" } } } };
    expect(resolveWorkspaceDir(api)).toBeUndefined();
  });

  it("returns undefined when workspace is whitespace-only (prevents whitespace path injection)", () => {
    const api = { config: { agents: { defaults: { workspace: "   " } } } };
    expect(resolveWorkspaceDir(api)).toBeUndefined();
  });

  it("returns undefined when workspace is not a string (prevents type coercion)", () => {
    expect(resolveWorkspaceDir({ config: { agents: { defaults: { workspace: 42 } } } })).toBeUndefined();
    expect(resolveWorkspaceDir({ config: { agents: { defaults: { workspace: true } } } })).toBeUndefined();
    expect(resolveWorkspaceDir({ config: { agents: { defaults: { workspace: null } } } })).toBeUndefined();
  });

  it("trims leading/trailing whitespace from valid paths", () => {
    const api = { config: { agents: { defaults: { workspace: "  /home/user/ws  " } } } };
    expect(resolveWorkspaceDir(api)).toBe("/home/user/ws");
  });
});

describe("register", () => {
  const originalFetch = globalThis.fetch;
  const originalDenchApiKey = process.env.DENCH_API_KEY;
  const originalDenchGatewayUrl = process.env.DENCH_GATEWAY_URL;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDenchApiKey !== undefined) {
      process.env.DENCH_API_KEY = originalDenchApiKey;
    } else {
      delete process.env.DENCH_API_KEY;
    }
    if (originalDenchGatewayUrl !== undefined) {
      process.env.DENCH_GATEWAY_URL = originalDenchGatewayUrl;
    } else {
      delete process.env.DENCH_GATEWAY_URL;
    }
  });

  it("hooks into before_prompt_build event when enabled", () => {
    const api = {
      config: { plugins: { entries: {} }, agents: { defaults: { workspace: "/ws" } } },
      on: vi.fn(),
    };
    register(api);
    expect(api.on).toHaveBeenCalledWith(
      "before_prompt_build",
      expect.any(Function),
      { priority: 100 },
    );
  });

  it("does not register handler when plugin is explicitly disabled (respects config)", () => {
    const api = {
      config: { plugins: { entries: { "dench-identity": { config: { enabled: false } } } } },
      on: vi.fn(),
    };
    register(api);
    expect(api.on).not.toHaveBeenCalled();
  });

  it("handler returns system context when workspace is configured", () => {
    const api = {
      config: { plugins: { entries: {} }, agents: { defaults: { workspace: "/ws" } } },
      on: vi.fn(),
    };
    register(api);

    const handler = api.on.mock.calls[0][1];
    const result = handler({}, {});
    expect(result).toEqual({
      prependSystemContext: expect.stringContaining("DenchClaw"),
    });
  });

  it("handler returns undefined when workspace is not configured (prevents empty prompt)", () => {
    const api = {
      config: { plugins: { entries: {} }, agents: { defaults: {} } },
      on: vi.fn(),
    };
    register(api);

    const handler = api.on.mock.calls[0][1];
    const result = handler({}, {});
    expect(result).toBeUndefined();
  });

  it("registers the Composio search tool when the managed skill exists", () => {
    const tmp = path.join(
      os.tmpdir(),
      `dench-identity-register-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(path.join(tmp, "skills", "composio-apps"), { recursive: true });
    writeFileSync(
      path.join(tmp, "skills", "composio-apps", "SKILL.md"),
      "# Dench Integrations connected apps\n",
      "utf-8",
    );

    const api = {
      config: { plugins: { entries: {} }, agents: { defaults: { workspace: tmp } } },
      on: vi.fn(),
      registerTool: vi.fn(),
    };

    register(api as any);

    expect(api.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "composio_search_tools" }),
    );

    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns a recommended GitHub PR tool through ranked search", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `dench-identity-resolver-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmp, { recursive: true });
    mockGatewaySearch({
      success: true,
      error: null,
      results: [
        {
          index: 1,
          use_case: "check my recent PRs",
          execution_guidance: "Use GITHUB_FIND_PULL_REQUESTS first.",
          difficulty: "easy",
          recommended_plan_steps: ["Find the recent pull requests."],
          known_pitfalls: [],
          primary_tool_slugs: ["GITHUB_FIND_PULL_REQUESTS"],
          related_tool_slugs: ["GITHUB_LIST_PULL_REQUESTS"],
          toolkits: ["github"],
        },
      ],
      toolkit_connection_statuses: [
        {
          toolkit: "github",
          has_active_connection: true,
          accounts: [],
        },
      ],
      tool_schemas: {
        GITHUB_FIND_PULL_REQUESTS: {
          toolkit: "github",
          tool_slug: "GITHUB_FIND_PULL_REQUESTS",
          description: "Find pull requests.",
          hasFullSchema: true,
          input_schema: {
            type: "object",
            properties: {},
          },
        },
      },
      session: {
        id: "trs_github_1",
        generate_id: true,
      },
    });

    const api = {
      config: { plugins: { entries: {} }, agents: { defaults: { workspace: tmp } } },
      on: vi.fn(),
      registerTool: vi.fn(),
    };

    register(api as any);

    const searchTool = getRegisteredTool(api as any, "composio_search_tools");
    const result = await executeTool(searchTool, {
      app: "github",
      query: "check my recent PRs",
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.recommended_result.tool).toBe("GITHUB_FIND_PULL_REQUESTS");
    expect(payload.recommended_result.dispatcher_tool).toBe("composio_call_tool");
    expect(payload.recommended_result.dispatcher_input.execution_ref).toEqual(expect.any(String));

    rmSync(tmp, { recursive: true, force: true });
  });

  it("searches across connected apps and ranks the best tool matches", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `dench-identity-search-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmp, { recursive: true });
    mockGatewaySearch({
      success: true,
      error: null,
      results: [
        {
          index: 1,
          use_case: "find billing subscriptions for a customer",
          execution_guidance: "Use STRIPE_LIST_SUBSCRIPTIONS first.",
          difficulty: "easy",
          recommended_plan_steps: ["List subscriptions."],
          known_pitfalls: [],
          primary_tool_slugs: ["STRIPE_LIST_SUBSCRIPTIONS"],
          related_tool_slugs: ["GITHUB_FIND_PULL_REQUESTS"],
          toolkits: ["stripe", "github"],
        },
      ],
      toolkit_connection_statuses: [
        { toolkit: "stripe", has_active_connection: true, accounts: [] },
        { toolkit: "github", has_active_connection: true, accounts: [] },
      ],
      tool_schemas: {
        STRIPE_LIST_SUBSCRIPTIONS: {
          toolkit: "stripe",
          tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
          description: "List Stripe subscriptions for billing analysis.",
          hasFullSchema: true,
          input_schema: { type: "object", properties: {} },
        },
        GITHUB_FIND_PULL_REQUESTS: {
          toolkit: "github",
          tool_slug: "GITHUB_FIND_PULL_REQUESTS",
          description: "Find GitHub pull requests.",
          hasFullSchema: true,
          input_schema: { type: "object", properties: {} },
        },
      },
      session: {
        id: "trs_multi_1",
        generate_id: true,
      },
    });

    const api = {
      config: { plugins: { entries: {} }, agents: { defaults: { workspace: tmp } } },
      on: vi.fn(),
      registerTool: vi.fn(),
    };

    register(api as any);

    const searchTool = getRegisteredTool(api as any, "composio_search_tools");
    const result = await executeTool(searchTool, {
      query: "find billing subscriptions for a customer",
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.result_count).toBeGreaterThan(0);
    expect(payload.recommended_result.tool).toBe("STRIPE_LIST_SUBSCRIPTIONS");
    expect(payload.recommended_result.dispatcher_tool).toBe("composio_call_tool");
    expect(payload.results[0].app).toBe("stripe");

    rmSync(tmp, { recursive: true, force: true });
  });

  it("uses gateway-backed Composio search results with full schemas and session dispatcher input", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `dench-identity-gateway-search-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      path.join(tmp, "composio-tool-index.json"),
      JSON.stringify({
        generated_at: "2026-04-03T00:00:00.000Z",
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
                description_short: "List Stripe subscriptions.",
                required_args: [],
                arg_hints: {},
              },
            ],
            recipes: {
              "List subscriptions": "STRIPE_LIST_SUBSCRIPTIONS",
            },
          },
        ],
      }),
      "utf-8",
    );

    process.env.DENCH_API_KEY = "dench-test-key";
    process.env.DENCH_GATEWAY_URL = "https://gateway.example.com";
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      expect(url).toBe("https://gateway.example.com/v1/composio/tool-router/search");
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify({
          success: true,
          error: null,
          results: [
            {
              index: 1,
              use_case: "list Stripe subscriptions for billing analysis",
              execution_guidance: "Use STRIPE_LIST_SUBSCRIPTIONS first and keep paginating when has_more is true.",
              difficulty: "easy",
              recommended_plan_steps: [
                "List subscriptions.",
                "Continue while has_more is true.",
              ],
              known_pitfalls: [
                "Do not stop after the first page when the user asked for all subscriptions.",
              ],
              primary_tool_slugs: ["STRIPE_LIST_SUBSCRIPTIONS"],
              related_tool_slugs: ["STRIPE_SEARCH_SUBSCRIPTIONS"],
              toolkits: ["stripe"],
            },
          ],
          toolkit_connection_statuses: [
            {
              toolkit: "stripe",
              description: "Stripe billing data",
              has_active_connection: true,
              status_message: "Stripe is connected.",
              accounts: [
                {
                  id: "acct_primary",
                  alias: "Primary Stripe",
                  is_default: true,
                  user_info: {
                    email: "ops@example.com",
                    name: "Primary Stripe",
                  },
                },
              ],
            },
          ],
          tool_schemas: {
            STRIPE_LIST_SUBSCRIPTIONS: {
              toolkit: "stripe",
              tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
              description: "List subscriptions.",
              hasFullSchema: true,
              execution_ref: "exec_stripe_trs_123",
              execution_ref_version: 1,
              input_schema: {
                type: "object",
                properties: {
                  limit: { type: "number" },
                  starting_after: { type: "string" },
                },
              },
            },
          },
          session: {
            id: "trs_123",
            generate_id: true,
          },
          next_steps_guidance: [
            "Reuse the same session_id for follow-up execution.",
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const api = {
      config: {
        plugins: {
          entries: {
            "dench-ai-gateway": {
              config: {
                gatewayUrl: "https://gateway.example.com",
              },
            },
          },
        },
        agents: { defaults: { workspace: tmp } },
      },
      on: vi.fn(),
      registerTool: vi.fn(),
    };

    register(api as any);

    const searchTool = getRegisteredTool(api as any, "composio_search_tools");
    const result = await executeTool(searchTool, {
      app: "stripe",
      query: "list Stripe subscriptions for billing analysis",
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.search_source).toBe("gateway_tool_router");
    expect(payload.search_session_id).toBe("trs_123");
    expect(payload.tool_schemas.STRIPE_LIST_SUBSCRIPTIONS.input_schema.properties.starting_after).toBeTruthy();
    expect(payload.recommended_result.dispatcher_input.execution_ref).toBe("exec_stripe_trs_123");
    expect(payload.recommended_result.account_selection_required).toBe(false);
    expect(payload.recommended_result.selected_account.account).toBe("acct_primary");
    expect(payload.recommended_result.recommended_plan_steps).toContain("Continue while has_more is true.");
    expect(payload.recommended_result.pagination_input_hints).toContain("starting_after");

    rmSync(tmp, { recursive: true, force: true });
  });

  it("requires account selection when multiple connected accounts match the same app", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `dench-identity-multi-account-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmp, { recursive: true });
    mockGatewaySearch({
      success: true,
      error: null,
      results: [
        {
          index: 1,
          use_case: "list subscriptions",
          execution_guidance: "Use STRIPE_LIST_SUBSCRIPTIONS.",
          difficulty: "easy",
          recommended_plan_steps: ["List subscriptions."],
          known_pitfalls: [],
          primary_tool_slugs: ["STRIPE_LIST_SUBSCRIPTIONS"],
          related_tool_slugs: [],
          toolkits: ["stripe"],
        },
      ],
      toolkit_connection_statuses: [
        {
          toolkit: "stripe",
          has_active_connection: true,
          accounts: [
            {
              id: "acct_prod",
              alias: "Prod Stripe",
              user_info: {
                email: "ops@example.com",
                name: "Prod Stripe",
              },
            },
            {
              id: "acct_test",
              alias: "Test Stripe",
              user_info: {
                email: "dev@example.com",
                name: "Test Stripe",
              },
            },
          ],
        },
      ],
      tool_schemas: {
        STRIPE_LIST_SUBSCRIPTIONS: {
          toolkit: "stripe",
          tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
          description: "List subscriptions.",
          hasFullSchema: true,
          input_schema: { type: "object", properties: {} },
        },
      },
      session: {
        id: "trs_account_select",
        generate_id: true,
      },
    });

    const api = {
      config: { plugins: { entries: {} }, agents: { defaults: { workspace: tmp } } },
      on: vi.fn(),
      registerTool: vi.fn(),
    };

    register(api as any);

    const searchTool = getRegisteredTool(api as any, "composio_search_tools");
    const result = await executeTool(searchTool, {
      app: "stripe",
      query: "list subscriptions",
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.recommended_result.account_selection_required).toBe(true);
    expect(payload.recommended_result.account_candidates).toHaveLength(2);
    expect(payload.instruction).toContain("which connected Stripe account");

    rmSync(tmp, { recursive: true, force: true });
  });

  it("forwards the selected account to gateway search while keeping dispatcher input opaque", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `dench-identity-selected-account-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmp, { recursive: true });
    process.env.DENCH_API_KEY = "dench-test-key";
    process.env.DENCH_GATEWAY_URL = "https://gateway.example.com";

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      expect(url).toBe("https://gateway.example.com/v1/composio/tool-router/search");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body ?? "{}"))).toMatchObject({
        account: "acct_prod",
      });
      return new Response(
        JSON.stringify({
          success: true,
          error: null,
          results: [
            {
              index: 1,
              use_case: "list Stripe subscriptions",
              execution_guidance: "Use STRIPE_LIST_SUBSCRIPTIONS.",
              difficulty: "easy",
              recommended_plan_steps: ["List subscriptions."],
              known_pitfalls: [],
              primary_tool_slugs: ["STRIPE_LIST_SUBSCRIPTIONS"],
              related_tool_slugs: [],
              toolkits: ["stripe"],
            },
          ],
          toolkit_connection_statuses: [
            {
              toolkit: "stripe",
              has_active_connection: true,
              accounts: [
                {
                  id: "acct_prod",
                  alias: "Prod Stripe",
                  user_info: {
                    email: "ops@example.com",
                    name: "Prod Stripe",
                  },
                },
                {
                  id: "acct_test",
                  alias: "Test Stripe",
                  user_info: {
                    email: "dev@example.com",
                    name: "Test Stripe",
                  },
                },
              ],
            },
          ],
          tool_schemas: {
            STRIPE_LIST_SUBSCRIPTIONS: {
              toolkit: "stripe",
              tool_slug: "STRIPE_LIST_SUBSCRIPTIONS",
              description: "List subscriptions.",
              hasFullSchema: true,
              execution_ref: "exec_stripe_selected",
              execution_ref_version: 1,
              input_schema: { type: "object", properties: {} },
            },
          },
          session: {
            id: "trs_acct_prod",
            generate_id: true,
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

    const api = {
      config: { plugins: { entries: {} }, agents: { defaults: { workspace: tmp } } },
      on: vi.fn(),
      registerTool: vi.fn(),
    };

    register(api as any);

    const searchTool = getRegisteredTool(api as any, "composio_search_tools");
    const result = await executeTool(searchTool, {
      app: "stripe",
      account: "acct_prod",
      query: "list Stripe subscriptions",
    });
    const payload = JSON.parse(result.content[0].text);
    const dispatcherInput = payload.recommended_result.dispatcher_input;

    expect(payload.recommended_result.account_selection_required).toBe(false);
    expect(payload.recommended_result.selected_account.account).toBe("acct_prod");
    expect(dispatcherInput.execution_ref).toBe("exec_stripe_selected");

    rmSync(tmp, { recursive: true, force: true });
  });

  it("asks for clarification when an explicit account hint does not match the connected account", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `dench-identity-account-hint-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmp, { recursive: true });
    mockGatewaySearch({
      success: true,
      error: null,
      results: [
        {
          index: 1,
          use_case: "read my recent email",
          execution_guidance: "Use GMAIL_FETCH_EMAILS.",
          difficulty: "easy",
          recommended_plan_steps: ["Fetch recent emails."],
          known_pitfalls: [],
          primary_tool_slugs: ["GMAIL_FETCH_EMAILS"],
          related_tool_slugs: [],
          toolkits: ["gmail"],
        },
      ],
      toolkit_connection_statuses: [
        {
          toolkit: "gmail",
          has_active_connection: true,
          accounts: [
            {
              id: "acct_gmail_work",
              alias: "Work Gmail",
              user_info: {
                email: "work@example.com",
                name: "Work Gmail",
              },
            },
          ],
        },
      ],
      tool_schemas: {
        GMAIL_FETCH_EMAILS: {
          toolkit: "gmail",
          tool_slug: "GMAIL_FETCH_EMAILS",
          description: "Fetch inbox messages.",
          hasFullSchema: true,
          input_schema: { type: "object", properties: {} },
        },
      },
      session: {
        id: "trs_gmail_1",
        generate_id: true,
      },
    });

    const api = {
      config: { plugins: { entries: {} }, agents: { defaults: { workspace: tmp } } },
      on: vi.fn(),
      registerTool: vi.fn(),
    };

    register(api as any);

    const searchTool = getRegisteredTool(api as any, "composio_search_tools");
    const result = await executeTool(searchTool, {
      app: "gmail",
      account: "personal",
      query: "read my recent email",
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.recommended_result.account_selection_required).toBe(true);
    expect(payload.recommended_result.account_candidates).toHaveLength(1);
    expect(payload.instruction).toContain("which connected Gmail account");

    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns a direct connect link when the requested app is not connected", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `dench-identity-resolver-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmp, { recursive: true });
    mockGatewaySearch({
      success: true,
      error: null,
      results: [],
      toolkit_connection_statuses: [
        {
          toolkit: "slack",
          has_active_connection: false,
          status_message: "Slack is not connected.",
          accounts: [],
        },
      ],
      next_steps_guidance: ["Connect Slack before trying again."],
      session: {
        id: "trs_connect_slack",
        generate_id: true,
      },
    });

    const api = {
      config: { plugins: { entries: {} }, agents: { defaults: { workspace: tmp } } },
      on: vi.fn(),
      registerTool: vi.fn(),
    };

    register(api as any);

    const searchTool = getRegisteredTool(api as any, "composio_search_tools");
    const result = await executeTool(searchTool, {
      app: "slack",
      query: "check my slack",
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.availability).toBe("connect_required");
    expect(payload.action_required).toBe("connect");
    expect(payload.toolkit_slug).toBe("slack");
    expect(payload.action_link_markdown).toBe("[Connect Slack](dench://composio/connect?toolkit=slack&name=Slack)");

    rmSync(tmp, { recursive: true, force: true });
  });
});
