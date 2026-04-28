import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { resolveWebChatDir } from "@/lib/workspace";
import { cleanTitleText } from "../../shared";

export const dynamic = "force-dynamic";

type IndexEntry = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
};

/**
 * POST /api/web-sessions/[id]/messages — append or upsert messages.
 *
 * Uses upsert semantics: if a message with the same `id` already exists
 * in the session JSONL, it is replaced in-place. Otherwise the message
 * is appended. This supports both the client's post-stream save and the
 * server-side incremental persistence from the ActiveRunManager.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const chatDir = resolveWebChatDir();
  const filePath = join(chatDir, `${id}.jsonl`);
  const indexPath = join(chatDir, "index.json");

  // Auto-create the session directory if it doesn't exist yet
  if (!existsSync(chatDir)) {
    mkdirSync(chatDir, { recursive: true });
  }
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "");
  }

  const { messages, title } = await request.json();

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages array required" }, { status: 400 });
  }

  // Read existing lines for upsert checks.
  const existing = readFileSync(filePath, "utf-8");
  const lines = existing.split("\n").filter((l) => l.trim());
  let newCount = 0;

  for (const msg of messages) {
    const msgId = typeof msg.id === "string" ? msg.id : undefined;
    let found = false;

    if (msgId) {
      for (let i = 0; i < lines.length; i++) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (parsed.id === msgId) {
            // Replace the existing line in-place.
            lines[i] = JSON.stringify(msg);
            found = true;
            break;
          }
        } catch {
          /* keep malformed lines as-is */
        }
      }
    }

    if (!found) {
      lines.push(JSON.stringify(msg));
      newCount++;
    }
  }

  writeFileSync(filePath, lines.join("\n") + "\n");

  // Update index metadata
  try {
    if (existsSync(indexPath)) {
      const index: IndexEntry[] = JSON.parse(
        readFileSync(indexPath, "utf-8"),
      );
      const session = index.find((s) => s.id === id);
      if (session) {
        session.updatedAt = Date.now();
        if (newCount > 0) {session.messageCount += newCount;}
        if (title) {
          session.title = title;
        } else if (!session.title || session.title === "New Chat") {
          // Derive a title from the first user message so the sidebar
          // stops showing "New Chat" the moment the user hits send.
          // Proper AI-generated titles can later overwrite this via the
          // `title` field — this is just the fallback.
          const derived = deriveTitleFromMessages(lines);
          if (derived) {session.title = derived;}
        }
        writeFileSync(indexPath, JSON.stringify(index, null, 2));
      }
    }
  } catch {
    // index update is best-effort
  }

  return Response.json({ ok: true });
}

/**
 * Best-effort title extraction: pull the first user message's text and
 * trim it to a ~60-char one-liner. Strips attachment sentinels and
 * collapses whitespace so titles read like normal prose.
 */
function deriveTitleFromMessages(lines: string[]): string | null {
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.role !== "user") {continue;}
      let text = "";
      if (typeof parsed.content === "string") {
        text = parsed.content;
      } else if (Array.isArray(parsed.parts)) {
        // ai-sdk UIMessage shape — concat all text parts.
        type UITextPart = { type: string; text: string };
        text = (parsed.parts as unknown[])
          .filter((p): p is UITextPart =>
            typeof p === "object" &&
            p !== null &&
            (p as { type?: string }).type === "text" &&
            typeof (p as { text?: string }).text === "string",
          )
          .map((p: UITextPart) => p.text)
          .join(" ");
      }
      const cleaned = cleanTitleText(text);
      if (!cleaned) {continue;}
      return cleaned.length > 60 ? cleaned.slice(0, 60).trimEnd() + "…" : cleaned;
    } catch {
      continue;
    }
  }
  return null;
}
