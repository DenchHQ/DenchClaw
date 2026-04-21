/**
 * Loopback-only endpoint hit by the OpenClaw gateway's `dench-ai-gateway`
 * plugin every ~5 minutes (see `extensions/dench-ai-gateway/sync-trigger.ts`).
 *
 * The gateway is the long-lived process that owns the timing now — the
 * web app just runs one Gmail/Calendar incremental cycle per call. This
 * lets the cron survive `denchclaw update` and Next.js restarts.
 *
 * Auth: validates a Bearer token against the same Dench Cloud API key the
 * plugin reads (`<stateDir>/agents/main/agent/auth-profiles.json#profiles["dench-cloud:default"].key`).
 * No new secret to provision — if Dench Cloud isn't connected, the
 * plugin doesn't fire requests AND the endpoint rejects them.
 *
 * Hardening:
 * - Constant-time key compare (`crypto.timingSafeEqual`).
 * - Loopback-only host check on the request as defense-in-depth, in case
 *   the runtime is misconfigured to bind to a public interface.
 */

import { timingSafeEqual } from "node:crypto";
import { readDenchAuthProfileKey } from "@/lib/dench-auth";
import {
  getLastProgressEvent,
  isBackfillRunning,
  tickPoller,
} from "@/lib/sync-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) {
    return null;
  }
  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Normalize a request host (`Host` or `X-Forwarded-Host`) and decide
 * whether it points at the loopback interface. We accept localhost and
 * 127.0.0.0/8 / ::1 only; anything else is treated as a misconfigured
 * deployment and rejected.
 */
function isLoopbackHost(rawHost: string | null): boolean {
  if (!rawHost) {
    return false;
  }
  const host = rawHost.split(",")[0]?.trim().toLowerCase();
  if (!host) {
    return false;
  }
  // Strip trailing port (`localhost:3100` → `localhost`). Handles
  // bracketed IPv6 (`[::1]:3100` → `::1`).
  let bare = host;
  if (bare.startsWith("[")) {
    const closing = bare.indexOf("]");
    bare = closing > 0 ? bare.slice(1, closing) : bare;
  } else {
    const lastColon = bare.lastIndexOf(":");
    if (lastColon > 0 && /^\d+$/.test(bare.slice(lastColon + 1))) {
      bare = bare.slice(0, lastColon);
    }
  }
  return (
    bare === "localhost" ||
    bare === "127.0.0.1" ||
    bare === "::1" ||
    bare.startsWith("127.")
  );
}

export async function POST(req: Request) {
  const hostHeader =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!isLoopbackHost(hostHeader)) {
    return Response.json(
      { error: "poll-tick is loopback-only" },
      { status: 403 },
    );
  }

  const presented = extractBearer(req.headers.get("authorization"));
  if (!presented) {
    return Response.json(
      { error: "Missing Bearer token" },
      { status: 401 },
    );
  }

  const expected = readDenchAuthProfileKey();
  if (!expected) {
    return Response.json(
      { error: "Dench Cloud API key not configured" },
      { status: 503 },
    );
  }

  if (!safeEqual(presented, expected)) {
    return Response.json(
      { error: "Invalid token" },
      { status: 401 },
    );
  }

  if (isBackfillRunning()) {
    return Response.json({
      ok: true,
      skipped: "backfill-in-progress",
    });
  }

  try {
    await tickPoller();
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "tickPoller failed",
      },
      { status: 500 },
    );
  }

  // tickPoller doesn't return a summary; surface the most recent event so
  // logs / debugging tools can see what the tick actually did.
  return Response.json({
    ok: true,
    ranAt: new Date().toISOString(),
    lastEvent: getLastProgressEvent(),
  });
}
