/**
 * Auth + execution contract for the gateway-driven poll-tick endpoint.
 *
 * The contract under test:
 *
 * 1. Loopback-only — non-localhost host headers get 403, with no key read
 *    or tick attempted (saves I/O on misconfigured public deployments).
 * 2. Bearer token must be present and equal (constant-time compare) to
 *    the Dench Cloud API key the `dench-ai-gateway` plugin reads.
 * 3. When backfill is running, the tick is skipped (returns ok+skipped)
 *    so the gateway-driven cron doesn't pile work on top of an in-flight
 *    backfill.
 * 4. Happy path runs `tickPoller()` exactly once and returns the most
 *    recent SyncProgressEvent so logs/debug tools have something to read.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/dench-auth", () => ({
  readDenchAuthProfileKey: vi.fn(),
}));

vi.mock("@/lib/sync-runner", () => ({
  tickPoller: vi.fn(async () => {}),
  isBackfillRunning: vi.fn(() => false),
  getLastProgressEvent: vi.fn(() => null),
}));

const { POST } = await import("./route");
const { readDenchAuthProfileKey } = await import("@/lib/dench-auth");
const { tickPoller, isBackfillRunning, getLastProgressEvent } = await import(
  "@/lib/sync-runner"
);

const mockedReadKey = vi.mocked(readDenchAuthProfileKey);
const mockedTick = vi.mocked(tickPoller);
const mockedBackfillRunning = vi.mocked(isBackfillRunning);
const mockedLastEvent = vi.mocked(getLastProgressEvent);

const VALID_KEY = "dench_test_key_abcd1234";

function makeRequest(opts: {
  authorization?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.authorization !== null && opts.authorization !== undefined) {
    headers.set("authorization", opts.authorization);
  }
  if (opts.host !== null) {
    headers.set("host", opts.host ?? "127.0.0.1:3100");
  }
  if (opts.forwardedHost) {
    headers.set("x-forwarded-host", opts.forwardedHost);
  }
  return new Request("http://127.0.0.1:3100/api/sync/poll-tick", {
    method: "POST",
    headers,
    body: "{}",
  });
}

describe("/api/sync/poll-tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadKey.mockReturnValue(VALID_KEY);
    mockedBackfillRunning.mockReturnValue(false);
    mockedLastEvent.mockReturnValue(null);
  });

  it("rejects non-loopback hosts with 403 (no key read, no tick)", async () => {
    const res = await POST(makeRequest({
      host: "example.com",
      authorization: `Bearer ${VALID_KEY}`,
    }));
    expect(res.status).toBe(403);
    expect(mockedReadKey).not.toHaveBeenCalled();
    expect(mockedTick).not.toHaveBeenCalled();
  });

  it("accepts 127.0.0.1 host", async () => {
    const res = await POST(makeRequest({
      host: "127.0.0.1:3100",
      authorization: `Bearer ${VALID_KEY}`,
    }));
    expect(res.status).toBe(200);
  });

  it("accepts localhost host", async () => {
    const res = await POST(makeRequest({
      host: "localhost:3100",
      authorization: `Bearer ${VALID_KEY}`,
    }));
    expect(res.status).toBe(200);
  });

  it("accepts IPv6 loopback ::1", async () => {
    const res = await POST(makeRequest({
      host: "[::1]:3100",
      authorization: `Bearer ${VALID_KEY}`,
    }));
    expect(res.status).toBe(200);
  });

  it("rejects missing Authorization header with 401", async () => {
    const res = await POST(makeRequest({ authorization: undefined }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Missing Bearer/);
    expect(mockedTick).not.toHaveBeenCalled();
  });

  it("rejects malformed Authorization header (no Bearer prefix) with 401", async () => {
    const res = await POST(makeRequest({ authorization: VALID_KEY }));
    expect(res.status).toBe(401);
    expect(mockedTick).not.toHaveBeenCalled();
  });

  it("returns 503 when no Dench Cloud key is configured", async () => {
    mockedReadKey.mockReturnValue(undefined);
    const res = await POST(makeRequest({
      authorization: `Bearer ${VALID_KEY}`,
    }));
    expect(res.status).toBe(503);
    expect(mockedTick).not.toHaveBeenCalled();
  });

  it("rejects mismatched Bearer token with 401 (no tick)", async () => {
    const res = await POST(makeRequest({
      authorization: "Bearer wrong_key",
    }));
    expect(res.status).toBe(401);
    expect(mockedTick).not.toHaveBeenCalled();
  });

  it("rejects same-prefix-different-suffix token (constant-time compare hardens, but length differs)", async () => {
    // Different length should still be a clean reject (not a hang or crash).
    const res = await POST(makeRequest({
      authorization: `Bearer ${VALID_KEY}xtra`,
    }));
    expect(res.status).toBe(401);
  });

  it("skips tick (still 200) when a backfill is in progress", async () => {
    mockedBackfillRunning.mockReturnValue(true);
    const res = await POST(makeRequest({
      authorization: `Bearer ${VALID_KEY}`,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe("backfill-in-progress");
    expect(mockedTick).not.toHaveBeenCalled();
  });

  it("calls tickPoller exactly once on the happy path and surfaces last event", async () => {
    mockedLastEvent.mockReturnValue({
      phase: "polling",
      message: "Synced 3 new emails.",
      messagesProcessed: 3,
      peopleProcessed: 0,
      companiesProcessed: 0,
      threadsProcessed: 0,
      eventsProcessed: 0,
    });
    const res = await POST(makeRequest({
      authorization: `Bearer ${VALID_KEY}`,
    }));
    expect(res.status).toBe(200);
    expect(mockedTick).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.lastEvent?.message).toBe("Synced 3 new emails.");
    expect(typeof body.ranAt).toBe("string");
  });

  it("returns 500 and surfaces error when tickPoller throws", async () => {
    mockedTick.mockRejectedValueOnce(new Error("DuckDB busy"));
    const res = await POST(makeRequest({
      authorization: `Bearer ${VALID_KEY}`,
    }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/DuckDB busy/);
  });

  it("prefers x-forwarded-host over host (proxy-aware loopback check)", async () => {
    // Simulating a misconfigured proxy that forwards from public host
    // even though the underlying connection is loopback. We MUST trust
    // x-forwarded-host so the loopback assertion remains tight.
    const res = await POST(makeRequest({
      host: "127.0.0.1:3100",
      forwardedHost: "evil.example.com",
      authorization: `Bearer ${VALID_KEY}`,
    }));
    expect(res.status).toBe(403);
  });
});
