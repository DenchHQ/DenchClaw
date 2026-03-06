import { randomUUID } from "node:crypto";
import { redactMessages } from "./privacy.js";
import type { TraceEntry, ToolSpanEntry } from "./types.js";

/**
 * Resolve a stable session key from the hook context.
 * OpenClaw assigns different `runId` values to different hook phases
 * in the same agent loop, so we use sessionId/sessionKey as the
 * stable key for trace indexing.
 */
export function resolveSessionKey(ctx: {
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
}): string {
  return ctx.sessionId ?? ctx.sessionKey ?? ctx.runId ?? "unknown";
}

/**
 * Tracks in-flight trace and span state per session.
 * Each session has at most one active agent run at a time
 * (OpenClaw serializes runs per session), so sessionId is
 * a stable key across all hooks in the same agent loop.
 */
export class TraceContextManager {
  private traces = new Map<string, TraceEntry>();

  startTrace(sessionKey: string, runId: string): void {
    this.traces.set(sessionKey, {
      traceId: sessionKey,
      sessionId: sessionKey,
      runId,
      startedAt: Date.now(),
      toolSpans: [],
    });
  }

  setModel(sessionKey: string, model: string): void {
    const t = this.traces.get(sessionKey);
    if (!t) return;
    t.model = model;
    const slashIdx = model.indexOf("/");
    if (slashIdx > 0) {
      t.provider = model.slice(0, slashIdx);
    }
  }

  setInput(sessionKey: string, messages: unknown, privacyMode: boolean): void {
    const t = this.traces.get(sessionKey);
    if (!t) return;
    t.input = privacyMode ? redactMessages(messages) : messages;
  }

  startToolSpan(sessionKey: string, toolName: string, params?: unknown): void {
    const t = this.traces.get(sessionKey);
    if (!t) return;
    t.toolSpans.push({
      toolName,
      spanId: randomUUID(),
      startedAt: Date.now(),
      params,
    });
  }

  endToolSpan(sessionKey: string, toolName: string, result?: unknown): void {
    const t = this.traces.get(sessionKey);
    if (!t) return;
    for (let i = t.toolSpans.length - 1; i >= 0; i--) {
      const span = t.toolSpans[i];
      if (span.toolName === toolName && !span.endedAt) {
        span.endedAt = Date.now();
        span.result = result;
        span.isError =
          result != null &&
          typeof result === "object" &&
          "error" in (result as Record<string, unknown>);
        break;
      }
    }
  }

  getTrace(sessionKey: string): TraceEntry | undefined {
    return this.traces.get(sessionKey);
  }

  getModel(sessionKey: string): string | undefined {
    return this.traces.get(sessionKey)?.model;
  }

  getLastToolSpan(sessionKey: string): ToolSpanEntry | undefined {
    const t = this.traces.get(sessionKey);
    if (!t || t.toolSpans.length === 0) return undefined;
    return t.toolSpans[t.toolSpans.length - 1];
  }

  endTrace(sessionKey: string): void {
    const t = this.traces.get(sessionKey);
    if (t) {
      t.endedAt = Date.now();
    }
    setTimeout(() => this.traces.delete(sessionKey), 5_000);
  }
}
