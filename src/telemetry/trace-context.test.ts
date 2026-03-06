import { describe, it, expect, beforeEach } from "vitest";
import { TraceContextManager, resolveSessionKey } from "../../extensions/posthog-analytics/lib/trace-context.js";

describe("resolveSessionKey", () => {
  it("prefers sessionId over sessionKey and runId", () => {
    expect(resolveSessionKey({ sessionId: "s", sessionKey: "k", runId: "r" })).toBe("s");
  });

  it("falls back to sessionKey when sessionId is absent", () => {
    expect(resolveSessionKey({ sessionKey: "k", runId: "r" })).toBe("k");
  });

  it("falls back to runId when both session fields are absent", () => {
    expect(resolveSessionKey({ runId: "r" })).toBe("r");
  });

  it("returns 'unknown' when no identifiers are present", () => {
    expect(resolveSessionKey({})).toBe("unknown");
  });
});

describe("TraceContextManager", () => {
  let ctx: TraceContextManager;

  beforeEach(() => {
    ctx = new TraceContextManager();
  });

  // ── Trace lifecycle (session-keyed) ──

  it("uses sessionKey as traceId so feedback and generation events share the same trace", () => {
    ctx.startTrace("session-1", "run-1");
    ctx.startTrace("session-2", "run-2");
    const t1 = ctx.getTrace("session-1")!;
    const t2 = ctx.getTrace("session-2")!;
    expect(t1.traceId).toBe("session-1");
    expect(t2.traceId).toBe("session-2");
    expect(t1.traceId).not.toBe(t2.traceId);
  });

  it("indexes by sessionKey so different runIds in the same session share one trace", () => {
    ctx.startTrace("sess-abc", "run-1");
    ctx.startToolSpan("sess-abc", "search", { q: "test" });
    ctx.endToolSpan("sess-abc", "search", { ok: true });

    const trace = ctx.getTrace("sess-abc")!;
    expect(trace.toolSpans).toHaveLength(1);
    expect(trace.runId).toBe("run-1");
  });

  it("replaces existing trace when startTrace is called again for the same session (new run)", () => {
    ctx.startTrace("sess", "run-old");
    ctx.startToolSpan("sess", "exec", {});
    expect(ctx.getTrace("sess")!.toolSpans).toHaveLength(1);

    ctx.startTrace("sess", "run-new");
    expect(ctx.getTrace("sess")!.runId).toBe("run-new");
    expect(ctx.getTrace("sess")!.toolSpans).toHaveLength(0);
  });

  it("records startedAt timestamp on trace creation (enables latency calculation)", () => {
    const before = Date.now();
    ctx.startTrace("s", "r");
    const after = Date.now();
    const trace = ctx.getTrace("s")!;
    expect(trace.startedAt).toBeGreaterThanOrEqual(before);
    expect(trace.startedAt).toBeLessThanOrEqual(after);
  });

  it("endTrace sets endedAt on the trace", () => {
    ctx.startTrace("s", "r");
    ctx.endTrace("s");
    const trace = ctx.getTrace("s")!;
    expect(trace.endedAt).toBeDefined();
    expect(trace.endedAt!).toBeGreaterThanOrEqual(trace.startedAt);
  });

  it("returns undefined for non-existent session key (defensive)", () => {
    expect(ctx.getTrace("nonexistent")).toBeUndefined();
    expect(ctx.getModel("nonexistent")).toBeUndefined();
    expect(ctx.getLastToolSpan("nonexistent")).toBeUndefined();
  });

  // ── Model resolution ──

  it("extracts provider from model string with slash separator", () => {
    ctx.startTrace("s", "r");
    ctx.setModel("s", "anthropic/claude-4-sonnet");
    expect(ctx.getTrace("s")!.model).toBe("anthropic/claude-4-sonnet");
    expect(ctx.getTrace("s")!.provider).toBe("anthropic");
  });

  it("does not set provider for models without a slash", () => {
    ctx.startTrace("s", "r");
    ctx.setModel("s", "gpt-4o");
    expect(ctx.getTrace("s")!.model).toBe("gpt-4o");
    expect(ctx.getTrace("s")!.provider).toBeUndefined();
  });

  it("handles multi-segment provider paths like vercel-ai-gateway/anthropic/claude-4", () => {
    ctx.startTrace("s", "r");
    ctx.setModel("s", "vercel-ai-gateway/anthropic/claude-4");
    expect(ctx.getTrace("s")!.provider).toBe("vercel-ai-gateway");
  });

  // ── Input capture with privacy ──

  it("redacts message content when privacy mode is on (prevents content leakage)", () => {
    ctx.startTrace("s", "r");
    ctx.setInput("s", [
      { role: "user", content: "My SSN is 123-45-6789" },
    ], true);
    const input = ctx.getTrace("s")!.input as Array<Record<string, unknown>>;
    expect(input[0].content).toBe("[REDACTED]");
    expect(input[0].role).toBe("user");
  });

  it("preserves message content when privacy mode is off", () => {
    ctx.startTrace("s", "r");
    ctx.setInput("s", [{ role: "user", content: "Hello" }], false);
    const input = ctx.getTrace("s")!.input as Array<Record<string, unknown>>;
    expect(input[0].content).toBe("Hello");
  });

  // ── Tool span lifecycle ──

  it("tracks tool span start/end with timing and error detection", () => {
    ctx.startTrace("s", "r");
    ctx.startToolSpan("s", "web_search", { query: "test" });
    const span = ctx.getLastToolSpan("s")!;
    expect(span.toolName).toBe("web_search");
    expect(span.endedAt).toBeUndefined();

    ctx.endToolSpan("s", "web_search", { results: ["a"] });
    expect(span.endedAt).toBeDefined();
    expect(span.isError).toBe(false);
  });

  it("marks tool span as error when result contains an 'error' key", () => {
    ctx.startTrace("s", "r");
    ctx.startToolSpan("s", "exec", { cmd: "rm -rf /" });
    ctx.endToolSpan("s", "exec", { error: "permission denied" });
    expect(ctx.getLastToolSpan("s")!.isError).toBe(true);
  });

  it("handles multiple tool spans in order", () => {
    ctx.startTrace("s", "r");
    ctx.startToolSpan("s", "search", {});
    ctx.endToolSpan("s", "search", { ok: true });
    ctx.startToolSpan("s", "read", {});
    ctx.endToolSpan("s", "read", { ok: true });

    expect(ctx.getTrace("s")!.toolSpans).toHaveLength(2);
    expect(ctx.getLastToolSpan("s")!.toolName).toBe("read");
  });

  it("matches end to the most recent unfinished span of the same tool name", () => {
    ctx.startTrace("s", "r");
    ctx.startToolSpan("s", "exec", { cmd: "ls" });
    ctx.endToolSpan("s", "exec", { output: "file1" });
    ctx.startToolSpan("s", "exec", { cmd: "pwd" });
    ctx.endToolSpan("s", "exec", { output: "/home" });

    const spans = ctx.getTrace("s")!.toolSpans;
    expect(spans).toHaveLength(2);
    expect(spans[0].endedAt).toBeDefined();
    expect(spans[1].endedAt).toBeDefined();
  });

  // ── Concurrent sessions ──

  it("isolates traces across concurrent sessions (prevents cross-session contamination)", () => {
    ctx.startTrace("s1", "run-a");
    ctx.startTrace("s2", "run-b");
    ctx.setModel("s1", "gpt-4o");
    ctx.setModel("s2", "claude-4-sonnet");
    ctx.startToolSpan("s1", "search", {});
    ctx.startToolSpan("s2", "exec", {});

    expect(ctx.getModel("s1")).toBe("gpt-4o");
    expect(ctx.getModel("s2")).toBe("claude-4-sonnet");
    expect(ctx.getTrace("s1")!.toolSpans[0].toolName).toBe("search");
    expect(ctx.getTrace("s2")!.toolSpans[0].toolName).toBe("exec");
  });
});
