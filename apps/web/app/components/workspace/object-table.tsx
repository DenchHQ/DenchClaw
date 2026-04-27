"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { type ColumnDef, type CellContext } from "@tanstack/react-table";
import { DataTable, type RowAction, type ColumnSizingState } from "./data-table";
import { RelationSelect } from "./relation-select";
import { FormattedFieldValue } from "./formatted-field-value";
import { formatWorkspaceFieldValue } from "@/lib/workspace-cell-format";
import { parseTagsValue } from "@/lib/parse-tags";
import { displayObjectName, displayObjectNameSingular } from "@/lib/object-display-name";
import { ActionButton, useActionStates, type ActionConfig } from "./action-button";
import { ConfirmDialog } from "./confirm-dialog";
import { BulkActionBar } from "./bulk-action-bar";
import { useToast } from "./toast";
import { ColumnHeaderMenu, InlineRenameInput, AddColumnPopover, FieldTypeIcon, type EnrichmentStartPayload } from "./column-header-menu";
import { parseEnrichmentMeta } from "@/lib/enrichment-columns";
import { UrlFavicon } from "./url-favicon";
import { LinkOpenButton } from "./link-open-button";
import { LinkPreviewWrapper } from "./workspace-link";
import { RelationLink } from "./relation-link";

/* ─── Types ─── */

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
	entries: Record<string, Array<{ id: string; label: string }>>;
};

type ServerPaginationProps = {
	totalCount: number;
	page: number;
	pageSize: number;
	onPageChange: (page: number) => void;
	onPageSizeChange: (size: number) => void;
};

type ObjectTableProps = {
	objectName: string;
	fields: Field[];
	entries: Record<string, unknown>[];
	members?: Array<{ id: string; name: string }>;
	relationLabels?: Record<string, Record<string, string>>;
	/** Favicon URL per related entry, keyed by relation field name then entry
	 * id (mirrors `relationLabels` shape). Sparse — only set when the related
	 * entry has a URL field with a usable host. Used by `RelationCell` to
	 * render the elegant icon+name link UI; missing entries fall back to a
	 * letter monogram. */
	relationFaviconUrls?: Record<string, Record<string, string>>;
	reverseRelations?: ReverseRelation[];
	onNavigateToObject?: (objectName: string) => void;
	/**
	 * Open the entry's detail view. The optional `relatedObjectId` lets the
	 * parent route precisely (e.g. CRM seed people/company → dedicated profile,
	 * everything else → generic side-panel modal) instead of guessing from the
	 * raw object name, which collides with custom user objects.
	 */
	onNavigateToEntry?: (
		objectName: string,
		entryId: string,
		relatedObjectId?: string,
	) => void;
	onEntryClick?: (entryId: string) => void;
	onRefresh?: () => void;
	activeEntryId?: string;
	/** Column visibility state keyed by field ID. */
	columnVisibility?: Record<string, boolean>;
	onColumnVisibilityChanged?: (visibility: Record<string, boolean>) => void;
	/** Column widths keyed by field ID. */
	columnSizing?: ColumnSizingState;
	onColumnSizingChanged?: (sizing: ColumnSizingState) => void;
	/** Server-side pagination props. */
	serverPagination?: ServerPaginationProps;
	/** Server-side search callback. */
	onServerSearch?: (query: string) => void;
	/** When true, the DataTable's internal toolbar (search, columns, refresh, +Add) is suppressed. */
	hideInternalToolbar?: boolean;
	/** Controlled global filter value. When provided, the DataTable uses this instead of its own state. */
	globalFilter?: string;
	onGlobalFilterChange?: (value: string) => void;
	/** If provided, the table's +Add action delegates to this callback instead of opening the built-in modal. */
	onAddRequest?: () => void;
	/** Controlled sticky-first-column toggle. */
	stickyFirstColumnValue?: boolean;
	onStickyFirstColumnChange?: (value: boolean) => void;
};

type EntryRow = Record<string, unknown> & { entry_id?: string };

const CREATED_AT_KEYS = ["created_at", "Created", "createdAt", "created"] as const;
const UPDATED_AT_KEYS = ["updated_at", "Updated", "updatedAt", "updated"] as const;

/* ─── Helpers ─── */

/** Safely convert unknown (DuckDB) value to string for display. */
function safeString(val: unknown): string {
	if (val == null) {return "";}
	if (typeof val === "object") {return JSON.stringify(val);}
	if (typeof val === "string") {return val;}
	if (typeof val === "number" || typeof val === "boolean" || typeof val === "bigint") {return String(val);}
	// symbol, function
	return "";
}

function parseRelationValue(value: string | null | undefined): string[] {
	if (!value) {return [];}
	const trimmed = value.trim();
	if (!trimmed || trimmed === "null" || trimmed === "undefined") {return [];}
	if (trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed
					.map(String)
					.filter((id) => id && id !== "null" && id !== "undefined");
			}
		} catch { /* not JSON */ }
	}
	return [trimmed];
}

function inputTypeForField(fieldType: string): React.HTMLInputTypeAttribute {
	switch (fieldType) {
		case "number":
			return "number";
		case "date":
			return "date";
		case "email":
			return "email";
		case "phone":
			return "tel";
		case "url":
			return "url";
		default:
			return "text";
	}
}

function resolveEntryMetaValue(
	entry: Record<string, unknown>,
	candidateKeys: readonly string[],
): unknown {
	for (const key of candidateKeys) {
		const value = entry[key];
		if (value !== null && value !== undefined && value !== "") {
			return value;
		}
	}
	return undefined;
}

function computeEntryFaviconUrl(
	entry: Record<string, unknown>,
	candidateFields: Field[],
): string | undefined {
	for (const field of candidateFields) {
		const value = entry[field.name];
		if (value == null || value === "") {continue;}
		const formatted = formatWorkspaceFieldValue(value, field.type);
		if (formatted.kind === "link" && formatted.linkType === "url" && formatted.faviconUrl) {
			return formatted.faviconUrl;
		}
	}
	return undefined;
}

/** Stable getRowId: hoisted to module scope so its identity doesn't change
 * across renders (avoids re-keying the TanStack row map). */
function getRowIdFromEntry(row: EntryRow): string {
	const eid = row.entry_id;
	if (eid == null) {return "";}
	return String(typeof eid === "object" ? JSON.stringify(eid) : eid);
}

/* ─── Cell Renderers (read-only display) ─── */

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

function BooleanCell({ value }: { value: unknown }) {
	const isTrue = value === true || value === "true" || value === "1" || value === "yes";
	return (
		<span style={{ color: isTrue ? "var(--color-success)" : "var(--color-text-muted)" }}>
			{isTrue ? "Yes" : "No"}
		</span>
	);
}

function UserCell({ value, members }: { value: unknown; members?: Array<{ id: string; name: string }> }) {
	const memberId = String(value);
	const member = members?.find((m) => m.id === memberId);
	return (
		<span className="flex items-center gap-1.5">
			<span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0" style={{ background: "var(--color-accent)", color: "white" }}>
				{(member?.name ?? memberId).charAt(0).toUpperCase()}
			</span>
			<span className="truncate">{member?.name ?? memberId}</span>
		</span>
	);
}

function RelationCell({
	value, field, fieldLabels, fieldFaviconUrls, onNavigateObject, onNavigateEntry,
}: {
	value: unknown; field: Field;
	/** Labels for THIS field only (already narrowed). */
	fieldLabels?: Record<string, string>;
	/** Favicon URLs for THIS field only (already narrowed). Sparse — fall
	 * back to a letter monogram in the icon when an entry has no URL. */
	fieldFaviconUrls?: Record<string, string>;
	onNavigateObject?: (objectName: string) => void;
	onNavigateEntry?: (
		objectName: string,
		entryId: string,
		relatedObjectId?: string,
	) => void;
}) {
	const ids = value == null ? [] : parseRelationValue(String(value));
	if (ids.length === 0) {return <span style={{ color: "var(--color-text-muted)", opacity: 0.5 }}>--</span>;}
	const canNavigate =
		!!field.related_object_name && !!(onNavigateEntry || onNavigateObject);
	return (
		<span className="flex items-center gap-x-3 gap-y-1 flex-wrap">
			{ids.map((id) => {
				const label = fieldLabels?.[id] ?? id;
				const handleClick = canNavigate
					? (e: React.MouseEvent) => {
							e.stopPropagation();
							if (onNavigateEntry) {
								onNavigateEntry(
									field.related_object_name!,
									id,
									field.related_object_id,
								);
								return;
							}
							onNavigateObject?.(field.related_object_name!);
						}
					: undefined;
				return (
					<RelationLink
						key={id}
						label={label}
						faviconUrl={fieldFaviconUrls?.[id]}
						onClick={handleClick}
						maxLabelWidth={180}
					/>
				);
			})}
		</span>
	);
}

function TagChip({ tag }: { tag: string }) {
	const formatted = formatWorkspaceFieldValue(tag);
	const isLink = formatted.kind === "link" && formatted.href;
	const showFavicon = formatted.linkType === "url" && !!formatted.faviconUrl;
	const openInNewTab = formatted.linkType === "url" || formatted.linkType === "file";
	const chipStyle = { background: "rgba(148, 163, 184, 0.12)", border: "1px solid var(--color-border)" };
	if (isLink) {
		const chip = (
			<span
				className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium max-w-[200px]"
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
			<LinkPreviewWrapper href={formatted.href!}>{chip}</LinkPreviewWrapper>
		) : chip;
	}
	return (
		<span
			className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
			style={{ ...chipStyle, color: "var(--color-text-muted)" }}
		>
			{tag}
		</span>
	);
}

function TagsCell({ value }: { value: unknown }) {
	const tags = parseTagsValue(value);
	if (tags.length === 0) {return <span style={{ color: "var(--color-text-muted)", opacity: 0.5 }}>--</span>;}
	return (
		<span className="flex items-center gap-1 flex-wrap">
			{tags.slice(0, 5).map((tag) => <TagChip key={tag} tag={tag} />)}
			{tags.length > 5 && <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>+{tags.length - 5}</span>}
		</span>
	);
}

function TagsInput({
	value,
	onChange,
	autoFocus,
}: {
	value: string;
	onChange: (val: string) => void;
	autoFocus?: boolean;
}) {
	const tags = parseTagsValue(value);
	const [inputVal, setInputVal] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (autoFocus && inputRef.current) {inputRef.current.focus();}
	}, [autoFocus]);

	const addTag = (tag: string) => {
		const t = tag.trim();
		if (!t || tags.includes(t)) {return;}
		const next = [...tags, t];
		onChange(JSON.stringify(next));
		setInputVal("");
	};

	const removeTag = (tag: string) => {
		const next = tags.filter((t) => t !== tag);
		onChange(next.length > 0 ? JSON.stringify(next) : "");
	};

	return (
		<div className="flex items-center gap-1 flex-wrap min-h-[1.5em]">
			{tags.map((tag) => (
				<span
					key={tag}
					className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium"
					style={{ background: "rgba(148, 163, 184, 0.12)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
				>
					{tag}
					<button
						type="button"
						onClick={() => removeTag(tag)}
						className="ml-0.5 hover:opacity-70"
						style={{ color: "var(--color-text-muted)" }}
					>
						<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
					</button>
				</span>
			))}
			<input
				ref={inputRef}
				type="text"
				value={inputVal}
				onChange={(e) => setInputVal(e.target.value)}
				onKeyDown={(e) => {
					if ((e.key === "Enter" || e.key === ",") && inputVal.trim()) {
						e.preventDefault();
						addTag(inputVal);
					}
					if (e.key === "Backspace" && !inputVal && tags.length > 0) {
						removeTag(tags[tags.length - 1]);
					}
				}}
				onBlur={() => { if (inputVal.trim()) {addTag(inputVal);} }}
				placeholder={tags.length === 0 ? "Type and press Enter..." : ""}
				className="flex-1 min-w-[80px] text-xs outline-none bg-transparent"
				style={{ color: "var(--color-text)" }}
			/>
		</div>
	);
}

function ReverseRelationCell({ links, sourceObjectName, sourceObjectId, onNavigateObject, onNavigateEntry }: {
	links: Array<{ id: string; label: string }>;
	sourceObjectName: string;
	sourceObjectId?: string;
	onNavigateObject?: (objectName: string) => void;
	onNavigateEntry?: (
		objectName: string,
		entryId: string,
		relatedObjectId?: string,
	) => void;
}) {
	if (!links || links.length === 0) {return <span style={{ color: "var(--color-text-muted)", opacity: 0.5 }}>--</span>;}
	const display = links.slice(0, 5);
	const overflow = links.length - display.length;
	return (
		<span className="flex items-center gap-1 flex-wrap">
			{display.map((link) => (
				<span
					key={link.id}
					onClick={(e) => {
						if (!onNavigateEntry && !onNavigateObject) {return;}
						e.stopPropagation();
						if (onNavigateEntry) {
							onNavigateEntry(sourceObjectName, link.id, sourceObjectId);
							return;
						}
						onNavigateObject?.(sourceObjectName);
					}}
					className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${onNavigateEntry || onNavigateObject ? "cursor-pointer" : ""}`}
					style={{ background: "var(--color-chip-database)", color: "var(--color-chip-database-text)", border: "1px solid var(--color-border)" }}
				>
					<span className="truncate max-w-[180px]">{link.label}</span>
				</span>
			))}
			{overflow > 0 && <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>+{overflow}</span>}
		</span>
	);
}

/* ─── Inline Edit Cell ─── */

type EditableCellProps = {
	value: unknown;
	entryId: string;
	fieldName: string;
	objectName: string;
	field: Field;
	members?: Array<{ id: string; name: string }>;
	/** Labels for THIS field only (relation fields). Pre-narrowed from the
	 * parent's full relationLabels map so non-relation cells don't bust their
	 * memo when the unrelated parts of the map change. */
	fieldRelationLabels?: Record<string, string>;
	/** Favicon URLs for THIS field only — same shape/narrowing as
	 * `fieldRelationLabels`. Pre-narrowed for the same memo reason. */
	fieldRelationFaviconUrls?: Record<string, string>;
	onNavigateObject?: (objectName: string) => void;
	onNavigateEntry?: (
		objectName: string,
		entryId: string,
		relatedObjectId?: string,
	) => void;
	/** Stable callback that receives the (entryId, fieldName, value) tuple
	 * so each cell doesn't have to bind its own arrow (which would bust
	 * the surrounding React.memo). */
	onLocalValueChange?: (entryId: string, fieldName: string, value: string) => void;
	onSaved?: () => void;
	showUrlFavicon?: boolean;
};

function EditableCellInner({
	value: initialValue,
	entryId,
	fieldName,
	objectName,
	field,
	members,
	fieldRelationLabels,
	fieldRelationFaviconUrls,
	onNavigateObject,
	onNavigateEntry,
	onLocalValueChange,
	onSaved,
	showUrlFavicon = false,
}: EditableCellProps) {
	const [editing, setEditing] = useState(false);
	const [localValue, setLocalValue] = useState(safeString(initialValue));
	const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Sync with prop changes
	useEffect(() => {
		if (!editing) {setLocalValue(safeString(initialValue));}
	}, [initialValue, editing]);

	// Focus input on edit start
	useEffect(() => {
		if (editing && inputRef.current) {inputRef.current.focus();}
	}, [editing]);

	// Non-editable types: render read-only (relations are now editable via dropdown)
	const isEditable = !["user"].includes(field.type);
	const isRelation = field.type === "relation" && !!field.related_object_name;
	const isTags = field.type === "tags";

	const save = useCallback(async (val: string) => {
		onLocalValueChange?.(entryId, fieldName, val);
		try {
			await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/entries/${encodeURIComponent(entryId)}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ fields: { [fieldName]: val } }),
			});
			onSaved?.();
		} catch { /* ignore */ }
	}, [objectName, entryId, fieldName, onLocalValueChange, onSaved]);

	const handleChange = (val: string) => {
		setLocalValue(val);
		if (saveTimerRef.current) {clearTimeout(saveTimerRef.current);}
		saveTimerRef.current = setTimeout(() => save(val), 500);
	};

	const handleBlur = () => {
		if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); void save(localValue); }
		setEditing(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") { handleBlur(); }
		if (e.key === "Escape") { setEditing(false); setLocalValue(safeString(initialValue)); }
	};

	// Read-only display for non-editable types
	if (!isEditable) {
		if (field.type === "user") {return <UserCell value={initialValue} members={members} />;}
		return <span className="truncate block max-w-[300px]">{safeString(initialValue)}</span>;
	}

	// Editing mode — Excel-style seamless inline editing
	if (editing) {
		let editInput;
		if (isRelation) {
			return (
				<div
					className="-mx-3 -my-2 px-3 py-2"
					style={{
						background: "var(--color-bg)",
						boxShadow: "inset 0 0 0 2px var(--color-accent)",
					}}
				>
					<RelationSelect
						relatedObjectName={field.related_object_name!}
						value={safeString(initialValue)}
						multiple={field.relationship_type === "many_to_many"}
						onChange={(v) => { void save(v); setEditing(false); }}
						variant="inline"
						autoFocus
					/>
				</div>
			);
		}
		if (isTags) {
			return (
				<div
					className="-mx-3 -my-2 px-3 py-2"
					style={{
						background: "var(--color-bg)",
						boxShadow: "inset 0 0 0 2px var(--color-accent)",
					}}
				>
					<TagsInput
						value={safeString(initialValue)}
						onChange={(v) => { void save(v); }}
						autoFocus
					/>
				</div>
			);
		}
		if (field.type === "enum" && field.enum_values) {
			editInput = (
				<select
					ref={inputRef as React.RefObject<HTMLSelectElement>}
					value={localValue}
					onChange={(e) => { handleChange(e.target.value); setEditing(false); }}
					onBlur={handleBlur}
					onKeyDown={handleKeyDown}
					className="w-full text-xs outline-none bg-transparent"
					style={{ color: "var(--color-text)" }}
				>
					<option value="">--</option>
					{field.enum_values.map((v) => (
						<option key={v} value={v}>{v}</option>
					))}
				</select>
			);
		} else if (field.type === "boolean") {
			editInput = (
				<select
					ref={inputRef as React.RefObject<HTMLSelectElement>}
					value={localValue}
					onChange={(e) => { handleChange(e.target.value); setEditing(false); }}
					onBlur={handleBlur}
					onKeyDown={handleKeyDown}
					className="w-full text-xs outline-none bg-transparent"
					style={{ color: "var(--color-text)" }}
				>
					<option value="true">Yes</option>
					<option value="false">No</option>
				</select>
			);
		} else {
			editInput = (
				<input
					ref={inputRef as React.RefObject<HTMLInputElement>}
					type={inputTypeForField(field.type)}
					value={localValue}
					onChange={(e) => handleChange(e.target.value)}
					onBlur={handleBlur}
					onKeyDown={handleKeyDown}
					className="w-full text-xs outline-none bg-transparent"
					style={{ color: "var(--color-text)" }}
				/>
			);
		}
		return (
			<div
				className="-mx-3 -my-2 px-3 py-2"
				style={{
					background: "var(--color-bg)",
					boxShadow: "inset 0 0 0 2px var(--color-accent)",
				}}
			>
				{editInput}
			</div>
		);
	}

	// Display mode — double-click to edit
	const displayValue = initialValue;

	// Relation fields: show chips with double-click to edit
	if (isRelation) {
		return (
			<div
				onDoubleClick={() => setEditing(true)}
				className="cursor-cell min-h-[1.5em]"
				title="Double-click to edit"
			>
				<RelationCell
					value={initialValue}
					field={field}
					fieldLabels={fieldRelationLabels}
					fieldFaviconUrls={fieldRelationFaviconUrls}
					onNavigateObject={onNavigateObject}
					onNavigateEntry={onNavigateEntry}
				/>
			</div>
		);
	}

	// Tags fields: show tag chips with double-click to edit
	if (isTags) {
		return (
			<div
				onDoubleClick={() => setEditing(true)}
				className="cursor-cell min-h-[1.5em]"
				title="Double-click to edit"
			>
				<TagsCell value={displayValue} />
			</div>
		);
	}

	return (
		<div
			onDoubleClick={() => setEditing(true)}
			className="cursor-cell min-h-[1.5em]"
			title="Double-click to edit"
		>
			{displayValue === null || displayValue === undefined || displayValue === "" ? (
				<span style={{ color: "var(--color-text-muted)", opacity: 0.5 }}>--</span>
			) : field.type === "enum" ? (
				<EnumBadge value={safeString(displayValue)} enumValues={field.enum_values} enumColors={field.enum_colors} />
			) : field.type === "boolean" ? (
				<BooleanCell value={displayValue} />
			) : (
				<FormattedFieldValue
					value={displayValue}
					fieldType={field.type}
					mode="table"
					showUrlFavicon={showUrlFavicon}
					linkInteractionMode="button"
				/>
			)}
		</div>
	);
}

/** React.memo wrapper for the inline-edit cell. With stable parent props
 * (Layer 3 fixes), this is the dominant per-cell perf win — cells whose
 * value/field hasn't changed will skip rendering entirely on a row that
 * does need to re-render (e.g. a sibling cell's value changed). */
const EditableCell = React.memo(EditableCellInner);

/* ─── First-column sticky bold link ─── */

type FirstColumnCellProps = {
	value: unknown;
	entryId: string;
	onEntryClick?: (entryId: string) => void;
};

/**
 * First-column cell for workspace tables.
 *
 * Two ways to open the entry:
 *   1. Click the display value (only when non-empty) — preserves the
 *      familiar "click the name to open" affordance.
 *   2. Hover the row, click the "Open ↗" button at the right edge — works
 *      regardless of whether the display value is empty.
 *
 * The Open button exists because the first column is the *display field*
 * (e.g. People → Full Name, Companies → Name) and that field is sometimes
 * blank. Without an explicit affordance, blank rows are effectively
 * un-openable from the table — you'd have to use the row-actions menu,
 * which is a worse hierarchy. Every CRM-style table (Linear, Notion,
 * Attio, Airtable) solves this with the same pattern: hover-reveal a
 * dedicated open button.
 *
 * The button uses Tailwind's `group-hover/row:opacity-100` against the
 * `group/row` class on the parent `<tr>` (set by `TableRowInner` in
 * data-table.tsx). It sits absolutely positioned at the right edge so
 * it doesn't reserve layout space and doesn't cause the truncated text
 * to jump when revealed. The button has its own background + border so
 * it remains readable when it overlaps the trailing characters of a long
 * truncated label.
 */
function FirstColumnCellInner({ value, entryId, onEntryClick }: FirstColumnCellProps) {
	const displayVal = value === null || value === undefined || value === "" ? "--" : safeString(value);
	const isEmpty = displayVal === "--";
	const handleTextClick = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		if (entryId && !isEmpty && onEntryClick) {onEntryClick(entryId);}
	}, [entryId, isEmpty, onEntryClick]);
	const handleOpenClick = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		if (entryId && onEntryClick) {onEntryClick(entryId);}
	}, [entryId, onEntryClick]);
	const showOpenButton = !!entryId && !!onEntryClick;
	return (
		<span className="relative block w-full">
			<span
				className={`font-semibold truncate block ${isEmpty || !onEntryClick ? "" : "cursor-pointer hover:underline"}`}
				style={{
					color: isEmpty ? "var(--color-text-muted)" : "var(--color-accent)",
					opacity: isEmpty ? 0.5 : 1,
					maxWidth: showOpenButton ? "calc(100% - 60px)" : "100%",
				}}
				onClick={handleTextClick}
			>
				{displayVal}
			</span>
			{showOpenButton && (
				<button
					type="button"
					onClick={handleOpenClick}
					title="Open"
					aria-label="Open entry"
					className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium cursor-pointer opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity duration-100 outline-none focus-visible:ring-1"
					style={{
						background: "var(--color-bg)",
						color: "var(--color-text-muted)",
						border: "1px solid var(--color-border)",
						boxShadow: "var(--shadow-sm)",
					}}
				>
					Open
					<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<path d="M7 7h10v10" />
						<path d="M7 17 17 7" />
					</svg>
				</button>
			)}
		</span>
	);
}

const FirstColumnCell = React.memo(FirstColumnCellInner);

/* ─── Main ObjectTable ─── */

function parseActionConfig(defaultValue: string | null | undefined): ActionConfig[] {
	if (!defaultValue) return [];
	try {
		const parsed = JSON.parse(defaultValue);
		if (parsed && Array.isArray(parsed.actions)) return parsed.actions;
	} catch { /* ignore */ }
	return [];
}

type EnrichmentProgress = {
	fieldId: string;
	fieldName: string;
	current: number;
	total: number;
	enriched: number;
	errors: number;
};

export function ObjectTable({
	objectName,
	fields,
	entries,
	members,
	relationLabels,
	relationFaviconUrls,
	reverseRelations,
	onNavigateToObject,
	onNavigateToEntry,
	onEntryClick,
	onRefresh,
	activeEntryId,
	columnVisibility,
	onColumnVisibilityChanged,
	columnSizing,
	onColumnSizingChanged,
	serverPagination,
	onServerSearch,
	hideInternalToolbar,
	globalFilter,
	onGlobalFilterChange,
	onAddRequest,
	stickyFirstColumnValue,
	onStickyFirstColumnChange,
}: ObjectTableProps) {
	const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
	const [showAddModal, setShowAddModal] = useState(false);
	const [localEntries, setLocalEntries] = useState<EntryRow[]>(entries as EntryRow[]);
	const [confirmState, setConfirmState] = useState<{
		open: boolean; title: string; message: string; variant: "default" | "destructive";
		confirmLabel: string; onConfirm: () => void;
	} | null>(null);
	const { executeBulkAction, bulkStates } = useActionStates();
	const showToast = useToast();

	const [renamingFieldId, setRenamingFieldId] = useState<string | null>(null);
	const [openMenuFieldId, setOpenMenuFieldId] = useState<string | null>(null);

	// Enrichment state
	const [enrichmentProgress, setEnrichmentProgress] = useState<EnrichmentProgress | null>(null);
	const [enrichedCellIds, setEnrichedCellIds] = useState<Set<string>>(new Set());
	const enrichAbortRef = useRef<AbortController | null>(null);

	const startEnrichment = useCallback((payload: EnrichmentStartPayload) => {
		if (enrichAbortRef.current) enrichAbortRef.current.abort();
		const ac = new AbortController();
		enrichAbortRef.current = ac;

		setEnrichmentProgress({
			fieldId: payload.fieldId,
			fieldName: payload.fieldName,
			current: 0,
			total: 0,
			enriched: 0,
			errors: 0,
		});
		setEnrichedCellIds(new Set());

		(async () => {
			try {
				const res = await fetch(
					`/api/workspace/objects/${encodeURIComponent(objectName)}/enrich`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							fieldId: payload.fieldId,
							apolloPath: payload.apolloPath,
							category: payload.category,
							inputFieldName: payload.inputFieldName,
							scope: payload.scope,
						}),
						signal: ac.signal,
					},
				);

				if (!res.ok || !res.body) {
					setEnrichmentProgress(null);
					return;
				}

				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buf = "";

				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					buf += decoder.decode(value, { stream: true });

					const lines = buf.split("\n");
					buf = lines.pop() ?? "";

					for (const line of lines) {
						if (!line.startsWith("data: ")) continue;
						try {
							const evt = JSON.parse(line.slice(6));
							if (evt.type === "progress") {
								setEnrichmentProgress((p) => p ? {
									...p,
									current: evt.current,
									total: evt.total,
									enriched: p.enriched + 1,
								} : p);
								setLocalEntries((prev) =>
									prev.map((e) => {
										const eid = String(e.entry_id ?? "");
										if (eid !== evt.entryId) return e;
										return { ...e, [payload.fieldName]: evt.value };
									}),
								);
								setEnrichedCellIds((prev) => {
									const next = new Set(prev);
									next.add(evt.entryId);
									return next;
								});
							} else if (evt.type === "error") {
								setEnrichmentProgress((p) => p ? {
									...p,
									current: evt.current,
									total: evt.total,
									errors: p.errors + 1,
								} : p);
							} else if (evt.type === "done") {
								setEnrichmentProgress(null);
								setTimeout(() => setEnrichedCellIds(new Set()), 3000);
								onRefresh?.();
							}
						} catch { /* malformed SSE line */ }
					}
				}
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") return;
				setEnrichmentProgress(null);
			}
		})();
	}, [objectName, onRefresh]);

	const handleReEnrich = useCallback((fieldId: string, scope: "all" | "empty" | number) => {
		const field = fields.find((f) => f.id === fieldId);
		if (!field) return;
		const meta = parseEnrichmentMeta(field.default_value);
		if (!meta) return;
		startEnrichment({
			fieldId,
			fieldName: field.name,
			apolloPath: meta.enrichment.apolloPath,
			category: meta.enrichment.category,
			inputFieldName: meta.enrichment.inputFieldName,
			scope,
		});
	}, [fields, startEnrichment]);

	const dataFields = useMemo(() => fields.filter((f) => f.type !== "action"), [fields]);
	const actionFields = useMemo(() => fields.filter((f) => f.type === "action"), [fields]);

	const allActionButtons = useMemo(() => {
		const buttons: Array<{ action: ActionConfig; fieldId: string }> = [];
		for (const af of actionFields) {
			for (const a of parseActionConfig(af.default_value)) {
				buttons.push({ action: a, fieldId: af.id });
			}
		}
		return buttons;
	}, [actionFields]);

	// Keep local rows aligned with server-paginated updates.
	useEffect(() => {
		setLocalEntries(entries as EntryRow[]);
	}, [entries]);

	const updateLocalEntryField = useCallback((entryId: string, fieldName: string, value: string) => {
		setLocalEntries((prev) =>
			prev.map((entry) => {
				const eid = entry.entry_id;
				const currentEntryId = String(
					eid != null && typeof eid === "object" ? JSON.stringify(eid) : (eid ?? ""),
				);
				if (currentEntryId !== entryId) {return entry;}
				return { ...entry, [fieldName]: value };
			}),
		);
	}, []);

	const activeReverseRelations = useMemo(() => {
		if (!reverseRelations) {return [];}
		return reverseRelations.filter((rr) => Object.keys(rr.entries).length > 0);
	}, [reverseRelations]);

	// Precompute the first URL favicon per entry once (instead of recomputing
	// per row, per render, which used to walk every cell of every row and
	// run ~5 regexes per cell value). With this map, the row component only
	// does an O(1) lookup. This is the single biggest selection-perf win on
	// large pages.
	const faviconUrlByEntryId = useMemo(() => {
		const urlFields = dataFields.filter((f) => f.type === "url");
		const candidateFields = urlFields.length > 0 ? urlFields : dataFields;
		const map = new Map<string, string>();
		for (const entry of localEntries) {
			const eid = entry.entry_id;
			if (eid == null) {continue;}
			const entryId = String(typeof eid === "object" ? JSON.stringify(eid) : eid);
			if (!entryId) {continue;}
			const url = computeEntryFaviconUrl(entry, candidateFields);
			if (url) {map.set(entryId, url);}
		}
		return map;
	}, [localEntries, dataFields]);

	const getRowFaviconUrl = useCallback(
		(row: { original: EntryRow }) => {
			const eid = row.original.entry_id;
			if (eid == null) {return undefined;}
			const entryId = String(typeof eid === "object" ? JSON.stringify(eid) : eid);
			return faviconUrlByEntryId.get(entryId);
		},
		[faviconUrlByEntryId],
	);

	// Column management handlers
	const handleColumnReorder = useCallback(
		async (newOrder: string[]) => {
			const fieldIdSet = new Set(fields.map((field) => field.id));
			const fieldIds = newOrder.filter((id) => fieldIdSet.has(id));
			try {
				await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/fields/reorder`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ fieldOrder: fieldIds }),
				});
			} catch { /* ignore */ }
		},
		[objectName, fields],
	);

	const handleRenameColumn = useCallback(async (fieldId: string, newName: string) => {
		try {
			const res = await fetch(
				`/api/workspace/objects/${encodeURIComponent(objectName)}/fields/${encodeURIComponent(fieldId)}`,
				{ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) },
			);
			if (res.ok) onRefresh?.();
		} catch { /* ignore */ }
		setRenamingFieldId(null);
	}, [objectName, onRefresh]);

	const handleDeleteColumn = useCallback((fieldId: string, fieldName: string) => {
		setConfirmState({
			open: true,
			title: `Delete "${fieldName}" column?`,
			message: "This will permanently remove this column and all its data from every entry. This cannot be undone.",
			variant: "destructive",
			confirmLabel: "Delete column",
			onConfirm: async () => {
				setConfirmState(null);
				try {
					await fetch(
						`/api/workspace/objects/${encodeURIComponent(objectName)}/fields/${encodeURIComponent(fieldId)}`,
						{ method: "DELETE" },
					);
					onRefresh?.();
				} catch { /* ignore */ }
			},
		});
	}, [objectName, onRefresh]);

	const handleMoveColumn = useCallback((fieldId: string, direction: "left" | "right") => {
		const fieldIds = dataFields.map((f) => f.id);
		const idx = fieldIds.indexOf(fieldId);
		if (direction === "left" && idx > 0) {
			const newOrder = [...fieldIds];
			[newOrder[idx], newOrder[idx - 1]] = [newOrder[idx - 1], newOrder[idx]];
			void handleColumnReorder(newOrder);
		} else if (direction === "right" && idx < fieldIds.length - 1) {
			const newOrder = [...fieldIds];
			[newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
			void handleColumnReorder(newOrder);
		}
	}, [dataFields, handleColumnReorder]);

	// Build TanStack columns from fields (excluding action fields).
	// We use stable, hoisted memo'd cell components (FirstColumnCell,
	// EditableCell) so flexRender's child subtree can be skipped when
	// the cell's actual displayed values haven't changed.
	const columns = useMemo<ColumnDef<EntryRow>[]>(() => {
		const cols: ColumnDef<EntryRow>[] = dataFields.map((field, fieldIdx) => {
			// Pre-narrow relation labels to just THIS field so non-relation
			// cells don't bust their memo when an unrelated field's labels change.
			const fieldRelationLabels = field.type === "relation"
				? relationLabels?.[field.name]
				: undefined;
			const fieldRelationFaviconUrls = field.type === "relation"
				? relationFaviconUrls?.[field.name]
				: undefined;
			return {
				id: field.id,
				accessorKey: field.name,
				meta: { label: field.name, fieldName: field.name, fieldType: field.type },
				header: ({ column }: { column: { getIsSorted: () => "asc" | "desc" | false; toggleSorting: (desc: boolean) => void; toggleVisibility: (visible: boolean) => void } }) => {
					if (renamingFieldId === field.id) {
						return (
							<InlineRenameInput
								currentName={field.name}
								onSave={(newName) => void handleRenameColumn(field.id, newName)}
								onCancel={() => setRenamingFieldId(null)}
							/>
						);
					}
					const isEnriching = enrichmentProgress?.fieldId === field.id;
					return (
						<span
							className="flex items-center gap-1.5 w-full"
							style={{ color: "var(--color-text-muted)" }}
							onClick={(e) => {
								e.stopPropagation();
								setOpenMenuFieldId((prev) => prev === field.id ? null : field.id);
							}}
						>
							<FieldTypeIcon type={field.type} size={12} className="shrink-0 opacity-50" />
							<span className="truncate">{field.name}</span>
							{field.type === "relation" && field.related_object_name && (
								<span className="text-[9px] font-normal normal-case tracking-normal opacity-60 shrink-0">
									({displayObjectName(field.related_object_name)})
								</span>
							)}
							{isEnriching && enrichmentProgress && (
								<span className="flex items-center gap-1 text-[10px] font-medium shrink-0 animate-pulse" style={{ color: "var(--color-warning, #f59e0b)" }}>
									<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
									{enrichmentProgress.current}/{enrichmentProgress.total}
								</span>
							)}
							<ColumnHeaderMenu
								field={field}
								sortDirection={column.getIsSorted()}
								onSort={(desc) => column.toggleSorting(desc)}
								onHide={() => column.toggleVisibility(false)}
								onRename={() => setRenamingFieldId(field.id)}
								onDelete={() => handleDeleteColumn(field.id, field.name)}
								canMoveLeft={fieldIdx > 0}
								canMoveRight={fieldIdx < dataFields.length - 1}
								onMoveLeft={() => handleMoveColumn(field.id, "left")}
								onMoveRight={() => handleMoveColumn(field.id, "right")}
								onReEnrich={(scope) => handleReEnrich(field.id, scope)}
								open={openMenuFieldId === field.id}
								onOpenChange={(isOpen) => setOpenMenuFieldId(isOpen ? field.id : null)}
							/>
						</span>
					);
				},
				cell: (info: CellContext<EntryRow, unknown>) => {
					const eid = info.row.original.entry_id;
					const entryId = String(eid != null && typeof eid === "object" ? JSON.stringify(eid) : (eid ?? ""));
					const justEnriched = enrichedCellIds.has(entryId) && enrichmentProgress?.fieldId === field.id;

					if (fieldIdx === 0 && onEntryClick) {
						return (
							<FirstColumnCell
								value={info.getValue()}
								entryId={entryId}
								onEntryClick={onEntryClick}
							/>
						);
					}

					const cellNode = (
						<EditableCell
							value={info.getValue()}
							entryId={entryId}
							fieldName={field.name}
							objectName={objectName}
							field={field}
							members={members}
							fieldRelationLabels={fieldRelationLabels}
							fieldRelationFaviconUrls={fieldRelationFaviconUrls}
							onNavigateObject={onNavigateToObject}
							onNavigateEntry={onNavigateToEntry}
							onLocalValueChange={updateLocalEntryField}
							onSaved={onRefresh}
							showUrlFavicon={fieldIdx !== 0}
						/>
					);

					if (justEnriched) {
						return <div className="enrich-fade-in enrich-glow -mx-3 -my-2 px-3 py-2">{cellNode}</div>;
					}
					return cellNode;
				},
				size: field.type === "richtext" ? 300 : field.type === "relation" || field.type === "tags" ? 220 : 200,
				enableSorting: true,
			};
		});

		cols.push({
			id: "created_at",
			accessorFn: (row) => resolveEntryMetaValue(row, CREATED_AT_KEYS),
			meta: { label: "Created", fieldName: "created_at", fieldType: "date" },
			header: () => (
				<span className="flex items-center gap-1" style={{ color: "var(--color-text-muted)" }}>
					Created
				</span>
			),
			cell: (info: CellContext<EntryRow, unknown>) => (
				<FormattedFieldValue value={info.getValue()} fieldType="date" mode="table" />
			),
			size: 190,
			enableSorting: true,
		});

		cols.push({
			id: "updated_at",
			accessorFn: (row) => resolveEntryMetaValue(row, UPDATED_AT_KEYS),
			meta: { label: "Updated", fieldName: "updated_at", fieldType: "date" },
			header: () => (
				<span className="flex items-center gap-1" style={{ color: "var(--color-text-muted)" }}>
					Updated
				</span>
			),
			cell: (info: CellContext<EntryRow, unknown>) => (
				<FormattedFieldValue value={info.getValue()} fieldType="date" mode="table" />
			),
			size: 190,
			enableSorting: true,
		});

		// Add reverse relation columns
		for (const rr of activeReverseRelations) {
			cols.push({
				id: `rev_${rr.sourceObjectName}_${rr.fieldName}`,
				meta: { label: `${displayObjectName(rr.sourceObjectName)} (via ${rr.fieldName})`, fieldType: "relation" },
				header: () => (
					<span className="flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
						<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
							<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
						</svg>
						<span>{displayObjectName(rr.sourceObjectName)}</span>
						<span className="text-[9px] font-normal normal-case tracking-normal opacity-50">via {rr.fieldName}</span>
					</span>
				),
				cell: (info: CellContext<EntryRow, unknown>) => {
					const eid = info.row.original.entry_id;
					const entryId = String(eid != null && typeof eid === "object" ? JSON.stringify(eid) : (eid ?? ""));
					const links = rr.entries[entryId] ?? [];
					return (
						<ReverseRelationCell
							links={links}
							sourceObjectName={rr.sourceObjectName}
							sourceObjectId={rr.sourceObjectId}
							onNavigateObject={onNavigateToObject}
							onNavigateEntry={onNavigateToEntry}
						/>
					);
				},
				enableSorting: false,
				size: 200,
			});
		}

		for (const af of actionFields) {
			const actions = parseActionConfig(af.default_value);
			if (actions.length === 0) continue;
			cols.push({
				id: `action_${af.id}`,
				meta: { label: af.name, fieldName: af.name, fieldType: "action" },
				header: () => (
					<span className="flex items-center gap-1" style={{ color: "var(--color-text-muted)" }}>
						{af.name}
					</span>
				),
				cell: (info: CellContext<EntryRow, unknown>) => {
					const eid = info.row.original.entry_id;
					const entryId = String(eid != null && typeof eid === "object" ? JSON.stringify(eid) : (eid ?? ""));
					return (
						<div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
							{actions.map((action) => (
								<ActionButton
									key={action.id}
									action={action}
									entryId={entryId}
									objectName={objectName}
									fieldId={af.id}
									compact={actions.length > 1}
									onToast={showToast}
									onRequestConfirm={(act, eid2, onConfirm) => {
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
							))}
						</div>
					);
				},
				enableSorting: false,
				enableHiding: true,
				size: Math.max(100, actions.length * 100),
			});
		}


		return cols;
		// `onEntryClick` and `updateLocalEntryField` are read inside the `cell`
		// closures and were missing from the original deps (stale-closure bug);
		// they're included now.
	}, [dataFields, actionFields, activeReverseRelations, objectName, members, relationLabels, relationFaviconUrls, onNavigateToObject, onNavigateToEntry, onEntryClick, onRefresh, updateLocalEntryField, showToast, renamingFieldId, handleRenameColumn, handleDeleteColumn, handleMoveColumn, enrichmentProgress, handleReEnrich, enrichedCellIds, openMenuFieldId]);

	// Add entry handler — delegates to parent when provided, otherwise opens local modal.
	const handleAdd = useCallback(() => {
		if (onAddRequest) {
			onAddRequest();
		} else {
			setShowAddModal(true);
		}
	}, [onAddRequest]);

	const getSelectedEntryIds = useCallback(() => {
		return Object.keys(rowSelection)
			.filter((k) => rowSelection[k])
			.map((idx) => safeString(localEntries[Number(idx)]?.entry_id))
			.filter(Boolean);
	}, [rowSelection, localEntries]);

	const doBulkDelete = useCallback(async () => {
		const selectedIds = getSelectedEntryIds();
		if (selectedIds.length === 0) return;
		try {
			await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/entries/bulk-delete`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ entryIds: selectedIds }),
			});
			setRowSelection({});
			onRefresh?.();
		} catch { /* ignore */ }
	}, [getSelectedEntryIds, objectName, onRefresh]);

	const handleBulkDelete = useCallback(() => {
		const count = getSelectedEntryIds().length;
		if (count === 0) return;
		setConfirmState({
			open: true,
			title: `Delete ${count} ${count === 1 ? "entry" : "entries"}?`,
			message: "This action cannot be undone. All selected entries will be permanently removed.",
			variant: "destructive",
			confirmLabel: "Delete",
			onConfirm: () => { setConfirmState(null); void doBulkDelete(); },
		});
	}, [getSelectedEntryIds, doBulkDelete]);

	const handleDeleteEntry = useCallback((entry: EntryRow) => {
		const eid = entry.entry_id;
		const entryId = String(eid != null && typeof eid === "object" ? JSON.stringify(eid) : (eid ?? ""));
		if (!entryId) return;
		setConfirmState({
			open: true,
			title: "Delete this entry?",
			message: "This action cannot be undone.",
			variant: "destructive",
			confirmLabel: "Delete",
			onConfirm: async () => {
				setConfirmState(null);
				try {
					await fetch(`/api/workspace/objects/${encodeURIComponent(objectName)}/entries/${encodeURIComponent(entryId)}`, { method: "DELETE" });
					onRefresh?.();
				} catch { /* ignore */ }
			},
		});
	}, [objectName, onRefresh]);

	const handleBulkAction = useCallback((action: ActionConfig, fieldId: string) => {
		const selectedIds = getSelectedEntryIds();
		if (selectedIds.length === 0) return;

		const run = () => void executeBulkAction(action, fieldId, objectName, selectedIds, {
			autoResetMs: action.autoResetMs,
			onToast: showToast,
		});

		if (action.confirmMessage) {
			setConfirmState({
				open: true,
				title: `${action.label} (${selectedIds.length} entries)`,
				message: action.confirmMessage,
				variant: action.variant === "destructive" ? "destructive" : "default",
				confirmLabel: action.label,
				onConfirm: () => { setConfirmState(null); run(); },
			});
		} else {
			run();
		}
	}, [getSelectedEntryIds, objectName, executeBulkAction, showToast]);

	// Row actions
		const getRowActions = useCallback(
		(_row: EntryRow): RowAction<EntryRow>[] => {
			const actions: RowAction<EntryRow>[] = [];
			if (onEntryClick) {
				actions.push({
					label: "View details",
					onClick: (r) => {
						const eid = String(r.entry_id ?? "");
						if (eid) {onEntryClick(eid);}
					},
					icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>,
				});
			}
			actions.push({
				label: "Delete",
				variant: "destructive",
				onClick: handleDeleteEntry,
				icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>,
			});
			return actions;
		},
		[onEntryClick, handleDeleteEntry],
	);

	const selectedCount = Object.keys(rowSelection).filter((k) => rowSelection[k]).length;

	// Keep deps minimal — AddColumnPopover fetches enrichment status
	// internally. Use refs for fields/startEnrichment so they don't
	// cause a new element (which remounts the popover and resets its
	// open state).
	const fieldsRef = useRef(fields);
	fieldsRef.current = fields;
	const startEnrichmentRef = useRef(startEnrichment);
	startEnrichmentRef.current = startEnrichment;

	const stableOnCreated = useCallback(() => onRefresh?.(), [onRefresh]);
	const stableOnEnrichmentStart = useCallback(
		(p: EnrichmentStartPayload) => startEnrichmentRef.current(p),
		[],
	);

	const rowActionsHeader = useMemo(() => (
		<AddColumnPopover
			objectName={objectName}
			onCreated={stableOnCreated}
			fields={fieldsRef.current}
			onEnrichmentStart={stableOnEnrichmentStart}
		/>
	// eslint-disable-next-line react-hooks/exhaustive-deps
	), [objectName, stableOnCreated, stableOnEnrichmentStart]);

	return (
	<>
		<DataTable
			columns={columns}
			data={localEntries}
			enableSorting
			enableGlobalFilter
			enableRowSelection
			enableColumnReordering
			rowSelection={rowSelection}
			onRowSelectionChange={setRowSelection}
			onColumnReorder={handleColumnReorder}
			searchPlaceholder={`Search ${displayObjectName(objectName)}...`}
			onRefresh={onRefresh}
			onAdd={handleAdd}
			addButtonLabel="+ Add"
			rowActions={getRowActions}
			rowActionsHeader={rowActionsHeader}
			stickyFirstColumn
			stickyFirstColumnValue={stickyFirstColumnValue}
			onStickyFirstColumnChange={onStickyFirstColumnChange}
			activeRowId={activeEntryId}
			getRowId={getRowIdFromEntry}
			initialColumnVisibility={columnVisibility}
			onColumnVisibilityChanged={onColumnVisibilityChanged}
			initialColumnSizing={columnSizing}
			onColumnSizingChange={onColumnSizingChanged}
			serverPagination={serverPagination}
			onServerSearch={onServerSearch}
			hideToolbar={hideInternalToolbar}
			globalFilter={globalFilter}
			onGlobalFilterChange={onGlobalFilterChange}
			getFirstDataColumnFaviconUrl={getRowFaviconUrl}
			disableHeaderClickSort
		/>

		<BulkActionBar
			selectedCount={selectedCount}
			actions={allActionButtons}
			onDeselectAll={() => setRowSelection({})}
			onBulkAction={handleBulkAction}
			onBulkDelete={handleBulkDelete}
			bulkRunStates={bulkStates}
		/>

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

		{showAddModal && (
			<AddEntryModal
				objectName={objectName}
				fields={dataFields}
				members={members}
				onClose={() => setShowAddModal(false)}
				onSaved={onRefresh}
			/>
		)}
	</>
	);
}

/* ─── Add Entry Modal ─── */

export function AddEntryModal({
	objectName,
	fields,
	members,
	onClose,
	onSaved,
}: {
	objectName: string;
	fields: Field[];
	members?: Array<{ id: string; name: string }>;
	onClose: () => void;
	onSaved?: () => void;
}) {
	const [values, setValues] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const backdropRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {onClose();}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	const updateField = (name: string, value: string) => {
		setValues((prev) => ({ ...prev, [name]: value }));
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			const res = await fetch(
				`/api/workspace/objects/${encodeURIComponent(objectName)}/entries`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ fields: values }),
				},
			);
			if (res.ok) {
				onSaved?.();
				onClose();
			}
		} catch { /* ignore */ }
		finally { setSaving(false); }
	};

	return (
		<div
			ref={backdropRef}
			onClick={(e) => { if (e.target === backdropRef.current) {onClose();} }}
			className="fixed inset-0 z-50 flex items-start justify-center"
			style={{ background: "rgba(0, 0, 0, 0.5)", backdropFilter: "blur(2px)" }}
		>
			<div
				className="relative mt-4 mb-4 mx-3 md:mt-12 md:mb-12 md:mx-0 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col"
				style={{
					background: "var(--color-bg)",
					border: "1px solid var(--color-border)",
					maxHeight: "calc(100vh - 6rem)",
				}}
			>
				{/* Header */}
				<div
					className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
					style={{ borderColor: "var(--color-border)" }}
				>
					<h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
						Add {displayObjectNameSingular(objectName)}
					</h2>
					<button type="button" onClick={onClose} className="p-1.5 rounded-lg" style={{ color: "var(--color-text-muted)" }}>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<path d="M18 6 6 18" /><path d="m6 6 12 12" />
						</svg>
					</button>
				</div>

				{/* Form */}
				<form
					onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
					className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
				>
					{fields.map((field) => {
						const isRelation = field.type === "relation";
						const isUser = field.type === "user";

						return (
							<div key={field.id}>
								<label
									className="block text-xs font-medium uppercase tracking-wider mb-1.5"
									style={{ color: "var(--color-text-muted)" }}
								>
									{field.name}
									{isRelation && field.related_object_name && (
										<span className="normal-case tracking-normal font-normal opacity-60 ml-1">
											({displayObjectName(field.related_object_name)})
										</span>
									)}
								</label>

							{field.type === "tags" ? (
								<div
									className="w-full px-3 py-2 text-sm rounded-lg"
									style={{
										background: "var(--color-surface)",
										border: "1px solid var(--color-border)",
									}}
								>
									<TagsInput
										value={values[field.name] ?? ""}
										onChange={(v) => updateField(field.name, v)}
									/>
								</div>
							) : field.type === "enum" && field.enum_values ? (
								<select
									value={values[field.name] ?? ""}
									onChange={(e) => updateField(field.name, e.target.value)}
									className="w-full px-3 py-2 text-sm rounded-lg outline-none"
									style={{
										background: "var(--color-surface)",
										color: "var(--color-text)",
										border: "1px solid var(--color-border)",
									}}
								>
									<option value="">-- Select --</option>
									{field.enum_values.map((v) => (
										<option key={v} value={v}>{v}</option>
									))}
								</select>
							) : field.type === "boolean" ? (
									<select
										value={values[field.name] ?? ""}
										onChange={(e) => updateField(field.name, e.target.value)}
										className="w-full px-3 py-2 text-sm rounded-lg outline-none"
										style={{
											background: "var(--color-surface)",
											color: "var(--color-text)",
											border: "1px solid var(--color-border)",
										}}
									>
										<option value="">-- Select --</option>
										<option value="true">Yes</option>
										<option value="false">No</option>
									</select>
								) : field.type === "richtext" ? (
									<textarea
										value={values[field.name] ?? ""}
										onChange={(e) => updateField(field.name, e.target.value)}
										rows={3}
										className="w-full px-3 py-2 text-sm rounded-lg outline-none resize-none"
										style={{
											background: "var(--color-surface)",
											color: "var(--color-text)",
											border: "1px solid var(--color-border)",
										}}
										placeholder={field.name}
									/>
								) : isRelation && field.related_object_name ? (
									<RelationSelect
										relatedObjectName={field.related_object_name}
										value={values[field.name] ?? ""}
										multiple={field.relationship_type === "many_to_many"}
										onChange={(v) => updateField(field.name, v)}
										placeholder={`Select ${displayObjectNameSingular(field.related_object_name)}...`}
									/>
								) : isUser ? (
									<select
										value={values[field.name] ?? ""}
										onChange={(e) => updateField(field.name, e.target.value)}
										className="w-full px-3 py-2 text-sm rounded-lg outline-none"
										style={{
											background: "var(--color-surface)",
											color: "var(--color-text)",
											border: "1px solid var(--color-border)",
										}}
									>
										<option value="">-- Select member --</option>
										{members?.map((m) => (
											<option key={m.id} value={m.id}>{m.name}</option>
										))}
									</select>
								) : (
									<input
										type={inputTypeForField(field.type)}
										value={values[field.name] ?? ""}
										onChange={(e) => updateField(field.name, e.target.value)}
										className="w-full px-3 py-2 text-sm rounded-lg outline-none"
										style={{
											background: "var(--color-surface)",
											color: "var(--color-text)",
											border: "1px solid var(--color-border)",
										}}
										placeholder={field.name}
									/>
								)}
							</div>
						);
					})}
				</form>

				{/* Footer */}
				<div
					className="flex items-center justify-end gap-2 px-6 py-4 border-t flex-shrink-0"
					style={{ borderColor: "var(--color-border)" }}
				>
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 text-sm rounded-lg"
						style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void handleSave()}
						disabled={saving}
						className="px-4 py-2 text-sm font-medium rounded-lg"
						style={{ background: "var(--color-accent)", color: "white", opacity: saving ? 0.7 : 1 }}
					>
						{saving ? "Saving..." : "Save"}
					</button>
				</div>
			</div>
		</div>
	);
}
