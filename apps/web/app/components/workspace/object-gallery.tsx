"use client";

import { useMemo } from "react";
import { FormattedFieldValue } from "./formatted-field-value";
import { formatWorkspaceFieldValue } from "@/lib/workspace-cell-format";
import { parseTagsValue } from "@/lib/parse-tags";
import { UrlFavicon } from "./url-favicon";
import { getFirstEntryUrlPreview } from "./workspace-url-preview";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Field = {
	id: string;
	name: string;
	type: string;
	enum_values?: string[];
	enum_colors?: string[];
	related_object_name?: string;
};

type ObjectGalleryProps = {
	objectName: string;
	fields: Field[];
	entries: Record<string, unknown>[];
	titleField?: string;
	coverField?: string;
	members?: Array<{ id: string; name: string }>;
	relationLabels?: Record<string, Record<string, string>>;
	onEntryClick?: (entryId: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeString(val: unknown): string {
	if (val == null) {return "";}
	if (typeof val === "string") {return val;}
	if (typeof val === "number" || typeof val === "boolean" || typeof val === "bigint") {return String(val);}
	if (typeof val === "object") {return JSON.stringify(val);}
	return "";
}

function resolveTitle(entry: Record<string, unknown>, fields: Field[], titleField?: string): string {
	if (titleField) {
		const val = safeString(entry[titleField]);
		if (val) {return val;}
	}
	const autoField = fields.find((f) =>
		f.type === "text" && /name|title/i.test(f.name),
	) ?? fields.find((f) => f.type === "text");
	return autoField ? safeString(entry[autoField.name]) : safeString(entry.id);
}

function getEnumBadge(
	val: string,
	field: Field,
): { text: string; color: string } | null {
	if (!val || !field.enum_values) {return null;}
	const idx = field.enum_values.indexOf(val);
	const color = idx >= 0 && field.enum_colors?.[idx] ? field.enum_colors[idx] : "#94a3b8";
	return { text: val, color };
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function GalleryCard({
	entry,
	fields,
	titleField,
	coverField,
	onEntryClick,
}: {
	entry: Record<string, unknown>;
	fields: Field[];
	titleField?: string;
	coverField?: string;
	onEntryClick?: (id: string) => void;
}) {
	const entryId = safeString(entry.entry_id ?? entry.id);
	const title = resolveTitle(entry, fields, titleField);
	const titleUrlPreview = getFirstEntryUrlPreview(entry, fields);

	// Show up to 4 non-title fields
	const displayFields = useMemo(() => {
		return fields
			.filter((f) => f.name !== titleField && f.name !== coverField)
			.slice(0, 4);
	}, [fields, titleField, coverField]);

	// Enum badge for the first enum field
	const enumField = fields.find((f) => f.type === "enum" && f.enum_values?.length);
	const enumVal = enumField ? safeString(entry[enumField.name]) : null;
	const badge = enumField && enumVal ? getEnumBadge(enumVal, enumField) : null;

	return (
		<button
			type="button"
			onClick={() => onEntryClick?.(entryId)}
			className="text-left rounded-xl border p-4 hover:shadow-md transition-all cursor-pointer w-full group"
			style={{
				borderColor: "var(--color-border)",
				background: "var(--color-surface)",
			}}
		>
			{/* Title + badge row */}
			<div className="flex items-start justify-between gap-2 mb-2">
				<div className="flex min-w-0 items-start gap-2">
					{titleUrlPreview?.faviconUrl && (
						<UrlFavicon
							src={titleUrlPreview.faviconUrl}
							className="w-4 h-4 rounded-[4px] shrink-0 mt-0.5"
						/>
					)}
					<h4
						className="text-[13px] font-semibold leading-tight line-clamp-2 group-hover:underline"
						style={{ color: "var(--color-text)" }}
					>
						{title || "Untitled"}
					</h4>
				</div>
				{badge && (
					<span
						className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap"
						style={{ backgroundColor: badge.color, color: "#fff" }}
					>
						{badge.text}
					</span>
				)}
			</div>

			{/* Field values */}
			<div className="flex flex-col gap-1.5">
				{displayFields.map((field) => {
					const val = entry[field.name];
					if (val == null || safeString(val) === "") {return null;}
					const tags = field.type === "tags" ? parseTagsValue(val) : [];
					return (
						<div key={field.id} className="flex items-baseline gap-2">
							<span
								className="text-[10px] flex-shrink-0 min-w-[60px]"
								style={{ color: "var(--color-text-muted)" }}
							>
								{field.name}
							</span>
							<div className="text-[12px] whitespace-pre-line line-clamp-2" style={{ color: "var(--color-text)" }}>
								{field.type === "tags" ? (
									<span className="flex items-center gap-0.5 flex-wrap">
										{tags.slice(0, 3).map((tag) => {
											const fmt = formatWorkspaceFieldValue(tag);
											const isLink = fmt.kind === "link" && fmt.href;
											const showFavicon = fmt.linkType === "url" && !!fmt.faviconUrl;
											return isLink ? (
												<a key={tag} href={fmt.href!} target={fmt.linkType === "url" || fmt.linkType === "file" ? "_blank" : undefined} rel={fmt.linkType === "url" || fmt.linkType === "file" ? "noopener noreferrer" : undefined} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 px-1.5 py-0 rounded text-[11px] font-medium hover:underline underline-offset-2 max-w-[220px]" style={{ background: "rgba(148, 163, 184, 0.12)", color: "var(--color-accent)" }}>
													{showFavicon && (
														<UrlFavicon
															src={fmt.faviconUrl!}
															className="w-3 h-3 rounded-[2px] shrink-0"
														/>
													)}
													<span className="min-w-0 truncate">{fmt.text}</span>
												</a>
											) : (
												<span key={tag} className="inline-flex items-center px-1.5 py-0 rounded text-[11px] font-medium" style={{ background: "rgba(148, 163, 184, 0.12)", color: "var(--color-text-muted)" }}>{tag}</span>
											);
										})}
										{tags.length > 3 && <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>+{tags.length - 3}</span>}
									</span>
								) : (
									<FormattedFieldValue value={val} fieldType={field.type} mode="table" showUrlFavicon />
								)}
							</div>
						</div>
					);
				})}
			</div>

			{/* Timestamp */}
			{entry.created_at != null && (
				<div className="mt-3 text-[10px]" style={{ color: "var(--color-text-muted)", opacity: 0.6 }}>
					{safeString(entry.created_at).slice(0, 10)}
				</div>
			)}
		</button>
	);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function GalleryEmptyState() {
	return (
		<div className="flex flex-col items-center justify-center py-16 gap-2">
			<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>
				<rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" />
				<rect width="7" height="7" x="3" y="14" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" />
			</svg>
			<span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
				No entries to display in gallery view.
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function ObjectGallery({
	objectName: _objectName,
	fields,
	entries,
	titleField,
	coverField,
	members: _members,
	relationLabels: _relationLabels,
	onEntryClick,
}: ObjectGalleryProps) {
	if (entries.length === 0) {
		return <GalleryEmptyState />;
	}

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
			{entries.map((entry) => (
				<GalleryCard
					key={safeString(entry.entry_id ?? entry.id)}
					entry={entry}
					fields={fields}
					titleField={titleField}
					coverField={coverField}
					onEntryClick={onEntryClick}
				/>
			))}
		</div>
	);
}
