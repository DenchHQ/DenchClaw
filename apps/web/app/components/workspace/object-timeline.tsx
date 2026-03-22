"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
	parseISO, format, differenceInDays, addDays, startOfDay,
	eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval,
	min as dateMin, max as dateMax, addMonths, subMonths,
} from "date-fns";
import type { TimelineZoom } from "@/lib/object-filters";
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
};

type TimelineItem = {
	id: string;
	title: string;
	faviconUrl?: string;
	startDate: Date;
	endDate: Date;
	group?: string;
	color: string;
	entry: Record<string, unknown>;
};

export type TimelineDateChangePayload = {
	entryId: string;
	newStartDate: string;
	newEndDate: string;
};

type ObjectTimelineProps = {
	objectName: string;
	fields: Field[];
	entries: Record<string, unknown>[];
	startDateField: string;
	endDateField?: string;
	groupField?: string;
	zoom: TimelineZoom;
	onZoomChange: (zoom: TimelineZoom) => void;
	members?: Array<{ id: string; name: string }>;
	onEntryClick?: (entryId: string) => void;
	onEntryDateChange?: (payload: TimelineDateChangePayload) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZOOM_CONFIG: Record<TimelineZoom, { dayWidth: number; headerFormat: string }> = {
	day: { dayWidth: 80, headerFormat: "MMM d" },
	week: { dayWidth: 30, headerFormat: "MMM d" },
	month: { dayWidth: 10, headerFormat: "MMM yyyy" },
	quarter: { dayWidth: 4, headerFormat: "QQQ yyyy" },
};

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 50;
const SIDEBAR_WIDTH = 200;
const BAR_HEIGHT = 28;
const HANDLE_WIDTH = 8;

const PALETTE = [
	"#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
	"#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#6366f1",
];

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

function resolveTitle(entry: Record<string, unknown>, fields: Field[]): string {
	const titleField = fields.find((f) =>
		f.type === "text" && /name|title/i.test(f.name),
	) ?? fields.find((f) => f.type === "text");
	return titleField ? safeString(entry[titleField.name]) : safeString(entry.id);
}

function resolveColor(entry: Record<string, unknown>, fields: Field[], idx: number): string {
	const enumField = fields.find((f) => f.type === "enum" && f.enum_colors?.length);
	if (enumField) {
		const val = safeString(entry[enumField.name]);
		const i = enumField.enum_values?.indexOf(val) ?? -1;
		if (i >= 0 && enumField.enum_colors![i]) {return enumField.enum_colors![i];}
	}
	return PALETTE[idx % PALETTE.length];
}

function parseItems(
	entries: Record<string, unknown>[],
	fields: Field[],
	startDateField: string,
	endDateField?: string,
	groupField?: string,
): TimelineItem[] {
	const items: TimelineItem[] = [];
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const rawStart = safeString(entry[startDateField]);
		if (!rawStart) {continue;}
		try {
			const startDate = parseISO(rawStart);
			if (Number.isNaN(startDate.getTime())) {continue;}

			let endDate: Date;
			if (endDateField) {
				const rawEnd = safeString(entry[endDateField]);
				if (rawEnd) {
					const ed = parseISO(rawEnd);
					endDate = Number.isNaN(ed.getTime()) ? addDays(startDate, 1) : ed;
				} else {
					endDate = addDays(startDate, 1);
				}
			} else {
				endDate = addDays(startDate, 1);
			}

			if (endDate <= startDate) {endDate = addDays(startDate, 1);}

			items.push({
				id: safeString(entry.entry_id ?? entry.id),
				title: resolveTitle(entry, fields),
				faviconUrl: getFirstEntryUrlPreview(entry, fields)?.faviconUrl,
				startDate,
				endDate,
				group: groupField ? safeString(entry[groupField]) : undefined,
				color: resolveColor(entry, fields, i),
				entry,
			});
		} catch { /* skip */ }
	}
	return items.toSorted((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

function getTimelineBounds(items: TimelineItem[], zoom: TimelineZoom): { start: Date; end: Date } {
	if (items.length === 0) {
		const now = new Date();
		return { start: subMonths(now, 1), end: addMonths(now, 2) };
	}
	const earliest = dateMin(items.map((i) => i.startDate));
	const latest = dateMax(items.map((i) => i.endDate));
	const paddingDays = zoom === "day" ? 3 : zoom === "week" ? 7 : zoom === "month" ? 14 : 30;
	return {
		start: addDays(earliest, -paddingDays),
		end: addDays(latest, paddingDays),
	};
}

function getHeaderTicks(start: Date, end: Date, zoom: TimelineZoom): { date: Date; label: string }[] {
	switch (zoom) {
		case "day":
			return eachDayOfInterval({ start, end }).map((d) => ({ date: d, label: format(d, "MMM d") }));
		case "week":
			return eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).map((d) => ({ date: d, label: format(d, "MMM d") }));
		case "month":
			return eachMonthOfInterval({ start, end }).map((d) => ({ date: d, label: format(d, "MMM yyyy") }));
		case "quarter":
			return eachMonthOfInterval({ start, end })
				.filter((d) => d.getMonth() % 3 === 0)
				.map((d) => ({ date: d, label: format(d, "QQQ yyyy") }));
	}
}

function toISODate(d: Date): string { return format(d, "yyyy-MM-dd"); }

// ---------------------------------------------------------------------------
// Draggable bar
// ---------------------------------------------------------------------------

function DraggableBar({
	item,
	x,
	w,
	dayWidth,
	onEntryClick,
	onEntryDateChange,
}: {
	item: TimelineItem;
	x: number;
	w: number;
	dayWidth: number;
	onEntryClick?: (id: string) => void;
	onEntryDateChange?: (payload: TimelineDateChangePayload) => void;
}) {
	const [drag, setDrag] = useState<"move" | "resize-left" | "resize-right" | null>(null);
	const [deltaX, setDeltaX] = useState(0);
	const [deltaW, setDeltaW] = useState(0);
	const startXRef = useRef(0);
	const editable = !!onEntryDateChange;

	const snapToDays = useCallback((px: number) => {
		return Math.round(px / dayWidth) * dayWidth;
	}, [dayWidth]);

	const pxToDays = useCallback((px: number) => {
		return Math.round(px / dayWidth);
	}, [dayWidth]);

	const handlePointerDown = useCallback((e: React.PointerEvent, mode: "move" | "resize-left" | "resize-right") => {
		if (!editable) {return;}
		e.preventDefault();
		e.stopPropagation();
		startXRef.current = e.clientX;
		setDrag(mode);
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}, [editable]);

	const handlePointerMove = useCallback((e: React.PointerEvent) => {
		if (!drag) {return;}
		const rawDelta = e.clientX - startXRef.current;
		const snapped = snapToDays(rawDelta);

		if (drag === "move") {
			setDeltaX(snapped);
		} else if (drag === "resize-left") {
			// shrink/grow from left: move x right and shrink width
			setDeltaX(snapped);
			setDeltaW(-snapped);
		} else {
			setDeltaW(snapped);
		}
	}, [drag, snapToDays]);

	const handlePointerUp = useCallback((e: React.PointerEvent) => {
		if (!drag || !onEntryDateChange) { setDrag(null); return; }
		const rawDelta = e.clientX - startXRef.current;
		const daysDelta = pxToDays(rawDelta);

		if (daysDelta === 0 && drag === "move") {
			setDrag(null);
			setDeltaX(0);
			setDeltaW(0);
			return;
		}

		let newStart = item.startDate;
		let newEnd = item.endDate;

		if (drag === "move") {
			newStart = addDays(item.startDate, daysDelta);
			newEnd = addDays(item.endDate, daysDelta);
		} else if (drag === "resize-left") {
			newStart = addDays(item.startDate, daysDelta);
			if (newStart >= newEnd) {newStart = addDays(newEnd, -1);}
		} else {
			newEnd = addDays(item.endDate, daysDelta);
			if (newEnd <= newStart) {newEnd = addDays(newStart, 1);}
		}

		onEntryDateChange({
			entryId: item.id,
			newStartDate: toISODate(newStart),
			newEndDate: toISODate(newEnd),
		});

		setDrag(null);
		setDeltaX(0);
		setDeltaW(0);
	}, [drag, onEntryDateChange, item, pxToDays]);

	const renderX = x + deltaX;
	const renderW = Math.max(w + deltaW, dayWidth * 0.5);

	return (
		<div
			className="absolute rounded flex items-center text-[11px] truncate select-none"
			style={{
				left: renderX,
				width: renderW,
				top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
				height: BAR_HEIGHT,
				backgroundColor: item.color,
				color: "#fff",
				zIndex: drag ? 20 : 2,
				cursor: editable ? (drag === "move" ? "grabbing" : "grab") : "pointer",
				opacity: drag ? 0.85 : 1,
				transition: drag ? "none" : "left 0.15s, width 0.15s",
			}}
			onPointerDown={(e) => handlePointerDown(e, "move")}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onClick={(e) => { if (!drag) { e.stopPropagation(); onEntryClick?.(item.id); } }}
			title={`${item.title}\n${format(item.startDate, "MMM d")} - ${format(item.endDate, "MMM d")}`}
		>
			{/* Left resize handle */}
			{editable && (
				<div
					className="absolute left-0 top-0 bottom-0 cursor-ew-resize hover:bg-white/20 rounded-l"
					style={{ width: HANDLE_WIDTH }}
					onPointerDown={(e) => handlePointerDown(e, "resize-left")}
				/>
			)}

			<span className="px-2 flex min-w-0 items-center gap-1.5 flex-1">
				{item.faviconUrl && renderW > 84 && (
					<UrlFavicon
						src={item.faviconUrl}
						className="w-3 h-3 rounded-[2px] shrink-0"
					/>
				)}
				<span className="truncate">{renderW > 60 ? (item.title || "Untitled") : ""}</span>
			</span>

			{/* Right resize handle */}
			{editable && (
				<div
					className="absolute right-0 top-0 bottom-0 cursor-ew-resize hover:bg-white/20 rounded-r"
					style={{ width: HANDLE_WIDTH }}
					onPointerDown={(e) => handlePointerDown(e, "resize-right")}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function TimelineEmptyState({ reason }: { reason: "no-fields" | "no-items" }) {
	return (
		<div className="flex flex-col items-center justify-center py-16 gap-2">
			<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>
				<path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />
			</svg>
			<span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
				{reason === "no-fields"
					? "No date fields configured for timeline view. Open view settings to select start/end dates."
					: "No items with dates to display in this view."}
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ObjectTimeline({
	objectName: _objectName,
	fields,
	entries,
	startDateField,
	endDateField,
	groupField,
	zoom,
	onZoomChange,
	members: _members,
	onEntryClick,
	onEntryDateChange,
}: ObjectTimelineProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	const items = useMemo(
		() => parseItems(entries, fields, startDateField, endDateField, groupField),
		[entries, fields, startDateField, endDateField, groupField],
	);

	const { start: timelineStart, end: timelineEnd } = useMemo(
		() => getTimelineBounds(items, zoom),
		[items, zoom],
	);

	const { dayWidth } = ZOOM_CONFIG[zoom];
	const totalDays = differenceInDays(timelineEnd, timelineStart) + 1;
	const totalWidth = totalDays * dayWidth;

	const ticks = useMemo(
		() => getHeaderTicks(timelineStart, timelineEnd, zoom),
		[timelineStart, timelineEnd, zoom],
	);

	const groups = useMemo(() => {
		if (!groupField) {return [{ name: "", items }];}
		const groupMap = new Map<string, TimelineItem[]>();
		for (const item of items) {
			const g = item.group || "Ungrouped";
			if (!groupMap.has(g)) {groupMap.set(g, []);}
			groupMap.get(g)!.push(item);
		}
		return Array.from(groupMap.entries()).map(([name, gItems]) => ({ name, items: gItems }));
	}, [items, groupField]);

	const flatRows = useMemo(() => {
		const rows: { type: "group" | "item"; group?: string; item?: TimelineItem }[] = [];
		for (const g of groups) {
			if (groupField && g.name) {rows.push({ type: "group", group: g.name });}
			for (const item of g.items) {rows.push({ type: "item", item });}
		}
		return rows;
	}, [groups, groupField]);

	const dateToX = useCallback(
		(date: Date) => differenceInDays(date, timelineStart) * dayWidth,
		[timelineStart, dayWidth],
	);

	useEffect(() => {
		if (!containerRef.current) {return;}
		const todayX = dateToX(new Date());
		containerRef.current.scrollLeft = Math.max(0, todayX - 300);
	}, [dateToX]);

	if (!startDateField) {return <TimelineEmptyState reason="no-fields" />;}
	if (items.length === 0) {return <TimelineEmptyState reason="no-items" />;}

	const todayX = dateToX(startOfDay(new Date()));
	const zoomLevels: TimelineZoom[] = ["day", "week", "month", "quarter"];

	return (
		<div className="w-full">
			<div className="flex items-center justify-between mb-3 px-1">
				<div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
					{items.length} item{items.length !== 1 ? "s" : ""}
				</div>
				<div className="flex items-center gap-2">
					<span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Zoom:</span>
					<div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
						{zoomLevels.map((z) => (
							<button
								key={z}
								type="button"
								onClick={() => onZoomChange(z)}
								className="text-[11px] px-3 py-1 capitalize transition-colors"
								style={{
									background: z === zoom ? "var(--color-accent)" : "var(--color-surface)",
									color: z === zoom ? "#fff" : "var(--color-text-muted)",
									borderRight: z !== "quarter" ? "1px solid var(--color-border)" : undefined,
								}}
							>
								{z}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
				<div className="flex">
					<div
						className="flex-shrink-0 border-r"
						style={{ width: SIDEBAR_WIDTH, borderColor: "var(--color-border)", background: "var(--color-surface)" }}
					>
						<div
							className="border-b px-3 flex items-center text-[11px] font-medium"
							style={{ height: HEADER_HEIGHT, borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
						>
							Name
						</div>
						{flatRows.map((row, i) => (
							<div
								key={i}
								className={`px-3 flex items-center border-b truncate ${row.type === "group" ? "text-[10px] font-semibold uppercase tracking-wider" : "text-[12px] cursor-pointer hover:bg-[var(--color-surface-hover)]"}`}
								style={{
									height: ROW_HEIGHT,
									borderColor: "var(--color-border)",
									color: row.type === "group" ? "var(--color-text-muted)" : "var(--color-text)",
									background: row.type === "group" ? "var(--color-surface-hover)" : undefined,
								}}
								onClick={() => row.item && onEntryClick?.(row.item.id)}
							>
								{row.type === "group" ? row.group : (
									<span className="flex min-w-0 items-center gap-1.5">
										{row.item?.faviconUrl && (
											<UrlFavicon
												src={row.item.faviconUrl}
												className="w-3.5 h-3.5 rounded-[3px] shrink-0"
											/>
										)}
										<span className="truncate">{row.item?.title || "Untitled"}</span>
									</span>
								)}
							</div>
						))}
					</div>

					<div
						ref={containerRef}
						className="flex-1 overflow-x-auto overflow-y-hidden"
						style={{ maxHeight: `calc(100vh - 280px)` }}
					>
						<div style={{ width: totalWidth, position: "relative" }}>
							<div className="border-b flex" style={{ height: HEADER_HEIGHT, borderColor: "var(--color-border)" }}>
								{ticks.map((tick, i) => {
									const tx = dateToX(tick.date);
									const nextX = i < ticks.length - 1 ? dateToX(ticks[i + 1].date) : totalWidth;
									return (
										<div
											key={i}
											className="absolute border-r flex items-end pb-1 px-2 text-[10px]"
											style={{ left: tx, width: nextX - tx, height: HEADER_HEIGHT, borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
										>
											{tick.label}
										</div>
									);
								})}
							</div>

							{flatRows.map((row, i) => (
								<div
									key={i}
									className="relative border-b"
									style={{
										height: ROW_HEIGHT,
										borderColor: "var(--color-border)",
										background: row.type === "group" ? "var(--color-surface-hover)" : undefined,
									}}
								>
									{row.item && (() => {
										const barItem = row.item;
										const bx = dateToX(barItem.startDate);
										const bw = Math.max(dateToX(barItem.endDate) - bx, dayWidth * 0.5);
										return (
											<DraggableBar
												item={barItem}
												x={bx}
												w={bw}
												dayWidth={dayWidth}
												onEntryClick={onEntryClick}
												onEntryDateChange={onEntryDateChange}
											/>
										);
									})()}
								</div>
							))}

							{todayX >= 0 && todayX <= totalWidth && (
								<div
									className="absolute top-0 bottom-0 pointer-events-none"
									style={{ left: todayX, width: 2, backgroundColor: "var(--color-accent)", opacity: 0.6, zIndex: 10 }}
								/>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
