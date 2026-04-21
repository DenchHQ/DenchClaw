/**
 * Contract tests for the CLI-side `kickoffSyncPoll` helper that
 * `bootstrap`, `update`, and `start` use to fire one Gmail/Calendar
 * sync immediately after the web runtime is verified healthy.
 *
 * Key invariants under test:
 *
 * - "no key" path returns `skipped: no-api-key` quietly (Dench Cloud
 *   not yet configured is a normal state, not an error).
 * - Bearer auth is sourced from `auth-profiles.json` first, env vars
 *   second — same precedence as the gateway plugin.
 * - HTTP errors / network errors / timeouts surface as distinct outcomes
 *   so the CLI summary line can distinguish them, but never throw.
 * - `summarizeKickoffSyncPoll` produces an empty string for the
 *   "no Dench Cloud key" case so brand-new installs stay quiet.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kickoffSyncPoll, summarizeKickoffSyncPoll } from "./sync-poll.js";

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

describe("kickoffSyncPoll", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    DENCH_CLOUD_API_KEY: process.env.DENCH_CLOUD_API_KEY,
    DENCH_API_KEY: process.env.DENCH_API_KEY,
  };
  let stateDir: string | undefined;

  beforeEach(() => {
    delete process.env.DENCH_CLOUD_API_KEY;
    delete process.env.DENCH_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (stateDir) {
      rmSync(stateDir, { recursive: true, force: true });
      stateDir = undefined;
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns skipped:no-api-key when no key in profiles or env (no fetch fired)", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "kickoff-sync-"));
    const fetchMock = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const result = await kickoffSyncPoll({ stateDir, port: 3100 });

    expect(result).toEqual({ kind: "skipped", reason: "no-api-key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses key from auth-profiles.json with Bearer auth on the happy path", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "kickoff-sync-"));
    writeAuthProfiles(stateDir, "dc-from-profile");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await kickoffSyncPoll({ stateDir, port: 3100 });

    expect(result).toEqual({ kind: "ok", status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {throw new Error("fetch not called");}
    const [url, init] = firstCall;
    expect(url).toBe("http://127.0.0.1:3100/api/sync/poll-tick");
    expect((init as RequestInit).method).toBe("POST");
    expect(((init as RequestInit).headers as Record<string, string>).authorization).toBe(
      "Bearer dc-from-profile",
    );
  });

  it("falls back to DENCH_CLOUD_API_KEY env when auth-profiles is absent", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "kickoff-sync-"));
    process.env.DENCH_CLOUD_API_KEY = "dc-from-env";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await kickoffSyncPoll({ stateDir, port: 3100 });

    expect(result).toEqual({ kind: "ok", status: 200 });
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {throw new Error("fetch not called");}
    const [, init] = firstCall;
    expect(((init as RequestInit).headers as Record<string, string>).authorization).toBe(
      "Bearer dc-from-env",
    );
  });

  it("auth-profiles.json key wins over env (matches plugin precedence)", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "kickoff-sync-"));
    writeAuthProfiles(stateDir, "dc-from-profile");
    process.env.DENCH_CLOUD_API_KEY = "dc-from-env";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await kickoffSyncPoll({ stateDir, port: 3100 });

    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {throw new Error("fetch not called");}
    const [, init] = firstCall;
    expect(((init as RequestInit).headers as Record<string, string>).authorization).toBe(
      "Bearer dc-from-profile",
    );
  });

  it("returns error:http on non-2xx, surfaces status (no throw)", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "kickoff-sync-"));
    writeAuthProfiles(stateDir, "dc-key");
    globalThis.fetch = vi.fn(
      async () => new Response("nope", { status: 401 }),
    ) as unknown as typeof fetch;

    const result = await kickoffSyncPoll({ stateDir, port: 3100 });

    expect(result).toEqual({ kind: "error", reason: "http", status: 401 });
  });

  it("returns error:network on connection failure (no throw)", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "kickoff-sync-"));
    writeAuthProfiles(stateDir, "dc-key");
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:3100");
    }) as unknown as typeof fetch;

    const result = await kickoffSyncPoll({ stateDir, port: 3100 });

    expect(result.kind).toBe("error");
    if (result.kind === "error" && result.reason === "network") {
      expect(result.detail).toContain("ECONNREFUSED");
    } else {
      throw new Error(`unexpected result: ${JSON.stringify(result)}`);
    }
  });

  it("returns error:timeout on AbortError (no throw)", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "kickoff-sync-"));
    writeAuthProfiles(stateDir, "dc-key");
    globalThis.fetch = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;

    const result = await kickoffSyncPoll({ stateDir, port: 3100 });

    expect(result).toEqual({ kind: "error", reason: "timeout" });
  });

  it("returns skipped:fetch-not-available when global fetch is missing", async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "kickoff-sync-"));
    writeAuthProfiles(stateDir, "dc-key");
    // Simulate ancient Node by stripping fetch.
    (globalThis as unknown as { fetch: undefined }).fetch = undefined;

    const result = await kickoffSyncPoll({ stateDir, port: 3100 });

    expect(result).toEqual({ kind: "skipped", reason: "fetch-not-available" });
  });
});

describe("summarizeKickoffSyncPoll", () => {
  it("emits empty string for the no-Dench-Cloud-key case (quiet skip)", () => {
    expect(summarizeKickoffSyncPoll({ kind: "skipped", reason: "no-api-key" })).toBe("");
  });

  it("emits a happy-path one-liner for ok", () => {
    const line = summarizeKickoffSyncPoll({ kind: "ok", status: 200 });
    expect(line).toContain("Kicked off");
  });

  it("notes the gateway will retry on http error", () => {
    const line = summarizeKickoffSyncPoll({ kind: "error", reason: "http", status: 503 });
    expect(line).toContain("HTTP 503");
    expect(line).toContain("retry on the gateway");
  });

  it("notes the gateway will retry on timeout", () => {
    const line = summarizeKickoffSyncPoll({ kind: "error", reason: "timeout" });
    expect(line).toContain("timed out");
    expect(line).toContain("retry on the gateway");
  });

  it("includes the network detail string and a retry hint", () => {
    const line = summarizeKickoffSyncPoll({
      kind: "error",
      reason: "network",
      detail: "ECONNREFUSED",
    });
    expect(line).toContain("ECONNREFUSED");
    expect(line).toContain("retry on the gateway");
  });

  it("emits a non-empty hint for fetch-not-available skipped case", () => {
    const line = summarizeKickoffSyncPoll({
      kind: "skipped",
      reason: "fetch-not-available",
    });
    expect(line).toContain("fetch unavailable");
  });
});
