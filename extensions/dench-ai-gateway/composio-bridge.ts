import type { AnyAgentTool } from "openclaw/plugin-sdk";
import { readDenchAuthProfileKey } from "../shared/dench-auth.js";
import { buildComposioMcpServerConfig } from "./config-patch.js";

type UnknownRecord = Record<string, unknown>;

type ComposioToolCallResult = {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
};

const COMPOSIO_CALL_TOOL_NAME = "composio_call_tool";
const DENCH_INTEGRATIONS_DISPLAY_NAME = "Dench Integrations";
const DENCH_INTEGRATION_DISPLAY_NAME = "Dench Integration";

const COMPOSIO_CALL_TOOL_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    execution_ref: {
      type: "string",
      description: "Opaque gateway-issued execution ref returned by composio_search_tools. Required for execution.",
    },
    arguments: {
      type: "object",
      additionalProperties: true,
      description: "JSON arguments object for the underlying integration tool call.",
      properties: {},
    },
  },
  required: ["execution_ref"],
} as const;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function postDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  // #region agent log
  fetch("http://127.0.0.1:7651/ingest/93e0c293-34f1-4a69-8fce-870fc1b93fcb", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "822d38",
    },
    body: JSON.stringify({
      sessionId: "822d38",
      runId: "dench-ai-gateway",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readGatewayError(value: unknown): string | undefined {
  return readString(value) ?? readString(asRecord(value)?.message);
}

function decodeExecutionRefPayload(executionRef: string | undefined): UnknownRecord | undefined {
  const trimmed = executionRef?.trim();
  if (!trimmed) {
    return undefined;
  }
  const [payloadSegment] = trimmed.split(".", 1);
  if (!payloadSegment) {
    return undefined;
  }
  try {
    const normalized = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return asRecord(JSON.parse(decoded));
  } catch {
    return undefined;
  }
}

function extractGatewayExecutionMetadata(
  payload: UnknownRecord | undefined,
  fallbacks: {
    executionRef?: string;
  } = {},
) {
  const decodedExecutionRef = decodeExecutionRefPayload(fallbacks.executionRef);
  return {
    mode: readString(payload?.execution_mode) ?? readString(decodedExecutionRef?.mode) ?? "gateway_tool_router",
    toolName: readString(payload?.tool_slug) ?? readString(decodedExecutionRef?.tool_slug),
    toolRouterSessionId:
      readString(payload?.tool_router_session_id) ?? readString(decodedExecutionRef?.session_id),
    toolkit: readString(payload?.toolkit) ?? readString(decodedExecutionRef?.toolkit),
    account:
      readString(payload?.account)
      ?? readString(decodedExecutionRef?.account)
      ?? readString(decodedExecutionRef?.connected_account_id),
    logId: readString(payload?.log_id),
    executionRefVersion:
      readNumber(payload?.execution_ref_version) ?? readNumber(decodedExecutionRef?.version),
    executionRef: fallbacks.executionRef,
  };
}

function jsonResult(payload: unknown, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: details ?? payload,
  };
}

function normalizeToolkitSlug(value: string): string {
  return value.trim().toLowerCase();
}

function toolkitSlugToToolPrefix(slug: string): string {
  return normalizeToolkitSlug(slug).toUpperCase().replace(/-/g, "_") + "_";
}

function buildToolCallUrl(baseUrl: string, connectedAccountId?: string): string {
  if (!connectedAccountId) {
    return baseUrl;
  }
  const url = new URL(baseUrl);
  url.searchParams.set("connected_account_id", connectedAccountId);
  return url.toString();
}

function resolveWorkspaceDir(api: any): string | undefined {
  const ws = api?.config?.agents?.defaults?.workspace;
  return typeof ws === "string" ? ws.trim() || undefined : undefined;
}

function resolveAuthorizationHeader(headers: unknown): string | undefined {
  const rec = asRecord(headers);
  return readString(rec?.Authorization) ?? readString(rec?.authorization);
}

function stripRuntimeComposioServer(api: any): { url?: string; authorization?: string } | null {
  const rootConfig = asRecord(api?.config);
  const mcp = asRecord(rootConfig?.mcp);
  const servers = asRecord(mcp?.servers);
  if (!rootConfig || !mcp || !servers) {
    return null;
  }
  const composio = asRecord(servers?.composio);
  if (!composio) {
    return null;
  }

  const captured = {
    url: readString(composio.url),
    authorization: resolveAuthorizationHeader(composio.headers),
  };

  delete servers.composio;
  if (Object.keys(servers).length === 0) {
    delete mcp.servers;
  }
  if (mcp && Object.keys(mcp).length === 0) {
    delete rootConfig.mcp;
  }

  return captured;
}

function resolveConfiguredApiKey(_api: any): string | undefined {
  return readDenchAuthProfileKey();
}

function resolveComposioServerConfig(api: any, fallbackGatewayUrl: string) {
  const stripped = stripRuntimeComposioServer(api);
  const apiKey = resolveConfiguredApiKey(api);
  if (stripped?.url) {
    return {
      url: stripped.url,
      authorization: stripped.authorization ?? (apiKey ? `Bearer ${apiKey}` : undefined),
    };
  }

  if (!apiKey) {
    return null;
  }

  const config = buildComposioMcpServerConfig(fallbackGatewayUrl, apiKey);
  return {
    url: config.url,
    authorization: config.headers.Authorization,
  };
}

function resolveGatewayBaseUrl(mcpUrl: string, fallbackGatewayUrl: string): string {
  const trimmedMcpUrl = mcpUrl.trim().replace(/\/$/, "");
  const fromMcp = trimmedMcpUrl.replace(/\/v1\/composio\/mcp(?:\?.*)?$/u, "");
  if (fromMcp && fromMcp !== trimmedMcpUrl) {
    return fromMcp;
  }
  return fallbackGatewayUrl.trim().replace(/\/$/, "");
}

function extractPaginationState(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const keys = [
    "has_more",
    "next_cursor",
    "next_page",
    "starting_after",
    "ending_before",
    "page",
    "page_info",
  ];
  const pagination = Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(record, key))
      .map((key) => [key, record[key]]),
  );
  return Object.keys(pagination).length > 0 ? pagination : undefined;
}

function classifyComposioExecutionFailure(value: unknown): string | undefined {
  const text = readString(value)?.toLowerCase();
  if (!text) {
    return undefined;
  }
  if (text.includes("connect") || text.includes("no active connection")) {
    return "connection_issue";
  }
  if (text.includes("account") || text.includes("multi-account")) {
    return "account_issue";
  }
  if (text.includes("session")) {
    return "session_issue";
  }
  if (
    text.includes("argument")
    || text.includes("input")
    || text.includes("schema")
    || text.includes("required")
    || text.includes("invalid")
  ) {
    return "schema_issue";
  }
  return "execution_issue";
}

function readGatewayConnectionRecords(payload: unknown): UnknownRecord[] {
  const direct = Array.isArray(payload)
    ? payload.filter((item): item is UnknownRecord => Boolean(asRecord(item)))
    : [];
  if (direct.length > 0) {
    return direct;
  }
  const record = asRecord(payload);
  const items = Array.isArray(record?.items)
    ? record.items.filter((item): item is UnknownRecord => Boolean(asRecord(item)))
    : [];
  if (items.length > 0) {
    return items;
  }
  return Array.isArray(record?.connections)
    ? record.connections.filter((item): item is UnknownRecord => Boolean(asRecord(item)))
    : [];
}

function readGatewayConnectionToolkitSlug(connection: UnknownRecord): string | undefined {
  return readString(connection.toolkit_slug ?? asRecord(connection.toolkit)?.slug)?.trim().toLowerCase();
}

function readGatewayConnectionStableIdentity(connection: UnknownRecord): string | undefined {
  const account = asRecord(connection.account);
  return readString(
    connection.account_stable_id
      ?? account?.stableId
      ?? connection.account_email
      ?? account?.email
      ?? connection.account_name
      ?? connection.account_label
      ?? connection.id,
  )?.trim();
}

function matchesGatewayConnectionSelection(connection: UnknownRecord, requestedAccount: string): boolean {
  const normalized = requestedAccount.trim().toLowerCase();
  return [
    readString(connection.connectionId),
    readString(connection.id),
    readString(connection.account_stable_id),
    readString(connection.account_label),
    readString(connection.account_name),
    readString(connection.account_email),
    readString(asRecord(connection.account)?.stableId),
    readString(asRecord(connection.account)?.label),
    readString(asRecord(connection.account)?.email),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .some((value) => value.trim().toLowerCase() === normalized);
}

async function fetchGatewayActiveConnectionsForToolkit(params: {
  gatewayBaseUrl: string;
  authorization?: string;
  app: string;
}): Promise<UnknownRecord[] | null> {
  try {
    const response = await fetch(`${params.gatewayBaseUrl}/v1/composio/connections`, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(params.authorization ? { authorization: params.authorization } : {}),
      },
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json() as unknown;
    const toolkit = normalizeToolkitSlug(params.app);
    return readGatewayConnectionRecords(payload).filter((connection) =>
      readGatewayConnectionToolkitSlug(connection) === toolkit
      && readString(connection.status)?.trim().toUpperCase() === "ACTIVE"
    );
  } catch {
    return null;
  }
}

function resolveGatewayMcpFallbackSelection(params: {
  activeConnections: UnknownRecord[];
  requestedAccount?: string;
}): {
  canFallback: boolean;
  activeConnectionCount: number;
  connectedAccountId?: string;
  accountIdentity?: string;
} {
  const { activeConnections } = params;
  if (activeConnections.length === 0) {
    return {
      canFallback: false,
      activeConnectionCount: 0,
    };
  }
  if (params.requestedAccount?.trim()) {
    const match = activeConnections.find((connection) =>
      matchesGatewayConnectionSelection(connection, params.requestedAccount ?? ""),
    );
    if (!match) {
      return {
        canFallback: false,
        activeConnectionCount: activeConnections.length,
      };
    }
    return {
      canFallback: true,
      activeConnectionCount: activeConnections.length,
      connectedAccountId: readString(match.connectionId ?? match.id)?.trim(),
      accountIdentity: readGatewayConnectionStableIdentity(match),
    };
  }
  if (activeConnections.length !== 1) {
    return {
      canFallback: false,
      activeConnectionCount: activeConnections.length,
    };
  }
  const [connection] = activeConnections;
  return {
    canFallback: true,
    activeConnectionCount: 1,
    connectedAccountId: readString(connection?.connectionId ?? connection?.id)?.trim(),
    accountIdentity: connection ? readGatewayConnectionStableIdentity(connection) : undefined,
  };
}

function extractToolCallResultFromJsonRpcMessage(payload: unknown): ComposioToolCallResult | null {
  const rec = asRecord(payload);
  const result = asRecord(rec?.result);
  if (!result) {
    return null;
  }

  const content = Array.isArray(result.content) ? result.content : undefined;
  const structuredContent = result.structuredContent;
  const hasStructuredContent = Object.hasOwn(result, "structuredContent");
  const isError = result.isError === true;

  if (!content && !hasStructuredContent && !Object.hasOwn(result, "isError")) {
    return null;
  }

  return {
    ...(content ? { content } : {}),
    ...(hasStructuredContent ? { structuredContent } : {}),
    ...(Object.hasOwn(result, "isError") ? { isError } : {}),
  };
}

function parseSseJsonRpcToolCall(body: string): ComposioToolCallResult | null {
  const lines = body.split(/\r?\n/);
  let lastPayload: unknown = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const raw = trimmed.slice(5).trim();
    if (!raw || raw === "[DONE]") {
      continue;
    }
    try {
      lastPayload = JSON.parse(raw);
    } catch {
      // Ignore non-JSON SSE frames.
    }
  }

  return lastPayload === null ? null : extractToolCallResultFromJsonRpcMessage(lastPayload);
}

async function parseToolCallResponse(res: Response): Promise<ComposioToolCallResult | null> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (contentType.includes("text/event-stream")) {
    const fromSse = parseSseJsonRpcToolCall(text);
    if (fromSse) {
      return fromSse;
    }
  }

  try {
    return extractToolCallResultFromJsonRpcMessage(JSON.parse(text) as unknown);
  } catch {
    return parseSseJsonRpcToolCall(text);
  }
}

function toAgentToolResult(toolName: string, result: ComposioToolCallResult) {
  const content =
    Array.isArray(result.content) && result.content.length > 0
      ? result.content
      : result.structuredContent !== undefined
        ? [{ type: "text" as const, text: JSON.stringify(result.structuredContent, null, 2) }]
        : [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: result.isError === true ? "error" : "ok",
                  server: "composio",
                  tool: toolName,
                },
                null,
                2,
              ),
            },
          ];

  const details: Record<string, unknown> = {
    composioBridge: true,
    mcpServer: "composio",
    mcpTool: toolName,
  };
  if (result.structuredContent !== undefined) {
    details.structuredContent = result.structuredContent;
  }
  if (result.isError === true) {
    details.status = "error";
  }

  return {
    content: content as Array<{ type: string; text?: string }>,
    details,
  };
}

function attachRecoveryMetadataToResult(
  result: {
    content?: Array<{ type: string; text?: string }>;
    details?: Record<string, unknown>;
  },
  recovery: Record<string, unknown>,
  preserved: Record<string, unknown>,
) {
  const content = Array.isArray(result.content) ? result.content : [];
  let nextContent = content;
  const first = content[0];
  if (content.length > 0 && first?.type === "text" && typeof first.text === "string") {
    try {
      const parsed = JSON.parse(first.text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        nextContent = [
          {
            ...first,
            text: JSON.stringify({ ...(parsed as Record<string, unknown>), recovery }, null, 2),
          },
          ...content.slice(1),
        ];
      }
    } catch {
      nextContent = content;
    }
  }

  return {
    ...result,
    content: nextContent,
    details: {
      ...(result.details ?? {}),
      ...preserved,
      recovery,
    },
  };
}

async function executeComposioTool(params: {
  url: string;
  authorization?: string;
  toolName: string;
  input: Record<string, unknown>;
  connectedAccountId?: string;
  app?: string;
  accountIdentity?: string;
}) {
  try {
    const res = await fetch(buildToolCallUrl(params.url, params.connectedAccountId), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(params.authorization ? { authorization: params.authorization } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: params.toolName,
          arguments: params.input,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return jsonResult(
        {
          error: `${DENCH_INTEGRATION_DISPLAY_NAME} tool ${params.toolName} failed (HTTP ${res.status}).`,
          detail: detail || undefined,
        },
        {
          composioBridge: true,
          mcpServer: "composio",
          mcpTool: params.toolName,
          ...(params.app ? { toolkit: params.app } : {}),
          ...(params.connectedAccountId ? { connectedAccountId: params.connectedAccountId } : {}),
          ...(params.accountIdentity ? { accountIdentity: params.accountIdentity } : {}),
          status: "error",
        },
      );
    }

    const parsed = await parseToolCallResponse(res);
    if (!parsed) {
      return jsonResult(
        {
          error: `${DENCH_INTEGRATION_DISPLAY_NAME} tool ${params.toolName} returned an unreadable response.`,
        },
        {
          composioBridge: true,
          mcpServer: "composio",
          mcpTool: params.toolName,
          ...(params.app ? { toolkit: params.app } : {}),
          ...(params.connectedAccountId ? { connectedAccountId: params.connectedAccountId } : {}),
          ...(params.accountIdentity ? { accountIdentity: params.accountIdentity } : {}),
          status: "error",
        },
      );
    }

    const result = toAgentToolResult(params.toolName, parsed);
    return {
      ...result,
      details: {
        ...result.details,
        ...(params.app ? { toolkit: params.app } : {}),
        ...(params.connectedAccountId ? { connectedAccountId: params.connectedAccountId } : {}),
        ...(params.accountIdentity ? { accountIdentity: params.accountIdentity } : {}),
      },
    };
  } catch (error) {
    return jsonResult(
      {
        error: `${DENCH_INTEGRATION_DISPLAY_NAME} tool ${params.toolName} failed.`,
        detail: error instanceof Error ? error.message : String(error),
      },
      {
        composioBridge: true,
        mcpServer: "composio",
        mcpTool: params.toolName,
        ...(params.app ? { toolkit: params.app } : {}),
        ...(params.connectedAccountId ? { connectedAccountId: params.connectedAccountId } : {}),
        ...(params.accountIdentity ? { accountIdentity: params.accountIdentity } : {}),
        status: "error",
      },
    );
  }
}

async function executeComposioToolRouter(params: {
  gatewayBaseUrl: string;
  authorization?: string;
  executionRef: string;
  input: Record<string, unknown>;
}) {
  try {
    const res = await fetch(`${params.gatewayBaseUrl}/v1/composio/tool-router/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(params.authorization ? { authorization: params.authorization } : {}),
      },
      body: JSON.stringify({
        execution_ref: params.executionRef,
        arguments: params.input,
      }),
    });

    const text = await res.text();
    let parsed: UnknownRecord | undefined;
    try {
      parsed = JSON.parse(text) as UnknownRecord;
    } catch {
      parsed = undefined;
    }
    const executionMeta = extractGatewayExecutionMetadata(parsed, {
      executionRef: params.executionRef,
    });
    const recovery = asRecord(parsed?.recovery);
    const upstreamError = readGatewayError(parsed?.error) ?? (text || undefined);
    const failureKind = classifyComposioExecutionFailure(upstreamError);

    if (!res.ok) {
      return jsonResult(
        {
          error: `${DENCH_INTEGRATION_DISPLAY_NAME} execution failed (HTTP ${res.status}).`,
          detail: parsed ?? (text || undefined),
          execution: {
            mode: executionMeta.mode,
            ...(executionMeta.toolName ? { tool_name: executionMeta.toolName } : {}),
            ...(executionMeta.toolRouterSessionId
              ? { tool_router_session_id: executionMeta.toolRouterSessionId }
              : {}),
            ...(executionMeta.toolkit ? { toolkit: executionMeta.toolkit } : {}),
            ...(executionMeta.account ? { account: executionMeta.account } : {}),
            ...(executionMeta.executionRefVersion !== undefined
              ? { execution_ref_version: executionMeta.executionRefVersion }
              : {}),
            ...(executionMeta.logId ? { log_id: executionMeta.logId } : {}),
            execution_ref: params.executionRef,
          },
          ...(recovery ? { recovery } : {}),
          ...(failureKind ? { failure_kind: failureKind } : {}),
        },
        {
          composioBridge: true,
          composioMode: executionMeta.mode,
          ...(executionMeta.toolRouterSessionId
            ? { toolRouterSessionId: executionMeta.toolRouterSessionId }
            : {}),
          ...(executionMeta.toolName ? { mcpTool: executionMeta.toolName } : {}),
          ...(executionMeta.toolkit ? { toolkit: executionMeta.toolkit } : {}),
          ...(executionMeta.account ? { account: executionMeta.account } : {}),
          ...(executionMeta.logId ? { logId: executionMeta.logId } : {}),
          ...(executionMeta.executionRefVersion !== undefined
            ? { executionRefVersion: executionMeta.executionRefVersion }
            : {}),
          ...(recovery ? { recovery } : {}),
          executionRef: params.executionRef,
          status: "error",
          ...(failureKind ? { failureKind } : {}),
        },
      );
    }

    const data = parsed?.data;
    const error = readGatewayError(parsed?.error);
    const pagination = extractPaginationState(data);
    const basePayload = asRecord(data)
      ? { ...data }
      : data !== undefined
        ? { data }
        : (parsed ?? {});
    const structuredFailureKind = classifyComposioExecutionFailure(error);
    const contentPayload = {
      ...(asRecord(basePayload) ?? { data: basePayload }),
      ...(executionMeta.toolName ? { tool_slug: executionMeta.toolName } : {}),
      ...(executionMeta.toolRouterSessionId
        ? { tool_router_session_id: executionMeta.toolRouterSessionId }
        : {}),
      ...(executionMeta.toolkit ? { toolkit: executionMeta.toolkit } : {}),
      ...(executionMeta.account ? { account: executionMeta.account } : {}),
      ...(executionMeta.executionRefVersion !== undefined
        ? { execution_ref_version: executionMeta.executionRefVersion }
        : {}),
      ...(recovery ? { recovery } : {}),
      execution: {
        mode: executionMeta.mode,
        ...(executionMeta.toolName ? { tool_name: executionMeta.toolName } : {}),
        ...(executionMeta.toolRouterSessionId
          ? { tool_router_session_id: executionMeta.toolRouterSessionId }
          : {}),
        ...(executionMeta.toolkit ? { toolkit: executionMeta.toolkit } : {}),
        ...(executionMeta.account ? { account: executionMeta.account } : {}),
        ...(executionMeta.executionRefVersion !== undefined
          ? { execution_ref_version: executionMeta.executionRefVersion }
          : {}),
        ...(executionMeta.logId ? { log_id: executionMeta.logId } : {}),
        execution_ref: params.executionRef,
      },
      ...(error ? { error } : {}),
      ...(structuredFailureKind ? { failure_kind: structuredFailureKind } : {}),
    };
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(contentPayload, null, 2),
      }],
      details: {
        composioBridge: true,
        composioMode: executionMeta.mode,
        ...(executionMeta.toolRouterSessionId
          ? { toolRouterSessionId: executionMeta.toolRouterSessionId }
          : {}),
        ...(executionMeta.toolName ? { mcpTool: executionMeta.toolName } : {}),
        ...(executionMeta.toolkit ? { toolkit: executionMeta.toolkit } : {}),
        ...(executionMeta.account ? { account: executionMeta.account } : {}),
        ...(executionMeta.logId ? { logId: executionMeta.logId } : {}),
        ...(executionMeta.executionRefVersion !== undefined
          ? { executionRefVersion: executionMeta.executionRefVersion }
          : {}),
        ...(recovery ? { recovery } : {}),
        executionRef: params.executionRef,
        ...(data !== undefined ? { structuredContent: data } : {}),
        ...(pagination ? { pagination } : {}),
        ...(error ? { status: "error", error } : {}),
        ...(structuredFailureKind ? { failureKind: structuredFailureKind } : {}),
      },
    };
  } catch (error) {
    const failureKind = classifyComposioExecutionFailure(
      error instanceof Error ? error.message : String(error),
    );
    return jsonResult(
      {
        error: `${DENCH_INTEGRATION_DISPLAY_NAME} execution failed.`,
        detail: error instanceof Error ? error.message : String(error),
        execution: {
          mode: "gateway_tool_router",
          execution_ref: params.executionRef,
        },
        ...(failureKind ? { failure_kind: failureKind } : {}),
      },
      {
        composioBridge: true,
        composioMode: "gateway_tool_router",
        executionRef: params.executionRef,
        status: "error",
        ...(failureKind ? { failureKind } : {}),
      },
    );
  }
}

function createRegisteredComposioTools(params: {
  serverConfig: {
    url: string;
    authorization?: string;
    gatewayBaseUrl: string;
  };
}): AnyAgentTool[] {
  return [
    {
      name: COMPOSIO_CALL_TOOL_NAME,
      label: `${DENCH_INTEGRATIONS_DISPLAY_NAME} Call`,
      description:
        `Execute an exact ${DENCH_INTEGRATION_DISPLAY_NAME.toLowerCase()} tool returned by composio_search_tools through the gateway-backed integration session.`,
      parameters: COMPOSIO_CALL_TOOL_PARAMETERS,
      execute: async (_toolCallId: string, input: Record<string, unknown>) => {
        const payload = asRecord(input) ?? {};
        const executionRef = readString(payload.execution_ref)?.trim();
        const toolArgs = asRecord(payload.arguments) ?? {};

        if (!executionRef) {
          return jsonResult({
            error: "The `execution_ref` field is required for composio_call_tool.",
          });
        }

        const toolRouterResult = await executeComposioToolRouter({
          gatewayBaseUrl: params.serverConfig.gatewayBaseUrl,
          authorization: params.serverConfig.authorization,
          executionRef,
          input: toolArgs,
        });
        const toolRouterDetails = asRecord(toolRouterResult.details);
        const failureKind = readString(toolRouterDetails?.failureKind);
        const toolkit = readString(toolRouterDetails?.toolkit);
        const toolName = readString(toolRouterDetails?.mcpTool);
        const requestedAccount = readString(toolRouterDetails?.account);
        const shouldAttemptDirectFallback =
          failureKind === "connection_issue" || failureKind === "account_issue";
        if (!shouldAttemptDirectFallback || !toolkit || !toolName) {
          return toolRouterResult;
        }

        const activeConnections = await fetchGatewayActiveConnectionsForToolkit({
          gatewayBaseUrl: params.serverConfig.gatewayBaseUrl,
          authorization: params.serverConfig.authorization,
          app: toolkit,
        });
        const fallbackSelection = resolveGatewayMcpFallbackSelection({
          activeConnections: activeConnections ?? [],
          requestedAccount,
        });
        postDebugLog(
          "H14",
          "extensions/dench-ai-gateway/composio-bridge.ts:798",
          "evaluated direct MCP fallback after connection issue",
          {
            toolkit,
            toolName,
            failureKind,
            activeConnectionCount: fallbackSelection.activeConnectionCount,
            canFallback: fallbackSelection.canFallback,
            requestedAccountPresent: Boolean(requestedAccount?.trim()),
            connectedAccountIdPresent: Boolean(fallbackSelection.connectedAccountId),
          },
        );
        if (!fallbackSelection.canFallback || !fallbackSelection.connectedAccountId) {
          return toolRouterResult;
        }

        const directResult = await executeComposioTool({
          url: params.serverConfig.url,
          authorization: params.serverConfig.authorization,
          toolName,
          input: toolArgs,
          connectedAccountId: fallbackSelection.connectedAccountId,
          app: toolkit,
          accountIdentity: fallbackSelection.accountIdentity,
        });
        const directDetails = asRecord(directResult.details);
        const directFailed = readString(directDetails?.status) === "error";
        postDebugLog(
          "H14",
          "extensions/dench-ai-gateway/composio-bridge.ts:824",
          "direct MCP fallback completed",
          {
            toolkit,
            toolName,
            failureKind,
            directFailed,
            connectedAccountIdPresent: true,
          },
        );
        if (directFailed) {
          return toolRouterResult;
        }

        return attachRecoveryMetadataToResult(
          directResult,
          {
            recovered: true,
            recovered_via: "direct_mcp_single_active_account",
            retried_with_account: fallbackSelection.connectedAccountId,
          },
          {
            composioBridge: true,
            composioMode: "gateway_tool_router",
            executionRef,
            ...(toolRouterDetails?.toolRouterSessionId
              ? { toolRouterSessionId: toolRouterDetails.toolRouterSessionId }
              : {}),
            ...(toolRouterDetails?.executionRefVersion !== undefined
              ? { executionRefVersion: toolRouterDetails.executionRefVersion }
              : {}),
            mcpTool: toolName,
            toolkit,
            ...(requestedAccount ? { account: requestedAccount } : {}),
          },
        );
      },
    } as AnyAgentTool,
  ];
}

export function registerCuratedComposioBridge(api: any, fallbackGatewayUrl: string) {
  const workspaceDir = resolveWorkspaceDir(api);
  const serverConfig = resolveComposioServerConfig(api, fallbackGatewayUrl);
  if (!workspaceDir || !serverConfig?.url) {
    postDebugLog(
      "H6",
      "extensions/dench-ai-gateway/composio-bridge.ts:739",
      "composio bridge registration skipped",
      {
        workspaceDirPresent: Boolean(workspaceDir),
        serverUrlPresent: Boolean(serverConfig?.url),
      },
    );
    return;
  }

  const tools = createRegisteredComposioTools({
    serverConfig: {
      ...serverConfig,
      gatewayBaseUrl: resolveGatewayBaseUrl(serverConfig.url, fallbackGatewayUrl),
    },
  });
  for (const tool of tools) {
    api.registerTool(tool);
  }
  postDebugLog(
    "H6",
    "extensions/dench-ai-gateway/composio-bridge.ts:749",
    "composio bridge tools registered",
    {
      workspaceDirPresent: true,
      serverUrl: serverConfig.url,
      gatewayBaseUrl: resolveGatewayBaseUrl(serverConfig.url, fallbackGatewayUrl),
      toolNames: tools.map((tool) => tool.name),
    },
  );

  api.logger?.info?.(
    `[dench-ai-gateway] registered ${tools.length} managed ${DENCH_INTEGRATIONS_DISPLAY_NAME} bridge tool using gateway-issued execution refs`,
  );
}
