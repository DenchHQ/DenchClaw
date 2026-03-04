import { readFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWebChatDir, resolveOpenClawStateDir, resolveActiveAgentId } from "@/lib/workspace";
import { readIndex, writeIndex } from "../shared";

export const dynamic = "force-dynamic";

export type ChatLine = {
  id: string;
  role: "user" | "assistant";
  /** Plain text summary (always present, used for sidebar / backward compat). */
  content: string;
  /** Full UIMessage parts array — reasoning, tool calls, outputs, text.
   *  Present for sessions saved after the rich-persistence update;
   *  absent for older sessions (fall back to `content` as a text part). */
  parts?: Array<Record<string, unknown>>;
  timestamp: string;
};

/**
 * For subagent sessions whose persisted parts lack tool-invocation entries,
 * backfill from the gateway's on-disk session transcript (which always
 * stores the full conversation including tool calls).
 */
function enrichSubagentMessages(sessionKey: string, messages: ChatLine[], webChatPath: string): ChatLine[] {
  const assistantMsgs = messages.filter((m) => m.role === "assistant");
  const hasToolParts = assistantMsgs.some((m) =>
    m.parts?.some((p) => p.type === "tool-invocation" || p.type === "dynamic-tool"),
  );
  if (hasToolParts) {return messages;}

  try {
    const stateDir = resolveOpenClawStateDir();
    const agentId = resolveActiveAgentId();
    const sessionsJsonPath = join(stateDir, "agents", agentId, "sessions", "sessions.json");
    if (!existsSync(sessionsJsonPath)) {return messages;}

    const sessions = JSON.parse(readFileSync(sessionsJsonPath, "utf-8")) as Record<string, Record<string, unknown>>;
    const sessionData = sessions[sessionKey];
    const sessionId = typeof sessionData?.sessionId === "string" ? sessionData.sessionId : null;
    if (!sessionId) {return messages;}

    const transcriptPath = join(stateDir, "agents", agentId, "sessions", `${sessionId}.jsonl`);
    if (!existsSync(transcriptPath)) {return messages;}

    const entries = readFileSync(transcriptPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean) as Array<Record<string, unknown>>;

    const toolParts: Array<Record<string, unknown>> = [];
    const toolResults = new Map<string, Record<string, unknown>>();

    for (const entry of entries) {
      if (entry.type !== "message") {continue;}
      const msg = entry.message as Record<string, unknown> | undefined;
      if (!msg) {continue;}
      const content = msg.content;

      if (msg.role === "toolResult" && typeof msg.toolCallId === "string") {
        const text = Array.isArray(content)
          ? (content as Array<Record<string, unknown>>)
              .filter((c) => c.type === "text" && typeof c.text === "string")
              .map((c) => c.text as string)
              .join("\n")
          : typeof content === "string" ? content : "";
        toolResults.set(msg.toolCallId, { text: text.slice(0, 500) });
      }

      if (Array.isArray(content)) {
        for (const part of content as Array<Record<string, unknown>>) {
          if (part.type === "toolCall" && typeof part.id === "string" && typeof part.name === "string") {
            toolParts.push({
              type: "tool-invocation",
              toolCallId: part.id,
              toolName: part.name,
              args: (part.arguments as Record<string, unknown>) ?? {},
            });
          }
        }
      }
    }

    if (toolParts.length === 0) {return messages;}

    for (const tp of toolParts) {
      const result = toolResults.get(tp.toolCallId as string);
      if (result) { tp.result = result; }
    }

    // Inject tool parts into assistant messages: place them before text parts
    const enriched = messages.map((m) => {
      if (m.role !== "assistant") {return m;}
      const existingParts = m.parts ?? [{ type: "text", text: m.content }];
      const textParts = existingParts.filter((p) => p.type === "text");
      const otherParts = existingParts.filter((p) => p.type !== "text");
      return { ...m, parts: [...otherParts, ...toolParts, ...textParts] };
    });

    // Persist the enriched data back so future loads don't need to re-enrich
    try {
      const lines = enriched.map((m) => JSON.stringify(m));
      writeFileSync(webChatPath, lines.join("\n") + "\n");
    } catch { /* best effort */ }

    return enriched;
  } catch {
    return messages;
  }
}

/** GET /api/web-sessions/[id] — read all messages for a web chat session */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const filePath = join(resolveWebChatDir(), `${id}.jsonl`);

  if (!existsSync(filePath)) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const content = readFileSync(filePath, "utf-8");
  let messages: ChatLine[] = content
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as ChatLine;
      } catch {
        return null;
      }
    })
    .filter((m): m is ChatLine => m !== null);

  if (id.includes(":subagent:")) {
    messages = enrichSubagentMessages(id, messages, filePath);
  }

  return Response.json({ id, messages });
}

/** DELETE /api/web-sessions/[id] — delete a web chat session */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const sessions = readIndex();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  sessions.splice(idx, 1);
  writeIndex(sessions);

  const filePath = join(resolveWebChatDir(), `${id}.jsonl`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  return Response.json({ ok: true });
}

/** PATCH /api/web-sessions/[id] — update session metadata (e.g. rename) */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const sessions = readIndex();
  const session = sessions.find((s) => s.id === id);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (typeof body.title === "string") {
    session.title = body.title;
  }
  session.updatedAt = Date.now();
  writeIndex(sessions);

  return Response.json({ session });
}
