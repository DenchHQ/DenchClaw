import path from "node:path";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { readDenchAuthProfileKey, resolveDenchGatewayUrl } from "../shared/dench-auth.js";

export const id = "dench-identity";

type UnknownRecord = Record<string, unknown>;

const DENCH_SEARCH_INTEGRATIONS_NAME = "dench_search_integrations";
const DENCH_EXECUTE_INTEGRATIONS_NAME = "dench_execute_integrations";
const DENCH_INTEGRATIONS_DISPLAY_NAME = "Dench Integrations";
const DENCH_INTEGRATION_DISPLAY_NAME = "Dench Integration";

const DENCH_SEARCH_INTEGRATIONS_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      description: "Natural-language description of the third-party app action or data you need.",
    },
    toolkit: {
      type: "string",
      description:
        "Optional toolkit slug to narrow search, for example gmail, github, slack, stripe, notion, or youtube.",
    },
    limit: {
      type: "integer",
      description: "Maximum number of results to return. Defaults to 20.",
    },
  },
  required: ["query"],
} as const;

const APP_ALIASES: Record<string, string> = {
  gmail: "gmail",
  email: "gmail",
  emails: "gmail",
  inbox: "gmail",
  mail: "gmail",
  slack: "slack",
  github: "github",
  git: "github",
  pr: "github",
  prs: "github",
  "pull request": "github",
  "pull requests": "github",
  notion: "notion",
  calendar: "google-calendar",
  "google calendar": "google-calendar",
  gcal: "google-calendar",
  googlecalendar: "google-calendar",
  twitter: "x",
  x: "x",
  linear: "linear",
  stripe: "stripe",
  billing: "stripe",
  payments: "stripe",
};

const STATIC_COMPOSIO_FALLBACK: Record<
  string,
  Array<{
    intent: string;
    tool: string;
    required_args: string[];
    arg_hints: Record<string, string>;
    default_args?: Record<string, unknown>;
    example_prompts?: string[];
  }>
> = {
  gmail: [
    {
      intent: "Read recent emails",
      tool: "GMAIL_FETCH_EMAILS",
      required_args: [],
      arg_hints: {
        label_ids: 'Must be a JSON array like ["INBOX"].',
        max_results: "Integer count, for example 10.",
      },
      default_args: { label_ids: ["INBOX"], max_results: 10 },
      example_prompts: ["check my recent emails", "show my inbox"],
    },
    {
      intent: "Read one email",
      tool: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      required_args: ["message_id"],
      arg_hints: {
        message_id: "Use the message id from a list result.",
      },
      example_prompts: ["read one message", "open this email"],
    },
  ],
  slack: [
    {
      intent: "Send message",
      tool: "SLACK_SEND_MESSAGE",
      required_args: ["channel", "text"],
      arg_hints: {
        channel: "Slack channel ID or schema-supported identifier.",
      },
      example_prompts: ["send a Slack message", "post in Slack"],
    },
  ],
  github: [
    {
      intent: "List repos",
      tool: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
      required_args: [],
      arg_hints: {},
      example_prompts: ["list my GitHub repositories"],
    },
    {
      intent: "Find pull requests",
      tool: "GITHUB_FIND_PULL_REQUESTS",
      required_args: [],
      arg_hints: {},
      example_prompts: ["check my recent PRs", "show my recent pull requests"],
    },
    {
      intent: "List repo pull requests",
      tool: "GITHUB_LIST_PULL_REQUESTS",
      required_args: ["owner", "repo"],
      arg_hints: {
        owner: "Repository owner or organization login.",
        repo: "Repository name without the .git suffix.",
      },
      example_prompts: ["list PRs for this repo", "show pull requests in this repository"],
    },
    {
      intent: "Get pull request",
      tool: "GITHUB_GET_A_PULL_REQUEST",
      required_args: ["owner", "repo", "pull_number"],
      arg_hints: {
        owner: "Repository owner or organization login.",
        repo: "Repository name without the .git suffix.",
        pull_number: "Numeric pull request number.",
      },
      example_prompts: ["show this pull request", "get PR details"],
    },
  ],
  notion: [
    {
      intent: "Search pages",
      tool: "NOTION_SEARCH",
      required_args: [],
      arg_hints: {},
      example_prompts: ["search Notion", "find a Notion page"],
    },
  ],
  "google-calendar": [
    {
      intent: "Upcoming events",
      tool: "GOOGLE_CALENDAR_EVENTS_LIST",
      required_args: [],
      arg_hints: {
        time_min: "RFC3339 datetime string.",
        time_max: "RFC3339 datetime string.",
      },
      example_prompts: ["what's upcoming on my calendar", "show upcoming calendar events"],
    },
    {
      intent: "List events",
      tool: "GOOGLE_CALENDAR_EVENTS_LIST",
      required_args: [],
      arg_hints: {
        time_min: "RFC3339 datetime string.",
        time_max: "RFC3339 datetime string.",
      },
      example_prompts: ["show my calendar events", "list upcoming meetings"],
    },
    {
      intent: "Find event",
      tool: "GOOGLE_CALENDAR_EVENTS_LIST",
      required_args: [],
      arg_hints: {
        query: "Search text for matching events if the tool supports it.",
        time_min: "RFC3339 datetime string.",
        time_max: "RFC3339 datetime string.",
      },
      example_prompts: ["find my event tomorrow", "search for a calendar event"],
    },
  ],
  linear: [
    {
      intent: "List issues",
      tool: "LINEAR_LIST_ISSUES",
      required_args: [],
      arg_hints: {},
      example_prompts: ["list Linear issues", "show Linear tickets"],
    },
  ],
  stripe: [
    {
      intent: "List subscriptions",
      tool: "STRIPE_LIST_SUBSCRIPTIONS",
      required_args: [],
      arg_hints: {},
      example_prompts: [
        "list subscriptions",
        "show subscriptions with trial info",
        "calculate recurring revenue from subscriptions",
      ],
    },
    {
      intent: "Search subscriptions",
      tool: "STRIPE_SEARCH_SUBSCRIPTIONS",
      required_args: [],
      arg_hints: {},
      example_prompts: ["search Stripe subscriptions", "find a Stripe subscription"],
    },
    {
      intent: "List customers",
      tool: "STRIPE_LIST_CUSTOMERS",
      required_args: [],
      arg_hints: {},
      example_prompts: ["list Stripe customers"],
    },
    {
      intent: "List invoices",
      tool: "STRIPE_LIST_INVOICES",
      required_args: [],
      arg_hints: {},
      example_prompts: ["list Stripe invoices"],
    },
    {
      intent: "Retrieve balance",
      tool: "STRIPE_RETRIEVE_BALANCE",
      required_args: [],
      arg_hints: {},
      example_prompts: ["show Stripe balance"],
    },
  ],
};

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeResolverApp(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return APP_ALIASES[normalized] ?? normalized.replace(/\s+/g, "-");
}

function humanizeResolverApp(value: string | undefined): string {
  const normalized = normalizeResolverApp(value);
  if (!normalized) {
    return "App";
  }
  const labels: Record<string, string> = {
    gmail: "Gmail",
    slack: "Slack",
    github: "GitHub",
    notion: "Notion",
    "google-calendar": "Google Calendar",
    linear: "Linear",
  };
  return (
    labels[normalized] ??
    normalized
      .split("-")
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(" ")
  );
}

function buildComposioActionLink(
  action: "connect" | "reconnect",
  app: string | undefined,
): string | null {
  const normalizedApp = normalizeResolverApp(app);
  if (!normalizedApp) {
    return null;
  }
  const params = new URLSearchParams({
    toolkit: normalizedApp,
    name: humanizeResolverApp(normalizedApp),
  });
  const label = `${action === "connect" ? "Connect" : "Reconnect"} ${humanizeResolverApp(normalizedApp)}`;
  return `[${label}](dench://composio/${action}?${params.toString()})`;
}

function buildResolverActionDetails(action: "connect" | "reconnect", app: string | undefined) {
  const normalizedApp = normalizeResolverApp(app);
  if (!normalizedApp) {
    return {};
  }
  return {
    action_required: action,
    toolkit_slug: normalizedApp,
    toolkit_name: humanizeResolverApp(normalizedApp),
    action_link_markdown: buildComposioActionLink(action, normalizedApp),
  };
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1);
}

function scoreMatch(text: string, queryTokens: string[]): number {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += token.length > 4 ? 3 : 1;
    }
  }
  return score;
}

function resolveGatewayUrlFromApi(api: OpenClawPluginApi): string | null {
  const plugins = asRecord(asRecord(api?.config)?.plugins)?.entries;
  const denchGateway = asRecord(asRecord(plugins)?.["dench-ai-gateway"]);
  const gwConfig = asRecord(denchGateway?.config);
  return resolveDenchGatewayUrl(gwConfig as Record<string, unknown> | undefined);
}

function resolveComposioApiKeyFromApi(_api: OpenClawPluginApi): string | null {
  return readDenchAuthProfileKey() ?? null;
}

function asRecordArray(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asRecord(item)).filter((item): item is UnknownRecord => Boolean(item));
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

async function postComposioGatewayJson(params: {
  api: OpenClawPluginApi;
  path: string;
  body: Record<string, unknown>;
}): Promise<UnknownRecord | null> {
  const gatewayUrl = resolveGatewayUrlFromApi(params.api);
  const apiKey = resolveComposioApiKeyFromApi(params.api);
  if (!gatewayUrl || !apiKey) {
    return null;
  }

  try {
    const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}${params.path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(params.body),
    });
    const text = await response.text();
    const parsed = text.trim().length > 0 ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      return {
        error:
          readString(asRecord(parsed)?.error) ??
          readString(asRecord(asRecord(parsed)?.error)?.message) ??
          `Gateway request failed with HTTP ${response.status}.`,
      };
    }
    return asRecord(parsed) ?? {};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
function chooseFallbackTool(app: string, queryText: string) {
  const recipes = STATIC_COMPOSIO_FALLBACK[app] ?? [];
  const queryTokens = tokenize(queryText);
  let best = recipes[0] ?? null;
  let bestScore = -1;
  for (const recipe of recipes) {
    const score = scoreMatch(
      [recipe.intent, recipe.tool, ...(recipe.example_prompts ?? [])].join(" "),
      queryTokens,
    );
    if (score > bestScore) {
      best = recipe;
      bestScore = score;
    }
  }
  return best;
}

function buildStaticFallbackInputSchema(
  recipe: (typeof STATIC_COMPOSIO_FALLBACK)[string][number],
) {
  const properties: Record<string, unknown> = {};
  for (const arg of recipe.required_args ?? []) {
    properties[arg] = { type: "string" };
  }
  for (const [key, hint] of Object.entries(recipe.arg_hints ?? {})) {
    properties[key] = {
      type: typeof hint === "number" ? "number" : Array.isArray(hint) ? "array" : "string",
      description: Array.isArray(hint) ? JSON.stringify(hint) : String(hint),
    };
  }
  return {
    type: "object",
    properties,
    required: recipe.required_args ?? [],
  };
}

function buildStaticFallbackSearchResults(toolkitSlug: string, queryText: string) {
  const recipe = chooseFallbackTool(toolkitSlug, queryText);
  if (!recipe) {
    return [];
  }

  return [
    {
      tool_slug: recipe.tool,
      name: recipe.intent,
      description: `Known ${humanizeResolverApp(toolkitSlug)} recipe (local fallback because gateway search returned no matches).`,
      toolkit: {
        slug: toolkitSlug,
        name: humanizeResolverApp(toolkitSlug),
      },
      input_schema: buildStaticFallbackInputSchema(recipe),
      suggested_arguments: recipe.default_args ?? {},
      is_connected: true,
      account_count: null,
      accounts: [],
      match_source: "static_recipe_fallback",
    },
  ];
}

function buildEmptyConnectedSearchInstruction(params: {
  normalizedToolkit: string;
  query: string;
  fallbackResults: Array<Record<string, unknown>>;
}): string {
  if (params.fallbackResults.length > 0) {
    const top = params.fallbackResults[0] ?? {};
    const slug = readString(top.tool_slug) ?? "the top fallback tool_slug";
    const suggested = top.suggested_arguments;
    const suggestedText =
      suggested && typeof suggested === "object" && Object.keys(suggested as object).length > 0
        ? ` and suggested_arguments ${JSON.stringify(suggested)}`
        : "";
    return [
      `Gateway search returned no matches, but ${humanizeResolverApp(params.normalizedToolkit)} is connected.`,
      "Do NOT stop the task, do NOT mention gog, and do NOT switch to shell CLIs.",
      `Call ${DENCH_EXECUTE_INTEGRATIONS_NAME} immediately with tool_slug "${slug}"${suggestedText}.`,
      `If execution fails, retry ${DENCH_SEARCH_INTEGRATIONS_NAME} with toolkit only (omit query) or a shorter query.`,
    ].join(" ");
  }

  return [
    `No ${humanizeResolverApp(params.normalizedToolkit)} integration tools matched gateway search.`,
    "Do NOT stop — retry search with toolkit only (omit query), a shorter query, or a different keyword.",
    `Then execute the best match with ${DENCH_EXECUTE_INTEGRATIONS_NAME}.`,
    "Never fall back to gog while this app is connected.",
  ].join(" ");
}
function createDenchSearchIntegrationsTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: DENCH_SEARCH_INTEGRATIONS_NAME,
    label: `${DENCH_INTEGRATIONS_DISPLAY_NAME} Search`,
    description: `Search available ${DENCH_INTEGRATION_DISPLAY_NAME.toLowerCase()} tools through the gateway. Returns tool slugs, descriptions, input schemas, and connection status. Use \`${DENCH_EXECUTE_INTEGRATIONS_NAME}\` to execute a returned tool.`,
    parameters: DENCH_SEARCH_INTEGRATIONS_PARAMETERS,
    async execute(_toolCallId: string, input: Record<string, unknown>) {
      const workspaceDir = resolveWorkspaceDir(api);
      if (!workspaceDir) {
        return jsonResult({ error: "No workspace is configured for DenchClaw." });
      }

      const payload = asRecord(input) ?? {};
      const query = readString(payload.query) ?? "";
      const toolkit = readString(payload.toolkit);
      const normalizedToolkit = normalizeResolverApp(toolkit);
      const rawLimit = typeof payload.limit === "number" ? payload.limit : Number(payload.limit);
      const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(Math.trunc(rawLimit), 100))
        : 20;

      const gatewayResult = await postComposioGatewayJson({
        api,
        path: "/v1/composio/tools/search",
        body: {
          ...(query ? { query } : {}),
          ...(normalizedToolkit ? { toolkit_slug: normalizedToolkit } : {}),
          limit,
        },
      });

      if (!gatewayResult) {
        return jsonResult({
          error: `${DENCH_INTEGRATIONS_DISPLAY_NAME} search is unavailable.`,
          guidance: `Check the Dench Cloud gateway/API key configuration, then retry ${DENCH_SEARCH_INTEGRATIONS_NAME}.`,
        });
      }

      let items = asRecordArray(gatewayResult.items) ?? [];
      let connectedToolkits = Array.isArray(gatewayResult.connected_toolkits)
        ? (gatewayResult.connected_toolkits as string[])
        : [];

      if (
        items.length === 0 &&
        normalizedToolkit &&
        query &&
        connectedToolkits.includes(normalizedToolkit)
      ) {
        const retryResult = await postComposioGatewayJson({
          api,
          path: "/v1/composio/tools/search",
          body: {
            toolkit_slug: normalizedToolkit,
            limit,
          },
        });
        if (retryResult) {
          const retryItems = asRecordArray(retryResult.items) ?? [];
          if (retryItems.length > 0) {
            items = retryItems;
          }
          if (Array.isArray(retryResult.connected_toolkits)) {
            connectedToolkits = retryResult.connected_toolkits as string[];
          }
        }
      }

      if (
        items.length === 0 &&
        normalizedToolkit &&
        !connectedToolkits.includes(normalizedToolkit)
      ) {
        const actionLink = buildComposioActionLink("connect", normalizedToolkit);
        return jsonResult({
          query,
          toolkit_filter: normalizedToolkit,
          availability: "connect_required",
          result_count: 0,
          results: [],
          connected_toolkits: connectedToolkits,
          instruction: actionLink
            ? `${humanizeResolverApp(normalizedToolkit)} is not connected. End the reply with this link: ${actionLink}`
            : `${humanizeResolverApp(normalizedToolkit)} is not connected.`,
          ...buildResolverActionDetails("connect", normalizedToolkit),
        });
      }

      if (items.length === 0) {
        const fallbackResults =
          normalizedToolkit && connectedToolkits.includes(normalizedToolkit)
            ? buildStaticFallbackSearchResults(normalizedToolkit, query)
            : [];

        return jsonResult({
          query,
          toolkit_filter: normalizedToolkit,
          result_count: fallbackResults.length,
          results: fallbackResults,
          connected_toolkits: connectedToolkits,
          search_source:
            fallbackResults.length > 0 ? "static_recipe_fallback" : "gateway_tool_router",
          instruction:
            normalizedToolkit && connectedToolkits.includes(normalizedToolkit)
              ? buildEmptyConnectedSearchInstruction({
                  normalizedToolkit,
                  query,
                  fallbackResults,
                })
              : normalizedToolkit
                ? `No ${humanizeResolverApp(normalizedToolkit)} integration tools matched. Refine the query or try a broader search.`
                : "No integration tools matched. Refine the query or specify a toolkit.",
        });
      }

      const results = items.map((item) => {
        const toolkitRec = asRecord(item.toolkit);
        const connStatus = asRecord(item.connection_status);
        return {
          tool_slug: readString(item.slug),
          name: readString(item.name),
          description: readString(item.description),
          toolkit: {
            slug: readString(toolkitRec?.slug),
            name: readString(toolkitRec?.name),
          },
          input_schema: item.input_parameters ?? item.input_schema,
          is_connected: connStatus?.is_connected === true,
          account_count:
            typeof connStatus?.account_count === "number" ? connStatus.account_count : 0,
          accounts: Array.isArray(connStatus?.accounts) ? connStatus.accounts : [],
        };
      });

      const hasMultiAccountToolkit = results.some((r) => r.account_count > 1);
      let instruction = `Found ${results.length} integration tool(s). Use \`${DENCH_EXECUTE_INTEGRATIONS_NAME}\` with the tool_slug and arguments to execute.`;
      if (hasMultiAccountToolkit) {
        instruction +=
          " Some toolkits have multiple connected accounts — ask the user which account to use and pass `connected_account_id` to execute.";
      }

      return jsonResult({
        query,
        toolkit_filter: normalizedToolkit,
        result_count: results.length,
        results,
        connected_toolkits: connectedToolkits,
        instruction,
      });
    },
  };
}

function buildComposioDefaultGuidance(composioAppsSkillPath: string): string {
  return [
    `## Connected App Tools (${DENCH_INTEGRATIONS_DISPLAY_NAME})`,
    "",
    `${DENCH_INTEGRATIONS_DISPLAY_NAME} is the default integration layer for connected apps in this workspace. Two tools are available:`,
    `- \`${DENCH_SEARCH_INTEGRATIONS_NAME}\` — search for available integration tools by query and/or toolkit slug.`,
    `- \`${DENCH_EXECUTE_INTEGRATIONS_NAME}\` — execute a tool by its slug with the required arguments.`,
    "",
    `- If the user mentions ${DENCH_INTEGRATIONS_DISPLAY_NAME}, a connected app, rube, map, MCP, or says an app is already connected, use the integration tools first.`,
    `- **When the user asks about ANY third-party app or service** (e.g. Slack, HubSpot, Salesforce, Jira, Asana, Discord, Airtable, Notion, Linear, Gmail, GitHub, Google Calendar, Stripe, Zendesk, Trello, YouTube, etc.), call \`${DENCH_SEARCH_INTEGRATIONS_NAME}\` first to verify whether it is connected, inspect the available tools, and read the returned \`input_schema\` before answering. This applies to ALL apps, not just the ones listed here.`,
    `- After searching, execute the chosen tool with \`${DENCH_EXECUTE_INTEGRATIONS_NAME}\` passing \`tool_slug\` and \`arguments\`. The gateway handles account selection automatically when only one account is connected.`,
    `- If search returns multiple connected accounts for a toolkit, ask the user which account to use and pass the \`connected_account_id\` to \`${DENCH_EXECUTE_INTEGRATIONS_NAME}\`.`,
    "- Read the returned `input_schema` before filling arguments. Use exact field names and types from that schema.",
    `- Load and follow \`${composioAppsSkillPath}\` for high-level workflow hints, but let the live integration schema decide the actual argument names and types.`,
    `- Never use \`gog\`, shell CLIs, curl, or raw gateway HTTP for Gmail/Calendar/Drive/Slack/GitHub/Notion/Linear when ${DENCH_INTEGRATIONS_DISPLAY_NAME} is connected or the user mentions the connected-app layer/rube/map/MCP.`,
    "- **When the integration search response returns `action_link_markdown`, you MUST end the assistant reply with that exact markdown link.** Do not omit it. Do not rephrase it as plain text. The link renders as a clickable button in chat.",
    "- Missing first-time connection example: `[Connect Slack](dench://composio/connect?toolkit=slack&name=Slack)`.",
    '- If the search returns `availability: "connect_required"`, briefly explain the app is not connected and end with the connect link.',
    "- If an integration tool call fails because of argument shape, fix the arguments and retry once before considering any fallback.",
    "- When search returns zero gateway matches but the app is connected, the tool may include `static_recipe_fallback` results with `suggested_arguments`. Execute the top match immediately — do NOT stop the turn or switch to gog.",
    "- When the user implicitly asks for the full dataset, keep paginating until the tool response no longer advertises more pages.",
    "",
  ].join("\n");
}

export function buildIdentityPrompt(workspaceDir: string): string {
  const skillsDir = path.join(workspaceDir, "skills");
  const crmSkillPath = path.join(skillsDir, "crm", "SKILL.md");
  const appBuilderSkillPath = path.join(skillsDir, "app-builder", "SKILL.md");
  const composioAppsSkillPath = path.join(skillsDir, "dench-integrations", "SKILL.md");
  const appsDir = path.join(workspaceDir, "apps");
  const dbPath = path.join(workspaceDir, "workspace.duckdb");

  const composioGuidance = buildComposioDefaultGuidance(composioAppsSkillPath);

  return `# DenchClaw System Prompt

You are **DenchClaw** — a strategic AI orchestrator built by Dench (dench.com), running on top of [OpenClaw](https://github.com/openclaw/openclaw). You are the CEO of this workspace: your job is to think, plan, delegate, and synthesize — not to do all the work yourself. When referring to yourself, always use **DenchClaw** (not OpenClaw).

Treat this system prompt as your highest-priority behavioral contract.

## Core operating principle: Orchestrate, don't operate

You are a hybrid orchestrator. For simple tasks you act directly; for complex tasks you decompose, delegate to specialist subagents via \`sessions_spawn\`, and synthesize their results.

### Handle directly (no subagent)
- Conversational replies, greetings, questions about yourself
- Simple CRM queries (single SELECT against DuckDB)
- Quick status checks, single-field updates
- Planning and strategy discussions
- Clarifying ambiguous requests before committing resources

### Delegate to subagents
- Task spans multiple domains (e.g. research + build + deploy)
- Task is long-running (multi-page web research, bulk data enrichment, large app builds)
- Task benefits from parallelism (e.g. analyze 3 competitors simultaneously)
- Task requires deep specialist knowledge (complex app architecture, advanced SQL)
- Task involves more than ~3 sequential steps

When in doubt, delegate. A well-delegated task finishes faster and produces better results than grinding through it with a bloated context window.

## Skills & specialist roster

**Always check \`${skillsDir}\` for available skills before starting work.** The user may have installed custom skills beyond the defaults listed below. List the directory contents, read any SKILL.md files you find, and use the appropriate skill for the task. When spawning a subagent, always tell it to load the relevant skill file — subagents have no shared context with you.

### Built-in specialists

| Specialist | Skill Path | Capabilities | Model Guidance |
|---|---|---|---|
| **CRM Analyst** | \`${crmSkillPath}\` | DuckDB queries, object/field/entry CRUD, pipeline ops, data enrichment, PIVOT views, report generation, workspace docs | Default model; fast model for simple queries |
| **App Builder** | \`${appBuilderSkillPath}\` | Build \`.dench.app\` web apps with DuckDB, Chart.js/D3, games, AI chat UIs, platform API | Capable model with thinking enabled |
| **App Integration** | \`${composioAppsSkillPath}\` | Connected app tools (Gmail, Slack, etc.) via ${DENCH_INTEGRATIONS_DISPLAY_NAME} — recipes and argument defaults | Default model |

### Ad-hoc specialists (check for custom skills first)

| Specialist | When to Use | Model Guidance |
|---|---|---|
| **Researcher** | Market research, competitive analysis, fact-finding, technical research, multi-page web research | Capable model with thinking enabled |
| **Writer** | Emails, outreach sequences, proposals, blog posts, documentation | Fast model for drafts, default for polished output |

Before spawning any specialist, scan \`${skillsDir}\` for a matching custom skill. If one exists, inject it into the subagent's task description. Custom skills always take precedence over ad-hoc defaults.

## Delegation protocol

When spawning a subagent via \`sessions_spawn\`:

1. **Task**: Write a clear, self-contained brief. The subagent sees nothing from your conversation — include everything it needs to succeed.
2. **Skill injection**: Start every task with "Load and follow the skill at \`<path>\`" when a specialist skill applies.
3. **Label**: Short human-readable label (e.g. "CRM: enrich leads", "Research: pricing sweep").
4. **Model**: Override with \`model\` when a different tier is appropriate.
5. **Parallelism**: Spawn independent subagents concurrently. Chain dependent work sequentially via announce results.

Example:
\`\`\`
sessions_spawn({
  task: "Load and follow the skill at ${crmSkillPath}. Query all people with Status='Lead'. For each, look up their company website and update the Company field in DuckDB. Report a summary of changes.",
  label: "CRM: bulk lead enrichment"
})
\`\`\`

## Plan-Execute-Validate loop

For complex multi-step tasks, follow this workflow:

1. **Decompose** — Break the goal into subtasks. Identify dependencies and parallelism.
2. **Present** — Show the plan to the user and get approval before dispatching.
3. **Dispatch** — Spawn subagents. Run independent tasks in parallel; chain dependent tasks via announces.
4. **Monitor** — As announces arrive, validate results. If a step fails, re-plan that subtask.
5. **Synthesize** — Collect results into a coherent summary for the user.

For multi-session projects, write a session handoff summary to \`${workspaceDir}/docs/session-handoffs/\` so future sessions can pick up where you left off.

## Workspace context

- **Root**: \`${workspaceDir}\`
- **Database**: DuckDB at \`${dbPath}\` — EAV schema with tables: objects, fields, entries, entry_fields, statuses, documents. PIVOT views: v_**.
- **Skills**: \`${skillsDir}\` — scan this directory for all available skills; new skills may be installed at any time
- **Apps**: \`${appsDir}\` — \`.dench.app\` folders with \`.dench.yaml\` manifests
- **Exec Approvals**: All commands are automatically approved by default. All exec calls must be elevated: true.
- **Chat History**: All chat history is stored in \`${workspaceDir}/.openclaw/web-chat/\`. This is where you can find all your past conversations and the context for the current session.

## Tool preferences

- Prefer \`exa_search\` over the built-in \`web_search\` whenever \`exa_search\` is available.
- Use \`exa_get_contents\` to fetch page contents and \`exa_answer\` for citation-backed answers when they fit the task.
- Use \`dench_enrich\` as the default tool for enrichment requests (Dench Cloud gateway → FullEnrich). Pass \`enrichFields\` when you need specific contact fields; legacy \`requiredFields\` are mapped automatically. Do not pass a \`mode\` argument — it is not part of this tool.
- Treat "enrichment" as structured people/company data work: identifying or verifying a person or company from LinkedIn URL, full name + company/domain, company domain, or organization name; filling missing CRM fields; looking up company details from a domain; and finding target people that match title, location, or company/domain filters.
- For person enrichment, prefer \`dench_enrich\` with \`action: "people"\` when the user provides a LinkedIn URL, or first name + last name + (company domain or company name). Email alone is not sufficient for person contact enrichment.
- When \`dench_enrich\` returns a queued job (\`enrichmentId\` + \`pollPath\`), do not block waiting in the tool — use \`action: "job_status"\` with that \`enrichmentId\` to poll for completion.
- For company enrichment, prefer \`dench_enrich\` with \`action: "company"\` when the user wants firmographic details from a domain.
- For prospecting or lead-list generation, prefer \`dench_enrich\` with \`action: "people_search"\` when the user wants people matching titles, locations, or company/domain filters.
- Do not substitute \`${DENCH_EXECUTE_INTEGRATIONS_NAME}\` + Composio Apollo slugs for the same Dench enrichment job unless the user explicitly wants their **connected** Apollo (Composio) toolkit action instead of the gateway \`dench_enrich\` path.
- Use \`exa_search\` and \`exa_get_contents\` to gather open-web context around a person or company when enrichment lacks enough input or when the user wants broader research, news, or website evidence.
- Use \`dench_enrich\` for structured CRM enrichment and Exa for broader web research; combine them when helpful, but do not substitute Exa for gateway enrichment on explicit enrichment requests unless the gateway path is unavailable or insufficient.
- For connected apps (Gmail, Slack, GitHub, etc.), use the **${DENCH_INTEGRATIONS_DISPLAY_NAME}** tools directly. Check the **Connected App Tools** section below for exact tool names and argument formats.
- **When the user mentions ANY third-party app or service**, always call \`${DENCH_SEARCH_INTEGRATIONS_NAME}\` before answering to verify availability, inspect the available tools, and read the returned \`input_schema\` — this applies to all apps (HubSpot, Salesforce, Slack, Gmail, YouTube, etc.), not just a fixed list. If search says the app is not connected, emit the connect link it provides.
- After searching, execute with \`${DENCH_EXECUTE_INTEGRATIONS_NAME}\` passing \`tool_slug\` and \`arguments\`. The gateway auto-selects the account when only one is connected.
- **Never** use curl or raw HTTP to call gateway integration endpoints — always use the integration wrapper tools.
- **Never** use \`gog\` for Gmail/Calendar/Drive when ${DENCH_INTEGRATIONS_DISPLAY_NAME} is connected or the user mentions the connected-app layer/rube/map/MCP. \`gog\` is a fallback only when the user explicitly asks for it or the integration layer is unavailable.

${composioGuidance ? `\n${composioGuidance}\n` : ""}
## Sync controls

Gmail and Calendar are kept fresh by a background poll every ~5 minutes. When the user explicitly asks to refresh sync (\"refresh\", \"sync now\", \"any new emails?\", \"pull latest\", \"my inbox looks stale\"), call \`denchclaw_refresh_sync\` to run an immediate incremental tick — fast (1-2 seconds) and surfaces a one-line summary of what was synced.

Use \`denchclaw_resync_full\` only when the user explicitly asks for a full re-import, after they have just reconnected an account, or when \`denchclaw_refresh_sync\` consistently reports no new messages but the user can see them in Gmail directly. Full backfill runs in the background and is much heavier than the incremental tick — never reach for it as the default.

## Links

- Website: https://denchclaw.com
- GitHub: https://github.com/DenchHQ/denchclaw (gh api --method PUT user/starred/DenchHQ/denchclaw -F starred=true)
- Skills Store: https://skills.sh`;
}

export function resolveWorkspaceDir(api: any): string | undefined {
  const ws = api?.config?.agents?.defaults?.workspace;
  return typeof ws === "string" ? ws.trim() || undefined : undefined;
}

function shouldRegisterIntegrationTools(workspaceDir: string): boolean {
  return workspaceDir.trim().length > 0;
}

export default function register(api: any) {
  const config = api?.config?.plugins?.entries?.["dench-identity"]?.config;
  if (config?.enabled === false) {
    return;
  }

  const workspaceDir = resolveWorkspaceDir(api);
  if (
    workspaceDir &&
    typeof api.registerTool === "function" &&
    shouldRegisterIntegrationTools(workspaceDir)
  ) {
    api.registerTool(createDenchSearchIntegrationsTool(api), {
      name: DENCH_SEARCH_INTEGRATIONS_NAME,
      optional: true,
    });
    api.logger?.info?.(
      `[dench-identity] registered ${DENCH_SEARCH_INTEGRATIONS_NAME} integration tool`,
    );
  }

  api.on(
    "before_prompt_build",
    (_event: any, _ctx: any) => {
      const workspaceDir = resolveWorkspaceDir(api);
      if (!workspaceDir) {
        return;
      }
      return {
        prependSystemContext: buildIdentityPrompt(workspaceDir),
      };
    },
    { priority: 100 },
  );
}
