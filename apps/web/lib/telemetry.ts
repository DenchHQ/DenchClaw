import { createHash } from "node:crypto";
import os from "node:os";
import { PostHog } from "posthog-node";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || "";
const POSTHOG_HOST = "https://us.i.posthog.com";

let client: PostHog | null = null;

export function getAnonymousId(): string {
  try {
    const raw = `${os.hostname()}:${os.userInfo().username}`;
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

function ensureClient(): PostHog | null {
  if (!POSTHOG_KEY) return null;
  if (!client) {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      flushAt: 10,
      flushInterval: 30_000,
    });
  }
  return client;
}

export function trackServer(event: string, properties?: Record<string, unknown>): void {
  const ph = ensureClient();
  if (!ph) return;

  ph.capture({
    distinctId: getAnonymousId(),
    event,
    properties: {
      ...properties,
      $process_person_profile: false,
    },
  });
}
