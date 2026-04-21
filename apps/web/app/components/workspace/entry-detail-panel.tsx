"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { RelationSelect } from "./relation-select";
import { FormattedFieldValue } from "./formatted-field-value";
import { formatWorkspaceFieldValue } from "@/lib/workspace-cell-format";
import { parseTagsValue } from "@/lib/parse-tags";
import { displayObjectName, displayObjectNameSingular } from "@/lib/object-display-name";
import { MarkdownEditor } from "./markdown-editor";
import type { TreeNode, MentionSearchFn } from "./slash-command";
import { ActionButton, type ActionConfig } from "./action-button";
import { ConfirmDialog } from "./confirm-dialog";
import { useToast } from "./toast";
import { UrlFavicon } from "./url-favicon";
import { LinkOpenButton } from "./link-open-button";
import { LinkPreviewWrapper } from "./workspace-link";

function safeString(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "object") return JSON.stringify(val);
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean" || typeof val === "bigint") return String(val);
  return "";
}

const CREATED_AT_KEYS = ["created_at", "Created", "createdAt", "created"] as const;
const UPDATED_AT_KEYS = ["updated_at", "Updated", "updatedAt", "updated"] as const;

type Field = {
  id: string;
  name: string;
  type: string;
  enum_values?: string[];
  enum_colors?: string[];
  enum_multiple?: boolean;
  related_object_id?: string;
  relationship_type?: string;
  related_object_name?: string;
  sort_order?: number;
  default_value?: string;
};

type ReverseRelation = {
  fieldName: string;
  sourceObjectName: string;
  sourceObjectId: string;
  displayField: string;
  links: Array<{ id: string; label: string }>;
};

type EntryDetailData = {
  object: { id: string; name: string; description?: string; icon?: string };
  fields: Field[];
  entry: Record<string, unknown>;
  relationLabels?: Record<string, Record<string, string>>;
  reverseRelations?: ReverseRelation[];
  effectiveDisplayField?: string;
};

export type EntryDetailPanelProps = {
  objectName: string;
  entryId: string;
  members?: Array<{ id: string; name: string; email: string; role: string }>;
  tree: TreeNode[];
  searchFn?: MentionSearchFn;
  onClose: () => void;
  /**
   * Open the entry's detail view. The optional `relatedObjectId` lets the
   * parent route precisely (CRM seed people/company → dedicated profile,
   * everything else → generic side-panel modal).
   */
  onNavigateEntry?: (
    objectName: string,
    entryId: string,
    relatedObjectId?: string,
  ) => void;
  onNavigateObject?: (objectName: string) => void;
  onRefresh?: () => void;
  onNavigate?: (path: string) => void;
};

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean" },
  { value: "enum", label: "Select" },
  { value: "tags", label: "Tags" },
  { value: "url", label: "URL" },
  { value: "richtext", label: "Rich Text" },
  { value: "action", label: "Action" },
] as const;

function parseActionConfig(defaultValue: string | null | undefined): ActionConfig[] {
  if (!defaultValue) return [];
  try {
    const parsed = JSON.parse(defaultValue);
    if (parsed && Array.isArray(parsed.actions)) return parsed.actions;
  } catch { /* ignore */ }
  return [];
}

// ── Helpers ──

function parseRelationValue(value: string | null | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch { /* not JSON */ }
  }
  return [trimmed];
}

function inputTypeForField(fieldType: string): React.HTMLInputTypeAttribute {
  switch (fieldType) {
    case "number": return "number";
    case "date": return "date";
    case "email": return "email";
    case "phone": return "tel";
    case "url": return "url";
    default: return "text";
  }
}

function resolveEntryMetaValue(entry: Record<string, unknown>, candidateKeys: readonly string[]): unknown {
  for (const key of candidateKeys) {
    const value = entry[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return undefined;
}

// ── Cell renderers ──

function EnumBadge({ value, enumValues, enumColors }: { value: string; enumValues?: string[]; enumColors?: string[] }) {
  const idx = enumValues?.indexOf(value) ?? -1;
  const color = idx >= 0 && enumColors ? enumColors[idx] : "#94a3b8";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
    >
      {value}
    </span>
  );
}

function UserBadge({ value, members }: { value: unknown; members?: Array<{ id: string; name: string }> }) {
  const memberId = String(value);
  const member = members?.find((m) => m.id === memberId);
  return (
    <span className="flex items-center gap-2">
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0"
        style={{ background: "var(--color-accent)", color: "white" }}
      >
        {(member?.name ?? memberId).charAt(0).toUpperCase()}
      </span>
      <span className="text-sm">{member?.name ?? memberId}</span>
    </span>
  );
}

function RelationChips({
  value, field, relationLabels, onNavigateEntry,
}: {
  value: unknown; field: Field;
  relationLabels?: Record<string, Record<string, string>>;
  onNavigateEntry?: (
    objectName: string,
    entryId: string,
    relatedObjectId?: string,
  ) => void;
}) {
  const fieldLabels = relationLabels?.[field.name];
  const ids = value == null ? [] : parseRelationValue(String(value));
  if (ids.length === 0) return <EmptyValue />;
  return (
    <span className="flex items-center gap-1 flex-wrap">
      {ids.map((id) => {
        const label = fieldLabels?.[id] ?? id;
        const handleClick = field.related_object_name && onNavigateEntry
          ? (e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              onNavigateEntry(
                field.related_object_name!,
                id,
                field.related_object_id,
              );
            }
          : undefined;
        return (
          <button type="button" key={id} onClick={handleClick}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${handleClick ? "cursor-pointer hover:opacity-80" : ""}`}
            style={{ background: "rgba(96, 165, 250, 0.1)", color: "#60a5fa", border: "1px solid rgba(96, 165, 250, 0.2)" }}
            title={handleClick ? `Open ${label}` : label}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><path d="M7 7h10v10" /><path d="M7 17 17 7" /></svg>
            <span className="truncate max-w-[180px]">{label}</span>
          </button>
        );
      })}
    </span>
  );
}

function TagsBadges({ value }: { value: unknown }) {
  const tags = parseTagsValue(value);
  if (tags.length === 0) return <EmptyValue />;
  const chipStyle = { background: "rgba(148, 163, 184, 0.12)", border: "1px solid var(--color-border)" };
  return (
    <span className="flex items-center gap-1 flex-wrap">
      {tags.map((tag) => {
        const formatted = formatWorkspaceFieldValue(tag);
        const isLink = formatted.kind === "link" && formatted.href;
        const showFavicon = formatted.linkType === "url" && !!formatted.faviconUrl;
        const openInNewTab = formatted.linkType === "url" || formatted.linkType === "file";
        if (isLink) {
          const chip = (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium max-w-[240px]"
              style={{ ...chipStyle, color: "var(--color-accent)" }}
            >
              {showFavicon && (
                <UrlFavicon
                  src={formatted.faviconUrl!}
                  className="w-3.5 h-3.5 rounded-[3px] shrink-0"
                />
              )}
              <span className="min-w-0 truncate">{formatted.text}</span>
              <LinkOpenButton
                href={formatted.href!}
                openInNewTab={openInNewTab}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-black/5"
              />
            </span>
          );
          return formatted.linkType === "url" ? (
            <LinkPreviewWrapper key={tag} href={formatted.href!}>{chip}</LinkPreviewWrapper>
          ) : <span key={tag}>{chip}</span>;
        }
        return (
          <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ ...chipStyle, color: "var(--color-text-muted)" }}>
            {tag}
          </span>
        );
      })}
    </span>
  );
}

function TagsEditInput({ value, onChange, autoFocus }: { value: string; onChange: (val: string) => void; autoFocus?: boolean }) {
  const tags = parseTagsValue(value);
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus && inputRef.current) inputRef.current.focus(); }, [autoFocus]);

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (!t || tags.includes(t)) return;
    onChange(JSON.stringify([...tags, t]));
    setInputVal("");
  };
  const removeTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag);
    onChange(next.length > 0 ? JSON.stringify(next) : "");
  };

  return (
    <div className="flex items-center gap-1 flex-wrap min-h-[1.5rem]">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ background: "rgba(148, 163, 184, 0.12)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
          {tag}
          <button type="button" onClick={() => removeTag(tag)} className="ml-0.5 hover:opacity-70" style={{ color: "var(--color-text-muted)" }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </span>
      ))}
      <input ref={inputRef} type="text" value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && inputVal.trim()) { e.preventDefault(); addTag(inputVal); }
          if (e.key === "Backspace" && !inputVal && tags.length > 0) removeTag(tags[tags.length - 1]);
        }}
        onBlur={() => { if (inputVal.trim()) addTag(inputVal); }}
        placeholder={tags.length === 0 ? "Type and press Enter..." : ""}
        className="flex-1 min-w-[60px] text-xs outline-none bg-transparent" style={{ color: "var(--color-text)" }}
      />
    </div>
  );
}

function EmptyValue() {
  return <span style={{ color: "var(--color-text-muted)", opacity: 0.5 }} className="text-sm">Empty</span>;
}

function FieldValue({
  value, field, members, relationLabels, onNavigateEntry,
}: {
  value: unknown; field: Field;
  members?: Array<{ id: string; name: string }>;
  relationLabels?: Record<string, Record<string, string>>;
  onNavigateEntry?: (
    objectName: string,
    entryId: string,
    relatedObjectId?: string,
  ) => void;
}) {
  if (value === null || value === undefined || value === "") return <EmptyValue />;
  switch (field.type) {
    case "enum": return <EnumBadge value={safeString(value)} enumValues={field.enum_values} enumColors={field.enum_colors} />;
    case "boolean": {
      const isTrue = value === true || value === "true" || value === "1" || value === "yes";
      return <span style={{ color: isTrue ? "#22c55e" : "var(--color-text-muted)" }}>{isTrue ? "Yes" : "No"}</span>;
    }
    case "user": return <UserBadge value={value} members={members} />;
    case "relation": return <RelationChips value={value} field={field} relationLabels={relationLabels} onNavigateEntry={onNavigateEntry} />;
    case "tags": return <TagsBadges value={value} />;
    default: return <FormattedFieldValue value={value} fieldType={field.type} mode="detail" showUrlFavicon linkInteractionMode="button" />;
  }
}

function ReverseRelationSection({ relation, onNavigateEntry }: {
  relation: ReverseRelation;
  onNavigateEntry?: (
    objectName: string,
    entryId: string,
    relatedObjectId?: string,
  ) => void;
}) {
  const displayLinks = relation.links.slice(0, 10);
  const overflow = relation.links.length - displayLinks.length;
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
        <span>{displayObjectName(relation.sourceObjectName)}</span>
        <span className="normal-case tracking-normal font-normal opacity-60">via {relation.fieldName}</span>
      </label>
      <div className="flex items-center gap-1 flex-wrap text-sm min-h-[1.5rem]">
        {displayLinks.map((link) => (
          <button type="button" key={link.id} onClick={() => onNavigateEntry?.(relation.sourceObjectName, link.id, relation.sourceObjectId)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium cursor-pointer hover:opacity-80"
            style={{ background: "rgba(192, 132, 252, 0.1)", color: "#c084fc", border: "1px solid rgba(192, 132, 252, 0.2)" }}
            title={`Open ${link.label} in ${displayObjectName(relation.sourceObjectName)}`}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><path d="M7 7h10v10" /><path d="M7 17 17 7" /></svg>
            <span className="truncate max-w-[180px]">{link.label}</span>
          </button>
        ))}
        {overflow > 0 && <span className="text-xs px-1 py-0.5 rounded" style={{ color: "var(--color-text-muted)" }}>+{overflow} more</span>}
      </div>
    </div>
  );
}

// ── Add Property Form ──

function AddPropertyForm({ objectName, onCreated, onCancel }: {
  objectName: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [enumInput, setEnumInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const body: Record<string, unknown> = { name: name.trim(), type };
    if (type === "enum") {
      const vals = enumInput.split(",").map((s) => s.trim()).filter(Boolean);
      if (vals.length === 0) { setError("Add at least one option"); return; }
      body.enum_values = vals;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        setError(data.error ?? "Failed to create field");
        return;
      }
      onCreated();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-3 rounded-lg" style={{ background: "var(--color-surface-hover)", border: "1px solid var(--color-border)" }}>
      <div className="flex items-center gap-2">
        <input ref={inputRef} type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Property name" className="flex-1 px-2 py-1 text-sm rounded-md outline-none"
          style={{ background: "var(--color-bg)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}
          className="px-2 py-1 text-sm rounded-md outline-none"
          style={{ background: "var(--color-bg)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
        >
          {FIELD_TYPES.map((ft) => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
        </select>
      </div>
      {type === "enum" && (
        <input type="text" value={enumInput} onChange={(e) => setEnumInput(e.target.value)}
          placeholder="Options (comma-separated)" className="px-2 py-1 text-sm rounded-md outline-none"
          style={{ background: "var(--color-bg)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
        />
      )}
      {error && <p className="text-xs" style={{ color: "var(--color-error)" }}>{error}</p>}
      <div className="flex items-center gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-2 py-1 text-xs rounded-md" style={{ color: "var(--color-text-muted)" }}>Cancel</button>
        <button type="submit" disabled={saving || !name.trim()} className="px-3 py-1 text-xs rounded-md font-medium disabled:opacity-50"
          style={{ background: "var(--color-accent)", color: "white" }}
        >{saving ? "Adding..." : "Add"}</button>
      </div>
    </form>
  );
}

// ── Skeleton ──

function PropertySkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-24 h-3 rounded animate-pulse" style={{ background: "var(--color-surface-hover)" }} />
          <div className="flex-1 h-4 rounded animate-pulse" style={{ background: "var(--color-surface-hover)" }} />
        </div>
      ))}
    </div>
  );
}

// ── Main Panel ──

export function EntryDetailPanel({
  objectName, entryId, members, tree, searchFn,
  onClose, onNavigateEntry, onNavigateObject, onRefresh, onNavigate,
}: EntryDetailPanelProps) {
  const [data, setData] = useState<EntryDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const showToast = useToast();

  const [mdContent, setMdContent] = useState("");
  const [mdFilePath, setMdFilePath] = useState(`${objectName}/${entryId}.md`);
  const [mdLoading, setMdLoading] = useState(true);

  // Fetch entry data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/entries/${encodeURIComponent(entryId)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed to load" }));
          if (!cancelled) { setError(err.error ?? "Failed to load entry"); setLoading(false); }
          return;
        }
        const json = await res.json();
        if (!cancelled) { setData(json); setLoading(false); }
      } catch {
        if (!cancelled) { setError("Network error"); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [objectName, entryId]);

  // Fetch markdown content
  useEffect(() => {
    let cancelled = false;
    setMdLoading(true);

    (async () => {
      try {
        const res = await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/entries/${encodeURIComponent(entryId)}/content`);
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            setMdContent(json.content ?? "");
            if (json.path) setMdFilePath(json.path);
          }
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setMdLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [objectName, entryId]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingField && !showAddProperty) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, editingField, showAddProperty]);

  const handleSaveField = useCallback(async (fieldName: string, value: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/entries/${encodeURIComponent(entryId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { [fieldName]: value } }),
      });
      if (res.ok) {
        setData((prev) => prev ? { ...prev, entry: { ...prev.entry, [fieldName]: value } } : prev);
        setEditingField(null);
        onRefresh?.();
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }, [objectName, entryId, onRefresh]);

  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; message: string; variant: "default" | "destructive";
    confirmLabel: string; onConfirm: () => void;
  } | null>(null);

  const handleDelete = useCallback(() => {
    setConfirmState({
      open: true,
      title: "Delete this entry?",
      message: "This action cannot be undone. The entry will be permanently removed.",
      variant: "destructive",
      confirmLabel: "Delete",
      onConfirm: async () => {
        setConfirmState(null);
        setDeleting(true);
        try {
          await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/entries/${encodeURIComponent(entryId)}`, { method: "DELETE" });
          onRefresh?.();
          onClose();
        } catch { /* ignore */ }
        finally { setDeleting(false); }
      },
    });
  }, [objectName, entryId, onRefresh, onClose]);

  const handlePropertyCreated = useCallback(() => {
    setShowAddProperty(false);
    // Re-fetch entry data to include the new field
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/entries/${encodeURIComponent(entryId)}`);
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
    onRefresh?.();
  }, [objectName, entryId, onRefresh]);

  const displayField = data?.effectiveDisplayField;
  const objectLabel = displayObjectNameSingular(String(objectName));
  const title = displayField && data?.entry[displayField] ? safeString(data.entry[displayField]) : `${objectLabel} entry`;
  const createdAtValue = data ? resolveEntryMetaValue(data.entry, CREATED_AT_KEYS) : undefined;
  const updatedAtValue = data ? resolveEntryMetaValue(data.entry, UPDATED_AT_KEYS) : undefined;

  const [propsCollapsed, setPropsCollapsed] = useState(false);

  const dataFieldsList = useMemo(() => data?.fields.filter((f) => f.type !== "action") ?? [], [data?.fields]);
  const actionFieldsList = useMemo(() => data?.fields.filter((f) => f.type === "action") ?? [], [data?.fields]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "var(--color-bg)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button type="button" onClick={() => void onNavigateObject?.(objectName)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors hover:opacity-80 flex-shrink-0"
            style={{ background: "var(--color-accent-light)", color: "var(--color-accent)", border: "1px solid var(--color-border)" }}
            title={`Go to ${objectLabel}`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v18" /><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" />
            </svg>
            {objectLabel}
          </button>
          <h2 className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
            {loading ? "" : title}
          </h2>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" onClick={() => void handleDelete()} disabled={deleting}
            className="p-1 rounded-md flex-shrink-0 hover:opacity-80" style={{ color: "var(--color-error)" }} title="Delete entry"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
          <button type="button" onClick={onClose} className="p-1 rounded-md flex-shrink-0 hover:opacity-80" style={{ color: "var(--color-text-muted)" }} title="Close (Esc)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Single scroll container for everything */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {/* Properties section */}
        <div className="px-5 pt-4 pb-2">
          {loading && <PropertySkeleton />}
          {error && (
            <div className="py-8 text-center">
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>{error}</p>
            </div>
          )}
          {data && !loading && (
            <>
              {/* Toggle header for properties */}
              <button
                type="button"
                onClick={() => setPropsCollapsed((v) => !v)}
                className="flex items-center gap-1.5 mb-2 text-[11px] font-medium uppercase tracking-wider hover:opacity-70 transition-opacity"
                style={{ color: "var(--color-text-muted)" }}
              >
                <svg
                  width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className="transition-transform" style={{ transform: propsCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
                Properties
              </button>

              {!propsCollapsed && (
                <div className="space-y-0.5 mb-2">
                  {dataFieldsList.map((field) => {
                    const value = data.entry[field.name];
                    return (
                      <div key={field.id} className="entry-detail-row">
                        <div className="entry-detail-label" title={field.name}>
                          {field.name}
                        </div>

                        <div className="entry-detail-value">
                          {editingField === field.name ? (
                            field.type === "tags" ? (
                              <div className="flex items-center gap-1 w-full">
                                <div className="flex-1 px-2 py-0.5 rounded-md" style={{ background: "var(--color-surface-hover)", border: "2px solid var(--color-accent)" }}>
                                  <TagsEditInput value={safeString(value)} onChange={(v) => { void handleSaveField(field.name, v); }} autoFocus />
                                </div>
                                <button type="button" onClick={() => setEditingField(null)} className="px-1.5 py-0.5 text-xs rounded-md flex-shrink-0" style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Done</button>
                              </div>
                            ) : field.type === "relation" && field.related_object_name ? (
                              <div className="flex items-center gap-1 w-full">
                                <div className="flex-1 min-w-0">
                                  <RelationSelect relatedObjectName={field.related_object_name} value={safeString(value)} multiple={field.relationship_type === "many_to_many"}
                                    onChange={(v) => { void handleSaveField(field.name, v); }} autoFocus />
                                </div>
                                <button type="button" onClick={() => setEditingField(null)} className="px-1.5 py-0.5 text-xs rounded-md flex-shrink-0" style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
                              </div>
                            ) : (
                              <form onSubmit={(e) => { e.preventDefault(); void handleSaveField(field.name, editValue); }} className="flex items-center gap-1 w-full">
                                {field.type === "enum" && field.enum_values ? (
                                  <select value={editValue} onChange={(e) => { setEditValue(e.target.value); void handleSaveField(field.name, e.target.value); }} autoFocus
                                    className="flex-1 min-w-0 px-2 py-0.5 text-sm rounded-md outline-none" style={{ background: "var(--color-surface-hover)", color: "var(--color-text)", border: "2px solid var(--color-accent)" }}>
                                    <option value="">--</option>
                                    {field.enum_values.map((v) => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                ) : field.type === "boolean" ? (
                                  <select value={editValue} onChange={(e) => { setEditValue(e.target.value); void handleSaveField(field.name, e.target.value); }} autoFocus
                                    className="flex-1 min-w-0 px-2 py-0.5 text-sm rounded-md outline-none" style={{ background: "var(--color-surface-hover)", color: "var(--color-text)", border: "2px solid var(--color-accent)" }}>
                                    <option value="true">Yes</option>
                                    <option value="false">No</option>
                                  </select>
                                ) : (
                                  <>
                                    <input type={inputTypeForField(field.type)} value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus
                                      className="flex-1 min-w-0 px-2 py-0.5 text-sm rounded-md outline-none" style={{ background: "var(--color-surface-hover)", color: "var(--color-text)", border: "2px solid var(--color-accent)" }} />
                                    <button type="submit" disabled={saving} className="px-1.5 py-0.5 text-xs rounded-md font-medium flex-shrink-0" style={{ background: "var(--color-accent)", color: "white" }}>
                                      {saving ? "..." : "Save"}
                                    </button>
                                  </>
                                )}
                                <button type="button" onClick={() => setEditingField(null)} className="px-1.5 py-0.5 text-xs rounded-md flex-shrink-0" style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
                              </form>
                            )
                          ) : (
                            <div
                              className={`py-0.5 px-1.5 -mx-1.5 rounded-md transition-colors ${!["user"].includes(field.type) ? "cursor-pointer hover:bg-[var(--color-surface-hover)]" : ""}`}
                              onClick={() => {
                                if (!["user"].includes(field.type)) { setEditingField(field.name); setEditValue(safeString(value)); }
                              }}
                              title={!["user"].includes(field.type) ? "Click to edit" : undefined}
                            >
                              <FieldValue value={value} field={field} members={members} relationLabels={data.relationLabels} onNavigateEntry={onNavigateEntry} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Add property */}
                  {showAddProperty ? (
                    <AddPropertyForm objectName={objectName} onCreated={handlePropertyCreated} onCancel={() => setShowAddProperty(false)} />
                  ) : (
                    <button type="button" onClick={() => setShowAddProperty(true)}
                      className="flex items-center gap-1.5 text-xs py-1.5 px-1 rounded-md hover:bg-[var(--color-surface-hover)] transition-colors mt-1"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                      Add a property
                    </button>
                  )}

                  {/* Action buttons */}
                  {actionFieldsList.length > 0 && (
                    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
                      <div className="text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: "var(--color-text-muted)" }}>
                        Actions
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {actionFieldsList.map((af) => {
                          const actions = parseActionConfig(af.default_value);
                          return actions.map((action) => (
                            <ActionButton
                              key={`${af.id}_${action.id}`}
                              action={action}
                              entryId={entryId}
                              objectName={objectName}
                              fieldId={af.id}
                              onToast={showToast}
                              onRequestConfirm={(act, _eid, onConfirm) => {
                                setConfirmState({
                                  open: true,
                                  title: act.label,
                                  message: act.confirmMessage ?? `Run "${act.label}" on this entry?`,
                                  variant: act.variant === "destructive" ? "destructive" : "default",
                                  confirmLabel: act.label,
                                  onConfirm: () => { setConfirmState(null); onConfirm(); },
                                });
                              }}
                            />
                          ));
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Reverse relations */}
              {!propsCollapsed && data.reverseRelations && data.reverseRelations.length > 0 && (
                <div className="pb-2 space-y-2">
                  <div className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--color-text-muted)", opacity: 0.6 }}>Linked from</div>
                  {data.reverseRelations.map((rr) => (
                    <ReverseRelationSection key={`${rr.sourceObjectName}_${rr.fieldName}`} relation={rr} onNavigateEntry={onNavigateEntry} />
                  ))}
                </div>
              )}

              {/* Timestamps */}
              {(createdAtValue != null || updatedAtValue != null) && (
                <div className="pb-2 text-[11px] flex gap-3 flex-wrap" style={{ color: "var(--color-text-muted)" }}>
                  {createdAtValue != null && <span>Created: <FormattedFieldValue value={createdAtValue} fieldType="date" mode="detail" className="inline" /></span>}
                  {updatedAtValue != null && <span>Updated: <FormattedFieldValue value={updatedAtValue} fieldType="date" mode="detail" className="inline" /></span>}
                </div>
              )}
            </>
          )}
        </div>

        {/* Editor section — occupies remaining space */}
        {!loading && !error && (
          <div className="entry-detail-editor">
            {mdLoading ? (
              <div className="px-5 py-6">
                <div className="space-y-2">
                  <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: "var(--color-surface-hover)" }} />
                  <div className="h-3 w-1/2 rounded animate-pulse" style={{ background: "var(--color-surface-hover)" }} />
                </div>
              </div>
            ) : (
              <MarkdownEditor
                content={mdContent}
                filePath={mdFilePath}
                tree={tree}
                onSave={onRefresh}
                onNavigate={onNavigate}
                searchFn={searchFn}
              />
            )}
          </div>
        )}
      </div>

      {confirmState && (
        <ConfirmDialog
          open={confirmState.open}
          title={confirmState.title}
          message={confirmState.message}
          variant={confirmState.variant}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}
