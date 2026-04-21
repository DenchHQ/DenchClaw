/**
 * Gateway-driven sync trigger.
 *
 * Lives inside the OpenClaw gateway daemon (loaded as part of the
 * `dench-ai-gateway` plugin) and POSTs to the Next.js web app's
 * `/api/sync/poll-tick` endpoint every `intervalMs` (default 5 minutes).
 *
 * Why here: the gateway daemon is long-lived and survives `denchclaw update`
 * / web-runtime restarts, whereas the web app's old `setInterval` died on
 * every Next process restart. We keep the actual sync work
 * (`runGmailIncremental`, DuckDB writes, scoring) in the web app and only
 * move the timekeeping into the gateway process.
 *
 * Lifecycle:
 *
 * - We DO NOT fire an immediate tick on plugin arm. During `denchclaw
 *   update` or `denchclaw start` the gateway daemon often boots while
 *   the web app is mid-restart (or the standalone bundle is being
 *   replaced) — an immediate tick lands on a half-up server and
 *   produces 404/ECONNREFUSED noise that looks like a real failure.
 *   Instead, the first run is the first interval tick (5 min by default).
 * - For "I just finished `denchclaw update`, sync now please" UX, the
 *   bootstrap/start/update CLI commands fire a one-shot POST themselves
 *   via `src/cli/sync-poll.ts#kickoffSyncPoll` after web-runtime is
 *   verified healthy. That gives users the same ASAP-sync feel without
 *   the noise.
 *
 * Auth: reuses the Dench Cloud API key already read by the rest of the
 * plugin (`readDenchAuthProfileKey`). No new secret to provision. The
 * web endpoint validates the same key. If no key is present (Dench
 * Cloud not connected) we never arm the timer — the sync would fail
 * downstream anyway since `runGmailIncremental` calls Composio via the
 * Dench Cloud gateway.
 *
 * Logging:
 *
 * - First failure in a streak is logged; subsequent identical failures
 *   are suppressed until the failure mode changes or the streak ends.
 *   When a streak ends (next tick succeeds), we log a recovery line so
 *   operators know the system self-healed.
 * - Network errors are bounded by an AbortSignal timeout
 *   (`FETCH_TIMEOUT_MS`) so a hung web app can't pile up pending
 *   fetches inside the gateway.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { readDenchAuthProfileKey } from "../shared/dench-auth.js";

type UnknownRecord = Record<string, unknown>;

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_WEB_PORT = 3100;
const PROCESS_JSON_REL = path.join("web-runtime", "process.json");
const FETCH_TIMEOUT_MS = 60_000;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveSyncTriggerConfig(api: any): UnknownRecord | undefined {
  const pluginConfig = asRecord(
    asRecord(asRecord(api?.config)?.plugins)?.entries,
  )?.["dench-ai-gateway"];
  return asRecord(asRecord(pluginConfig)?.config?.["syncTrigger"] as unknown);
}

function resolveStateDir(): string {
  const fromEnv = process.env.OPENCLAW_STATE_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const home = process.env.OPENCLAW_HOME?.trim() || homedir();
  return path.join(home, ".openclaw-dench");
}

/**
 * Read the web app's listening port from the managed-runtime sidecar
 * file (`~/.openclaw-dench/web-runtime/process.json`). Falls back to the
 * default if the file is missing or unparseable, since the gateway can
 * outlive a partially-installed web runtime.
 */
function resolveWebPortFromProcessFile(stateDir: string): number | undefined {
  const processPath = path.join(stateDir, PROCESS_JSON_REL);
  if (!existsSync(processPath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(processPath, "utf-8")) as UnknownRecord;
    return readNumber(parsed?.port);
  } catch {
    return undefined;
  }
}

function resolveWebBaseUrl(api: any, syncTriggerConfig: UnknownRecord | undefined): string {
  const fromConfig = readString(syncTriggerConfig?.webBaseUrl);
  if (fromConfig) {
    return fromConfig.replace(/\/$/, "");
  }
  const fromEnv = readString(process.env.DENCHCLAW_WEB_BASE_URL);
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  const port = resolveWebPortFromProcessFile(resolveStateDir()) ?? DEFAULT_WEB_PORT;
  return `http://127.0.0.1:${port}`;
}

/**
 * Categorize a tick outcome into a coarse failure mode for log throttling.
 * We deliberately collapse all 4xx into one bucket and all 5xx into
 * another, since the user only cares "is the route there / is the
 * endpoint healthy?" — not the exact status delta.
 */
type TickOutcome =
  | { kind: "ok" }
  | { kind: "http"; statusBucket: "4xx" | "5xx" | "other"; status: number }
  | { kind: "timeout" }
  | { kind: "network"; message: string };

function outcomeKey(outcome: TickOutcome): string {
  switch (outcome.kind) {
    case "ok":
      return "ok";
    case "http":
      return `http:${outcome.statusBucket}`;
    case "timeout":
      return "timeout";
    case "network":
      return `network:${outcome.message}`;
  }
}

function describeOutcome(outcome: TickOutcome): string {
  switch (outcome.kind) {
    case "ok":
      return "ok";
    case "http":
      return `HTTP ${outcome.status}`;
    case "timeout":
      return `timed out after ${FETCH_TIMEOUT_MS}ms`;
    case "network":
      return outcome.message;
  }
}

function bucketFor(status: number): "4xx" | "5xx" | "other" {
  if (status >= 400 && status < 500) {
    return "4xx";
  }
  if (status >= 500 && status < 600) {
    return "5xx";
  }
  return "other";
}

/**
 * Arm the gateway-driven sync poll trigger. No-ops when:
 *
 * - The plugin's `syncTrigger.enabled` is explicitly `false`.
 * - No Dench Cloud API key is present (Dench Cloud isn't connected).
 *
 * The function is idempotent only via the `_armed` module-level guard —
 * since plugins are loaded once per gateway process boot and the gateway
 * exits/restarts to reload, this matches the actual lifecycle.
 */
let _armed = false;

export function armSyncTrigger(api: any): void {
  if (_armed) {
    return;
  }

  const config = resolveSyncTriggerConfig(api);
  if (config?.enabled === false) {
    api?.logger?.info?.(
      "[dench-ai-gateway] sync-trigger disabled via syncTrigger.enabled=false",
    );
    return;
  }

  const apiKey = readDenchAuthProfileKey();
  if (!apiKey) {
    api?.logger?.info?.(
      "[dench-ai-gateway] No Dench Cloud API key; sync trigger not armed.",
    );
    return;
  }

  const intervalMs = readNumber(config?.intervalMs) ?? DEFAULT_INTERVAL_MS;
  if (intervalMs < 1000) {
    api?.logger?.info?.(
      `[dench-ai-gateway] sync-trigger intervalMs=${intervalMs} below safety floor; not arming.`,
    );
    return;
  }

  const webBaseUrl = resolveWebBaseUrl(api, config);
  const tickUrl = `${webBaseUrl}/api/sync/poll-tick`;

  // Failure-streak state: we suppress repeated identical failures and
  // log a recovery line when the streak ends. Initial state is "ok"
  // (no previous failure to recover from).
  let lastOutcomeKey = "ok";

  async function tick(): Promise<void> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let outcome: TickOutcome;
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
      outcome = response.ok
        ? { kind: "ok" }
        : { kind: "http", statusBucket: bucketFor(response.status), status: response.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // AbortError is what fetch throws when the timeout AbortController
      // fires; surface it as a distinct timeout outcome so streak logging
      // can collapse it independently of plain network errors.
      const aborted =
        err instanceof Error &&
        (err.name === "AbortError" || /aborted/i.test(message));
      outcome = aborted
        ? { kind: "timeout" }
        : { kind: "network", message };
    } finally {
      clearTimeout(timeoutHandle);
    }

    const key = outcomeKey(outcome);
    const wasFailing = lastOutcomeKey !== "ok";
    if (outcome.kind === "ok") {
      if (wasFailing) {
        api?.logger?.info?.(
          `[dench-ai-gateway] sync-trigger recovered (was: ${lastOutcomeKey})`,
        );
      }
    } else if (key !== lastOutcomeKey) {
      // First failure in a streak (or failure mode changed). Log it.
      // Subsequent identical failures stay silent until things change.
      api?.logger?.info?.(
        `[dench-ai-gateway] sync-trigger tick ${describeOutcome(outcome)} from ${tickUrl}`,
      );
    }
    lastOutcomeKey = key;
  }

  // No immediate tick — see file header. Boots & redeploys would otherwise
  // race a half-up web app and produce alarming-looking 404/ECONNREFUSED
  // log lines that are actually expected.
  setInterval(() => {
    void tick();
  }, intervalMs);

  _armed = true;
  api?.logger?.info?.(
    `[dench-ai-gateway] sync-trigger armed (every ${intervalMs}ms → ${tickUrl})`,
  );
}

/**
 * Test-only helper: reset the module-level `_armed` guard so a test
 * can exercise `armSyncTrigger` multiple times in the same process.
 */
export function _resetSyncTriggerForTests(): void {
  _armed = false;
}
