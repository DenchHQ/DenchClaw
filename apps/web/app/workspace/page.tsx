"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { UnicodeSpinner } from "../components/unicode-spinner";

/**
 * Legacy /workspace route: redirect to root preserving query params.
 */
export default function WorkspaceRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    const qs = window.location.search;
    const hash = window.location.hash;
    router.replace(`/${qs}${hash}`);
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center" style={{ background: "var(--color-bg)" }}>
      <UnicodeSpinner name="braille" className="text-2xl" style={{ color: "var(--color-text-muted)" }} />
    </div>
  );
}
