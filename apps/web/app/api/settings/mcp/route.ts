import {
  addMcpServer,
  listMcpServers,
  McpServerError,
  removeMcpServer,
} from "@/lib/mcp-servers";
import { trackServer } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PostBody = {
  key?: unknown;
  url?: unknown;
  transport?: unknown;
  authToken?: unknown;
};

type DeleteBody = {
  key?: unknown;
};

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  try {
    return Response.json({
      servers: listMcpServers(),
    });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Failed to load MCP servers.",
      500,
    );
  }
}

export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (typeof body.key !== "string") {
    return jsonError("Field 'key' must be a string.", 400);
  }
  if (typeof body.url !== "string") {
    return jsonError("Field 'url' must be a string.", 400);
  }
  if (body.transport !== undefined && typeof body.transport !== "string") {
    return jsonError("Field 'transport' must be a string.", 400);
  }
  if (
    body.authToken !== undefined
    && body.authToken !== null
    && typeof body.authToken !== "string"
  ) {
    return jsonError("Field 'authToken' must be a string or null.", 400);
  }

  try {
    const server = addMcpServer({
      key: body.key,
      url: body.url,
      transport: body.transport,
      authToken: body.authToken,
    });
    trackServer("mcp_server_added", {
      key: server.key,
      transport: server.transport,
      has_auth: server.hasAuth,
    });
    return Response.json({ server }, { status: 201 });
  } catch (err) {
    if (err instanceof McpServerError) {
      return jsonError(err.message, err.status);
    }
    return jsonError(
      err instanceof Error ? err.message : "Failed to add MCP server.",
      500,
    );
  }
}

export async function DELETE(req: Request) {
  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (typeof body.key !== "string") {
    return jsonError("Field 'key' must be a string.", 400);
  }

  try {
    removeMcpServer(body.key);
    trackServer("mcp_server_removed", { key: body.key });
    return Response.json({ key: body.key });
  } catch (err) {
    if (err instanceof McpServerError) {
      return jsonError(err.message, err.status);
    }
    return jsonError(
      err instanceof Error ? err.message : "Failed to remove MCP server.",
      500,
    );
  }
}
