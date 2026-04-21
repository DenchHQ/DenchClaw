/**
 * Web-side mirror of `extensions/shared/dench-auth.ts#readDenchAuthProfileKey`.
 *
 * Reads the Dench Cloud API key from the same single source of truth
 * (`<stateDir>/agents/main/agent/auth-profiles.json#profiles["dench-cloud:default"].key`)
 * that the OpenClaw gateway and bundled plugins use, with the same
 * env-var fallback. Kept as a separate file (rather than importing from
 * `../../extensions/shared/dench-auth.ts`) so the Next.js bundler
 * doesn't have to reach across the workspace boundary.
 *
 * Used by the loopback `/api/sync/poll-tick` endpoint to validate the
 * Bearer token sent by the `dench-ai-gateway` plugin's sync trigger.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

const AUTH_PROFILES_REL = join("agents", "main", "agent", "auth-profiles.json");

type UnknownRecord = Record<string, unknown>;

function readKeyFromAuthProfiles(authPath: string): string | undefined {
  try {
    if (!existsSync(authPath)) {
      return undefined;
    }
    const raw = JSON.parse(readFileSync(authPath, "utf-8")) as UnknownRecord;
    const profiles = (raw?.profiles as UnknownRecord | undefined) ?? undefined;
    const profile = (profiles?.["dench-cloud:default"] as UnknownRecord | undefined) ?? undefined;
    const key = profile?.key;
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

function envFallback(): string | undefined {
  return (
    process.env.DENCH_CLOUD_API_KEY?.trim() ||
    process.env.DENCH_API_KEY?.trim() ||
    undefined
  );
}

export function readDenchAuthProfileKey(): string | undefined {
  const stateDir = resolveOpenClawStateDir();
  if (stateDir) {
    const key = readKeyFromAuthProfiles(join(stateDir, AUTH_PROFILES_REL));
    if (key) {
      return key;
    }
  }
  return envFallback();
}
