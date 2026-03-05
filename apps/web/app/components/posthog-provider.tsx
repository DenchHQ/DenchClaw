"use client";

import posthog from "posthog-js";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || "";
const POSTHOG_HOST = "https://us.i.posthog.com";

let initialized = false;

function initPostHog(anonymousId: string) {
  if (initialized || !POSTHOG_KEY || typeof window === "undefined") return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    bootstrap: {
      distinctID: anonymousId,
      isIdentifiedID: false,
    },
    capture_pageview: false,
    capture_pageleave: true,
    persistence: "memory",
    autocapture: false,
    disable_session_recording: true,
    person_profiles: "identified_only",
  });
  initialized = true;
}

export function PostHogPageviewTracker({ anonymousId }: { anonymousId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    initPostHog(anonymousId);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
