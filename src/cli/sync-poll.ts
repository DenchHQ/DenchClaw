/**
 * One-shot Gmail/Calendar sync kickoff used by the bootstrap/start/update
 * CLI commands.
 *
 * Why this exists: the gateway-side `dench-ai-gateway` plugin's
 * `armSyncTrigger` deliberately does NOT fire an immediate tick on plugin
 * load (see `extensions/dench-ai-gateway/sync-trigger.ts` for the
 * rationale — gateway boots typically race a half-up web app during
 * `denchclaw update`, producing 404/ECONNREFUSED noise that looks like
 * a failure). Instead, the CLI commands call `kickoffSyncPoll` AFTER
 * `ensureManagedWebRuntime` has confirmed web is healthy, which is a
 * much more reliable signal than "the plugin loaded".
 *
 * Best-effort: any failure (no key, no web, network error, non-200) is
 * swallowed and reported via the returned outcome so callers can decide
 * whether to surface it. Never throws.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const AUTH_PROFILES_REL = path.join("agents", "main", "agent", "auth-profiles.json");
const KICKOFF_TIMEOUT_MS = 10_000;

type UnknownRecord = Record<string, unknown>;

export type KickoffSyncPollResult =
  | { kind: "ok"; status: number }
  | { kind: "skipped"; reason: "no-api-key" | "fetch-not-available" }
  | { kind: "error"; reason: "http"; status: number }
  | { kind: "error"; reason: "timeout" }
  | { kind: "error"; reason: "network"; detail: string };

function readKeyFromAuthProfiles(stateDir: string): string | undefined {
  const authPath = path.join(stateDir, AUTH_PROFILES_REL);
  if (!existsSync(authPath)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(readFileSync(authPath, "utf-8")) as UnknownRecord;
    const profiles = raw?.profiles as UnknownRecord | undefined;
    const profile = profiles?.["dench-cloud:default"] as UnknownRecord | undefined;
    const key = profile?.key;
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

function envFallbackKey(): string | undefined {
  return (
    process.env.DENCH_CLOUD_API_KEY?.trim() ||
    process.env.DENCH_API_KEY?.trim() ||
    undefined
  );
}

/**
 * Fire one POST to `/api/sync/poll-tick` on the local web runtime.
 * Designed to be called from `bootstrap-external.ts`,
 * `web-runtime-command.ts#startWebRuntimeCommand`, and
 * `web-runtime-command.ts#updateWebRuntimeCommand` after the web runtime
 * is verified healthy. Mirrors the auth contract the gateway plugin uses
 * (Bearer + Dench Cloud API key).
 *
 * Caller is expected to log the outcome at most a single line — this
 * is a UX nicety, not a critical path. Returning `{ kind: "skipped" }`
 * is normal when the user is on a brand-new install with no Dench Cloud
 * key yet (skip-Dench-Cloud onboarding path).
 */
export async function kickoffSyncPoll(params: {
  stateDir: string;
  port: number;
}): Promise<KickoffSyncPollResult> {
  if (typeof globalThis.fetch !== "function") {
    return { kind: "skipped", reason: "fetch-not-available" };
  }

  const apiKey = readKeyFromAuthProfiles(params.stateDir) ?? envFallbackKey();
  if (!apiKey) {
    return { kind: "skipped", reason: "no-api-key" };
  }

  const tickUrl = `http://127.0.0.1:${params.port}/api/sync/poll-tick`;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), KICKOFF_TIMEOUT_MS);
  try {
    const response = await fetch(tickUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: "{}",
      signal: controller.signal,
    });
    if (response.ok) {
      return { kind: "ok", status: response.status };
    }
    return { kind: "error", reason: "http", status: response.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const aborted =
      err instanceof Error &&
      (err.name === "AbortError" || /aborted/i.test(message));
    if (aborted) {
      return { kind: "error", reason: "timeout" };
    }
    return { kind: "error", reason: "network", detail: message };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Convert a `KickoffSyncPollResult` into a one-line human-readable
 * summary suitable for stdout/log emission. Empty string for the
 * "no Dench Cloud key" case so quiet installs stay quiet.
 */
export function summarizeKickoffSyncPoll(result: KickoffSyncPollResult): string {
  switch (result.kind) {
    case "ok":
      return "Kicked off initial Gmail/Calendar sync.";
    case "skipped":
      return result.reason === "no-api-key"
        ? "" // Quiet skip — Dench Cloud isn't configured yet.
        : "Sync kickoff skipped (fetch unavailable).";
    case "error":
      if (result.reason === "http") {
        return `Sync kickoff returned HTTP ${result.status} (will retry on the gateway's next tick).`;
      }
      if (result.reason === "timeout") {
        return "Sync kickoff timed out (will retry on the gateway's next tick).";
      }
      return `Sync kickoff failed: ${result.detail} (will retry on the gateway's next tick).`;
  }
}
