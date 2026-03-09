"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { DenchAppManifest } from "@/lib/workspace-shell-types";

/** Build a path-based URL for serving files from a .dench.app folder. */
export function appServeUrl(appPath: string, filePath: string): string {
  return `/api/apps/serve/${appPath}/${filePath}`;
}

type AppViewerProps = {
  appPath: string;
  manifest: DenchAppManifest;
};

export function AppViewer({ appPath, manifest }: AppViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const entryFile = manifest.entry || "index.html";
  const appUrl = appServeUrl(appPath, entryFile);

  const handleReload = useCallback(() => {
    setLoading(true);
    setError(null);
    if (iframeRef.current) {
      iframeRef.current.src = `${appUrl}?_t=${Date.now()}`;
    }
  }, [appUrl]);

  const handleIframeLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const handleIframeError = useCallback(() => {
    setLoading(false);
    setError("Failed to load app");
  }, []);

  // Set up postMessage bridge listener
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (!event.data || event.data.type !== "dench:request") return;

      const { id, method, params } = event.data;
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow || event.source !== iframe.contentWindow) return;

      const permissions = manifest.permissions || [];

      try {
        let result: unknown;

        if (method === "app.getManifest") {
          result = manifest;
        } else if (method === "app.getTheme") {
          result = document.documentElement.classList.contains("dark") ? "dark" : "light";
        } else if (method === "db.query" && permissions.includes("database")) {
          const res = await fetch("/api/workspace/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sql: params?.sql }),
          });
          result = await res.json();
        } else if (method === "db.execute" && permissions.includes("database")) {
          const res = await fetch("/api/workspace/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sql: params?.sql }),
          });
          result = await res.json();
        } else if (method === "files.read" && permissions.includes("files")) {
          const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(params?.path)}`);
          result = await res.json();
        } else if (method === "files.list" && permissions.includes("files")) {
          const res = await fetch(`/api/workspace/tree?showHidden=0`);
          result = await res.json();
        } else {
          iframe.contentWindow.postMessage({
            type: "dench:response",
            id,
            error: `Unknown method or insufficient permissions: ${method}`,
          }, "*");
          return;
        }

        iframe.contentWindow.postMessage({
          type: "dench:response",
          id,
          result,
        }, "*");
      } catch (err) {
        iframe.contentWindow?.postMessage({
          type: "dench:response",
          id,
          error: err instanceof Error ? err.message : "Unknown error",
        }, "*");
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [manifest]);

  const iconIsImage = manifest.icon && (
    manifest.icon.endsWith(".png") ||
    manifest.icon.endsWith(".svg") ||
    manifest.icon.endsWith(".jpg") ||
    manifest.icon.endsWith(".jpeg") ||
    manifest.icon.endsWith(".webp")
  );

  return (
    <div className="flex flex-col h-full">
      {/* App header bar */}
      <div
        className="flex items-center gap-3 px-5 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-border)" }}
      >
        {iconIsImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={appServeUrl(appPath, manifest.icon!)}
            alt=""
            width={20}
            height={20}
            className="rounded flex-shrink-0"
            style={{ objectFit: "cover" }}
          />
        ) : (
          <DefaultAppIcon />
        )}

        <span className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
          {manifest.name}
        </span>

        {manifest.version && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
            style={{
              background: "var(--color-accent-light)",
              color: "var(--color-accent)",
              border: "1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)",
            }}
          >
            v{manifest.version}
          </span>
        )}

        <span
          className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            background: "#6366f118",
            color: "#6366f1",
            border: "1px solid #6366f130",
          }}
        >
          APP
        </span>

        <div className="flex items-center gap-1 ml-auto">
          {/* Reload button */}
          <button
            type="button"
            onClick={handleReload}
            className="p-1.5 rounded-md transition-colors duration-100 cursor-pointer"
            style={{ color: "var(--color-text-muted)" }}
            title="Reload app"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
          </button>

          {/* Open in new tab */}
          <a
            href={appUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md transition-colors duration-100"
            style={{ color: "var(--color-text-muted)" }}
            title="Open in new tab"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" /><path d="M10 14 21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
          </a>
        </div>
      </div>

      {/* App content */}
      <div className="flex-1 overflow-hidden relative" style={{ background: "white" }}>
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10" style={{ background: "var(--color-bg)" }}>
            {iconIsImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={appServeUrl(appPath, manifest.icon!)}
                alt=""
                width={48}
                height={48}
                className="rounded-xl"
                style={{ objectFit: "cover" }}
              />
            ) : (
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: "var(--color-accent-light)" }}
              >
                <DefaultAppIcon size={24} />
              </div>
            )}
            <div
              className="w-5 h-5 border-2 rounded-full animate-spin"
              style={{
                borderColor: "var(--color-border)",
                borderTopColor: "var(--color-accent)",
              }}
            />
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Loading {manifest.name}...
            </p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10" style={{ background: "var(--color-bg)" }}>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: "color-mix(in srgb, var(--color-error) 10%, transparent)" }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" x2="9" y1="9" y2="15" />
                <line x1="9" x2="15" y1="9" y2="15" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
              {error}
            </p>
            <button
              type="button"
              onClick={handleReload}
              className="text-xs px-3 py-1.5 rounded-md cursor-pointer"
              style={{
                color: "var(--color-accent)",
                background: "var(--color-accent-light)",
              }}
            >
              Try again
            </button>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={appUrl}
          className="w-full h-full border-0"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          title={manifest.name}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          style={{ minHeight: "calc(100vh - 120px)" }}
        />
      </div>
    </div>
  );
}

function DefaultAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" />
    </svg>
  );
}
