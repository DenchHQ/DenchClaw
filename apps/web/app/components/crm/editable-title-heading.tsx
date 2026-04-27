"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Inline-editable heading for CRM Person / Company detail pages.
 *
 * Behavior:
 *   - When `name` is non-empty: renders the original h1 markup unchanged.
 *     This is intentional — issue #7 was "let me ADD a name when one is
 *     missing", not "let me edit existing names from the heading". Keeping
 *     the populated case visually identical avoids regressing established
 *     muscle memory for users who do already have names set.
 *   - When `name` is empty/whitespace: renders a clickable button with a
 *     pen icon and italic "Add a name" prompt. Click (or Enter / Space)
 *     swaps it for an inline input styled identically to the heading.
 *     Save on Enter or blur; cancel on Escape; empty submit cancels.
 *     Errors render as a small inline message next to the input rather
 *     than blocking the page.
 *
 * The save handler is supplied by the parent because both callers
 * (Person, Company) hit the same workspace PATCH endpoint
 * `/api/workspace/objects/{name}/entries/{id}` but with different field
 * names — "Full Name" vs "Company Name". Parents are also responsible
 * for updating their local state on success so the heading reflects the
 * new value without a full skeleton-inducing reload.
 */
export function EditableTitleHeading({
  name,
  saveName,
}: {
  name: string | null;
  saveName: (newName: string) => Promise<void>;
}) {
  const trimmed = name?.trim() ?? "";
  const isEmpty = trimmed.length === 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const beginEdit = useCallback(() => {
    setDraft("");
    setError(null);
    setEditing(true);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft("");
    setError(null);
  }, []);

  const commit = useCallback(async () => {
    const next = draft.trim();
    if (!next) {
      cancelEdit();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveName(next);
      setEditing(false);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save name.");
    } finally {
      setSaving(false);
    }
  }, [draft, cancelEdit, saveName]);

  if (editing) {
    return (
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            void commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          disabled={saving}
          placeholder="Add a name"
          aria-label="Name"
          className="font-instrument text-3xl tracking-tight w-full min-w-0"
          style={{
            color: "var(--color-text)",
            background: "transparent",
            border: "none",
            outline: "none",
            padding: 0,
          }}
        />
        {error && (
          <span
            className="text-[12px] shrink-0"
            style={{ color: "var(--color-error)" }}
            role="alert"
          >
            {error}
          </span>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <button
        type="button"
        onClick={beginEdit}
        title="Add a name"
        aria-label="Add a name"
        className="font-instrument text-3xl tracking-tight inline-flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity outline-none focus-visible:ring-2 rounded-sm"
        style={{
          color: "var(--color-text-muted)",
          background: "transparent",
          border: "none",
          padding: 0,
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
        <span style={{ fontStyle: "italic" }}>Add a name</span>
      </button>
    );
  }

  return (
    <h1
      className="font-instrument text-3xl tracking-tight truncate"
      style={{ color: "var(--color-text)" }}
    >
      {trimmed}
    </h1>
  );
}
