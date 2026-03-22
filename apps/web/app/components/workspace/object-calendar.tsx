"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import {
	startOfMonth, endOfMonth, startOfWeek, endOfWeek,
	startOfDay, addDays, addWeeks, addMonths, addYears,
	subDays, subWeeks, subMonths, subYears,
	eachDayOfInterval, format, isSameDay, isSameMonth,
	isToday, parseISO, getHours, getMinutes, differenceInMinutes,
	startOfYear, eachMonthOfInterval, endOfYear,
	addMinutes,
} from "date-fns";
import type { CalendarMode } from "@/lib/object-filters";
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

type CalendarEvent = {
	id: string;
	title: string;
	faviconUrl?: string;
	date: Date;
	endDate?: Date;
	entry: Record<string, unknown>;
	color?: string;
};

export type CalendarDateChangePayload = {
	entryId: string;
	newDate: string;
	newEndDate?: string;
};

type ObjectCalendarProps = {
	objectName: string;
	fields: Field[];
	entries: Record<string, unknown>[];
	dateField: string;
	endDateField?: string;
	mode: CalendarMode;
	onModeChange: (mode: CalendarMode) => void;
	members?: Array<{ id: string; name: string }>;
	onEntryClick?: (entryId: string) => void;
	onEntryDateChange?: (payload: CalendarDateChangePayload) => void;
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

function resolveTitle(entry: Record<string, unknown>, fields: Field[]): string {
	const titleField = fields.find((f) =>
		f.type === "text" && /name|title/i.test(f.name),
	) ?? fields.find((f) => f.type === "text");
	return titleField ? safeString(entry[titleField.name]) : safeString(entry.id);
}

function resolveColor(entry: Record<string, unknown>, fields: Field[]): string | undefined {
	const enumField = fields.find((f) => f.type === "enum" && f.enum_colors?.length);
	if (!enumField) {return undefined;}
	const val = safeString(entry[enumField.name]);
	const idx = enumField.enum_values?.indexOf(val) ?? -1;
	return idx >= 0 ? enumField.enum_colors![idx] : undefined;
}

function parseEvents(
	entries: Record<string, unknown>[],
	fields: Field[],
	dateField: string,
	endDateField?: string,
): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	for (const entry of entries) {
		const raw = safeString(entry[dateField]);
		if (!raw) {continue;}
		try {
			const date = parseISO(raw);
			if (Number.isNaN(date.getTime())) {continue;}
			let endDate: Date | undefined;
			if (endDateField) {
				const rawEnd = safeString(entry[endDateField]);
				if (rawEnd) {
					const ed = parseISO(rawEnd);
					if (!Number.isNaN(ed.getTime())) {endDate = ed;}
				}
			}
			events.push({
				id: safeString(entry.entry_id ?? entry.id),
				title: resolveTitle(entry, fields),
				faviconUrl: getFirstEntryUrlPreview(entry, fields)?.faviconUrl,
				date,
				endDate,
				entry,
				color: resolveColor(entry, fields),
			});
		} catch { /* skip unparseable dates */ }
	}
	return events;
}

const HOUR_HEIGHT = 60;
const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;

function toISODate(d: Date): string { return format(d, "yyyy-MM-dd"); }
function toISODateTime(d: Date): string { return d.toISOString(); }

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function navigateDate(date: Date, mode: CalendarMode, direction: 1 | -1): Date {
	switch (mode) {
		case "day": return direction === 1 ? addDays(date, 1) : subDays(date, 1);
		case "week": return direction === 1 ? addWeeks(date, 1) : subWeeks(date, 1);
		case "month": return direction === 1 ? addMonths(date, 1) : subMonths(date, 1);
		case "year": return direction === 1 ? addYears(date, 1) : subYears(date, 1);
	}
}

function formatDateHeader(date: Date, mode: CalendarMode): string {
	switch (mode) {
		case "day": return format(date, "EEEE, MMMM d, yyyy");
		case "week": {
			const start = startOfWeek(date, { weekStartsOn: 1 });
			const end = endOfWeek(date, { weekStartsOn: 1 });
			return `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`;
		}
		case "month": return format(date, "MMMM yyyy");
		case "year": return format(date, "yyyy");
	}
}

// ---------------------------------------------------------------------------
// EventChip (used in month view, supports drag)
// ---------------------------------------------------------------------------

function EventChip({
	event,
	compact,
	onClick,
	draggable,
	onDragStart,
}: {
	event: CalendarEvent;
	compact?: boolean;
	onClick?: () => void;
	draggable?: boolean;
	onDragStart?: (e: React.DragEvent) => void;
}) {
	const bg = event.color ?? "var(--color-accent)";
	return (
		<button
			type="button"
			draggable={draggable}
			onDragStart={onDragStart}
			onClick={(e) => { e.stopPropagation(); onClick?.(); }}
			className={`text-left rounded px-1.5 truncate cursor-pointer transition-opacity hover:opacity-80 ${compact ? "text-[10px] py-0" : "text-[11px] py-0.5"}`}
			style={{
				backgroundColor: bg,
				color: "#fff",
				border: "none",
				width: "100%",
				lineHeight: compact ? "16px" : "18px",
			}}
			title={event.title}
		>
			<span className="flex min-w-0 items-center gap-1">
				{!compact && <span className="opacity-70 shrink-0">{format(event.date, "HH:mm")}</span>}
				{event.faviconUrl && (
					<UrlFavicon
						src={event.faviconUrl}
						className="w-3 h-3 rounded-[2px] shrink-0"
					/>
				)}
				<span className="truncate">{event.title || "Untitled"}</span>
			</span>
		</button>
	);
}

// ---------------------------------------------------------------------------
// Month View (drag events between day cells)
// ---------------------------------------------------------------------------

function MonthView({
	date,
	events,
	onEntryClick,
	onEntryDateChange,
}: {
	date: Date;
	events: CalendarEvent[];
	onEntryClick?: (id: string) => void;
	onEntryDateChange?: (payload: CalendarDateChangePayload) => void;
}) {
	const [dragOverDay, setDragOverDay] = useState<string | null>(null);
	const dragEventRef = useRef<CalendarEvent | null>(null);

	const monthStart = startOfMonth(date);
	const monthEnd = endOfMonth(date);
	const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
	const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
	const days = eachDayOfInterval({ start: calStart, end: calEnd });

	const eventsByDay = useMemo(() => {
		const map = new Map<string, CalendarEvent[]>();
		for (const ev of events) {
			const key = format(ev.date, "yyyy-MM-dd");
			if (!map.has(key)) {map.set(key, []);}
			map.get(key)!.push(ev);
			if (ev.endDate && !isSameDay(ev.date, ev.endDate)) {
				const spanDays = eachDayOfInterval({ start: addDays(ev.date, 1), end: ev.endDate });
				for (const d of spanDays) {
					const dk = format(d, "yyyy-MM-dd");
					if (!map.has(dk)) {map.set(dk, []);}
					map.get(dk)!.push(ev);
				}
			}
		}
		return map;
	}, [events]);

	const handleDragStart = useCallback((ev: CalendarEvent) => {
		dragEventRef.current = ev;
	}, []);

	const handleDragOver = useCallback((e: React.DragEvent, dayKey: string) => {
		e.preventDefault();
		setDragOverDay(dayKey);
	}, []);

	const handleDrop = useCallback((e: React.DragEvent, targetDay: Date) => {
		e.preventDefault();
		setDragOverDay(null);
		const ev = dragEventRef.current;
		if (!ev || !onEntryDateChange) {return;}
		if (isSameDay(ev.date, targetDay)) {return;}

		const dayDelta = differenceInMinutes(startOfDay(targetDay), startOfDay(ev.date));
		const newDate = addMinutes(ev.date, dayDelta);
		const payload: CalendarDateChangePayload = {
			entryId: ev.id,
			newDate: toISODate(newDate),
		};
		if (ev.endDate) {
			payload.newEndDate = toISODate(addMinutes(ev.endDate, dayDelta));
		}
		onEntryDateChange(payload);
		dragEventRef.current = null;
	}, [onEntryDateChange]);

	const handleDragLeave = useCallback(() => setDragOverDay(null), []);

	const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

	return (
		<div className="w-full">
			<div className="grid grid-cols-7 border-b" style={{ borderColor: "var(--color-border)" }}>
				{weekdays.map((wd) => (
					<div key={wd} className="text-center text-[11px] font-medium py-2" style={{ color: "var(--color-text-muted)" }}>
						{wd}
					</div>
				))}
			</div>
			<div className="grid grid-cols-7">
				{days.map((day) => {
					const key = format(day, "yyyy-MM-dd");
					const dayEvents = eventsByDay.get(key) ?? [];
					const inMonth = isSameMonth(day, date);
					const today = isToday(day);
					const isDragTarget = dragOverDay === key;
					return (
						<div
							key={key}
							className="min-h-[100px] border-b border-r p-1 transition-colors"
							style={{
								borderColor: "var(--color-border)",
								opacity: inMonth ? 1 : 0.4,
								background: isDragTarget ? "var(--color-accent-light, rgba(99,102,241,0.12))" : today ? "var(--color-surface-hover)" : undefined,
							}}
							onDragOver={(e) => handleDragOver(e, key)}
							onDragLeave={handleDragLeave}
							onDrop={(e) => handleDrop(e, day)}
						>
							<div
								className={`text-[11px] mb-0.5 ${today ? "font-bold" : ""}`}
								style={{ color: today ? "var(--color-accent)" : "var(--color-text-muted)" }}
							>
								{format(day, "d")}
							</div>
							<div className="flex flex-col gap-0.5">
								{dayEvents.slice(0, 3).map((ev) => (
									<EventChip
										key={ev.id}
										event={ev}
										compact
										onClick={() => onEntryClick?.(ev.id)}
										draggable={!!onEntryDateChange}
										onDragStart={() => handleDragStart(ev)}
									/>
								))}
								{dayEvents.length > 3 && (
									<span className="text-[10px] pl-1" style={{ color: "var(--color-text-muted)" }}>
										+{dayEvents.length - 3} more
									</span>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Time-grid drag (used by Week and Day views)
// ---------------------------------------------------------------------------

function DraggableTimeEvent({
	event,
	hourHeight,
	onEntryClick,
	onEntryDateChange,
}: {
	event: CalendarEvent;
	hourHeight: number;
	onEntryClick?: (id: string) => void;
	onEntryDateChange?: (payload: CalendarDateChangePayload) => void;
}) {
	const elRef = useRef<HTMLDivElement>(null);
	const [dragging, setDragging] = useState<"move" | "resize" | null>(null);
	const dragStartRef = useRef({ y: 0, startMinute: 0, duration: 0 });

	const topOffset = (getMinutes(event.date) / 60) * hourHeight;
	const duration = event.endDate
		? Math.max(differenceInMinutes(event.endDate, event.date), 15)
		: 30;
	const height = (duration / 60) * hourHeight;

	const [offsetY, setOffsetY] = useState(0);
	const [resizeDelta, setResizeDelta] = useState(0);

	const handleMoveStart = useCallback((e: React.PointerEvent) => {
		if (!onEntryDateChange) {return;}
		e.preventDefault();
		e.stopPropagation();
		setDragging("move");
		dragStartRef.current = { y: e.clientY, startMinute: getHours(event.date) * 60 + getMinutes(event.date), duration };
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}, [onEntryDateChange, event.date, duration]);

	const handleResizeStart = useCallback((e: React.PointerEvent) => {
		if (!onEntryDateChange) {return;}
		e.preventDefault();
		e.stopPropagation();
		setDragging("resize");
		dragStartRef.current = { y: e.clientY, startMinute: 0, duration };
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}, [onEntryDateChange, duration]);

	const handlePointerMove = useCallback((e: React.PointerEvent) => {
		if (!dragging) {return;}
		const deltaY = e.clientY - dragStartRef.current.y;
		if (dragging === "move") {
			setOffsetY(deltaY);
		} else {
			setResizeDelta(deltaY);
		}
	}, [dragging]);

	const handlePointerUp = useCallback((e: React.PointerEvent) => {
		if (!dragging || !onEntryDateChange) {return;}
		const deltaY = e.clientY - dragStartRef.current.y;
		const deltaMinutes = Math.round((deltaY / hourHeight) * 60 / 15) * 15; // snap to 15min

		if (dragging === "move" && deltaMinutes !== 0) {
			const newDate = addMinutes(event.date, deltaMinutes);
			const payload: CalendarDateChangePayload = {
				entryId: event.id,
				newDate: toISODateTime(newDate),
			};
			if (event.endDate) {
				payload.newEndDate = toISODateTime(addMinutes(event.endDate, deltaMinutes));
			}
			onEntryDateChange(payload);
		} else if (dragging === "resize" && deltaMinutes !== 0) {
			const newEndDate = addMinutes(event.endDate ?? addMinutes(event.date, duration), deltaMinutes);
			if (newEndDate > event.date) {
				onEntryDateChange({
					entryId: event.id,
					newDate: toISODateTime(event.date),
					newEndDate: toISODateTime(newEndDate),
				});
			}
		}

		setDragging(null);
		setOffsetY(0);
		setResizeDelta(0);
	}, [dragging, onEntryDateChange, event, hourHeight, duration]);

	const renderTop = topOffset + (dragging === "move" ? offsetY : 0);
	const renderHeight = Math.max(height + (dragging === "resize" ? resizeDelta : 0), 15);

	return (
		<div
			ref={elRef}
			className="absolute left-0.5 right-0.5 rounded px-1 text-[10px] truncate select-none"
			style={{
				top: renderTop,
				height: Math.min(renderHeight, hourHeight * 6),
				backgroundColor: event.color ?? "var(--color-accent)",
				color: "#fff",
				lineHeight: "16px",
				zIndex: dragging ? 20 : 2,
				cursor: onEntryDateChange ? (dragging === "move" ? "grabbing" : "grab") : "pointer",
				opacity: dragging ? 0.85 : 1,
				transition: dragging ? "none" : "top 0.15s, height 0.15s",
			}}
			onPointerDown={handleMoveStart}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onClick={(e) => { if (!dragging) { e.stopPropagation(); onEntryClick?.(event.id); } }}
			title={event.title}
		>
			<span className="flex min-w-0 items-center gap-1">
				{event.faviconUrl && (
					<UrlFavicon
						src={event.faviconUrl}
						className="w-3 h-3 rounded-[2px] shrink-0"
					/>
				)}
				<span className="truncate">{event.title || "Untitled"}</span>
			</span>
			{/* Resize handle at bottom */}
			{onEntryDateChange && (
				<div
					className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize"
					style={{ borderRadius: "0 0 4px 4px" }}
					onPointerDown={handleResizeStart}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Week View
// ---------------------------------------------------------------------------

function WeekView({
	date,
	events,
	onEntryClick,
	onEntryDateChange,
}: {
	date: Date;
	events: CalendarEvent[];
	onEntryClick?: (id: string) => void;
	onEntryDateChange?: (payload: CalendarDateChangePayload) => void;
}) {
	const weekStart = startOfWeek(date, { weekStartsOn: 1 });
	const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });
	const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => i + DAY_START_HOUR);

	const eventsByDay = useMemo(() => {
		const map = new Map<string, CalendarEvent[]>();
		for (const ev of events) {
			const key = format(ev.date, "yyyy-MM-dd");
			if (!map.has(key)) {map.set(key, []);}
			map.get(key)!.push(ev);
		}
		return map;
	}, [events]);

	return (
		<div className="w-full overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
			<div className="grid" style={{ gridTemplateColumns: "50px repeat(7, 1fr)" }}>
				<div className="sticky top-0 z-10" style={{ background: "var(--color-bg)" }} />
				{days.map((day) => (
					<div
						key={day.toISOString()}
						className="sticky top-0 z-10 text-center py-2 border-b border-l text-[12px] font-medium"
						style={{
							borderColor: "var(--color-border)",
							background: "var(--color-bg)",
							color: isToday(day) ? "var(--color-accent)" : "var(--color-text)",
						}}
					>
						<div>{format(day, "EEE")}</div>
						<div className={`text-lg ${isToday(day) ? "font-bold" : ""}`}>{format(day, "d")}</div>
					</div>
				))}
				{hours.map((hour) => (
					<>
						<div
							key={`label-${hour}`}
							className="text-[10px] text-right pr-2 pt-0.5"
							style={{ color: "var(--color-text-muted)", height: HOUR_HEIGHT }}
						>
							{format(new Date(2000, 0, 1, hour), "ha")}
						</div>
						{days.map((day) => {
							const key = format(day, "yyyy-MM-dd");
							const dayEvents = (eventsByDay.get(key) ?? []).filter(
								(ev) => getHours(ev.date) === hour,
							);
							return (
								<div
									key={`${key}-${hour}`}
									className="border-b border-l relative"
									style={{ borderColor: "var(--color-border)", height: HOUR_HEIGHT }}
								>
									{dayEvents.map((ev) => (
										<DraggableTimeEvent
											key={ev.id}
											event={ev}
											hourHeight={HOUR_HEIGHT}
											onEntryClick={onEntryClick}
											onEntryDateChange={onEntryDateChange}
										/>
									))}
								</div>
							);
						})}
					</>
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Day View
// ---------------------------------------------------------------------------

function DayView({
	date,
	events,
	onEntryClick,
	onEntryDateChange,
}: {
	date: Date;
	events: CalendarEvent[];
	onEntryClick?: (id: string) => void;
	onEntryDateChange?: (payload: CalendarDateChangePayload) => void;
}) {
	const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => i + DAY_START_HOUR);

	const dayEvents = useMemo(
		() => events.filter((ev) => isSameDay(ev.date, date)),
		[events, date],
	);

	return (
		<div className="w-full overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
			<div className="grid" style={{ gridTemplateColumns: "60px 1fr" }}>
				{hours.map((hour) => {
					const hourEvents = dayEvents.filter((ev) => getHours(ev.date) === hour);
					return (
						<>
							<div
								key={`label-${hour}`}
								className="text-[11px] text-right pr-3 pt-0.5"
								style={{ color: "var(--color-text-muted)", height: HOUR_HEIGHT }}
							>
								{format(new Date(2000, 0, 1, hour), "h:mm a")}
							</div>
							<div
								key={`cell-${hour}`}
								className="border-b border-l relative"
								style={{ borderColor: "var(--color-border)", height: HOUR_HEIGHT }}
							>
								{hourEvents.map((ev) => (
									<DraggableTimeEvent
										key={ev.id}
										event={ev}
										hourHeight={HOUR_HEIGHT}
										onEntryClick={onEntryClick}
										onEntryDateChange={onEntryDateChange}
									/>
								))}
							</div>
						</>
					);
				})}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Year View (no drag — too compact)
// ---------------------------------------------------------------------------

function YearView({
	date,
	events,
}: {
	date: Date;
	events: CalendarEvent[];
}) {
	const yearStart = startOfYear(date);
	const yearEnd = endOfYear(date);
	const months = eachMonthOfInterval({ start: yearStart, end: yearEnd });

	const eventsByMonth = useMemo(() => {
		const map = new Map<number, CalendarEvent[]>();
		for (const ev of events) {
			const m = ev.date.getMonth();
			if (!map.has(m)) {map.set(m, []);}
			map.get(m)!.push(ev);
		}
		return map;
	}, [events]);

	return (
		<div className="grid grid-cols-3 md:grid-cols-4 gap-4 p-2">
			{months.map((month) => {
				const mStart = startOfMonth(month);
				const mEnd = endOfMonth(month);
				const calStart = startOfWeek(mStart, { weekStartsOn: 1 });
				const calEnd = endOfWeek(mEnd, { weekStartsOn: 1 });
				const days = eachDayOfInterval({ start: calStart, end: calEnd });
				const monthEvents = eventsByMonth.get(month.getMonth()) ?? [];
				return (
					<div
						key={month.toISOString()}
						className="rounded-lg border p-2"
						style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
					>
						<div className="text-[12px] font-semibold mb-1" style={{ color: "var(--color-text)" }}>
							{format(month, "MMMM")}
						</div>
						<div className="grid grid-cols-7 gap-px">
							{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
								<div key={i} className="text-[9px] text-center" style={{ color: "var(--color-text-muted)" }}>{d}</div>
							))}
							{days.map((day) => {
								const inMonth = isSameMonth(day, month);
								const today = isToday(day);
								const hasEvents = monthEvents.some((ev) => isSameDay(ev.date, day));
								return (
									<div
										key={day.toISOString()}
										className="text-[9px] text-center py-0.5 relative"
										style={{
											color: !inMonth ? "transparent" : today ? "var(--color-accent)" : "var(--color-text)",
											fontWeight: today ? 700 : 400,
										}}
									>
										{format(day, "d")}
										{hasEvents && inMonth && (
											<div
												className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
												style={{ backgroundColor: "var(--color-accent)" }}
											/>
										)}
									</div>
								);
							})}
						</div>
						{monthEvents.length > 0 && (
							<div className="mt-1 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
								{monthEvents.length} event{monthEvents.length !== 1 ? "s" : ""}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function CalendarEmptyState({ reason }: { reason: "no-date-field" | "no-events" }) {
	return (
		<div className="flex flex-col items-center justify-center py-16 gap-2">
			<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>
				<rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
			</svg>
			<span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
				{reason === "no-date-field"
					? "No date field configured for calendar view. Open view settings to select one."
					: "No events to display in this range."}
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ObjectCalendar({
	objectName: _objectName,
	fields,
	entries,
	dateField,
	endDateField,
	mode,
	onModeChange,
	members: _members,
	onEntryClick,
	onEntryDateChange,
}: ObjectCalendarProps) {
	const [currentDate, setCurrentDate] = useState(() => new Date());

	const events = useMemo(
		() => parseEvents(entries, fields, dateField, endDateField),
		[entries, fields, dateField, endDateField],
	);

	const handlePrev = useCallback(() => setCurrentDate((d) => navigateDate(d, mode, -1)), [mode]);
	const handleNext = useCallback(() => setCurrentDate((d) => navigateDate(d, mode, 1)), [mode]);
	const handleToday = useCallback(() => setCurrentDate(new Date()), []);

	if (!dateField) {return <CalendarEmptyState reason="no-date-field" />;}

	const modes: CalendarMode[] = ["day", "week", "month", "year"];

	return (
		<div className="w-full">
			<div className="flex items-center justify-between mb-3 px-1">
				<div className="flex items-center gap-2">
					<button type="button" onClick={handlePrev} className="p-1.5 rounded-md hover:bg-[var(--color-surface-hover)] transition-colors" style={{ color: "var(--color-text)" }}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
					</button>
					<button type="button" onClick={handleNext} className="p-1.5 rounded-md hover:bg-[var(--color-surface-hover)] transition-colors" style={{ color: "var(--color-text)" }}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
					</button>
					<button type="button" onClick={handleToday} className="text-[12px] px-2.5 py-1 rounded-md border hover:bg-[var(--color-surface-hover)] transition-colors" style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}>
						Today
					</button>
					<h3 className="text-sm font-semibold ml-2" style={{ color: "var(--color-text)" }}>
						{formatDateHeader(currentDate, mode)}
					</h3>
				</div>
				<div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
					{modes.map((m) => (
						<button
							key={m}
							type="button"
							onClick={() => onModeChange(m)}
							className="text-[11px] px-3 py-1 capitalize transition-colors"
							style={{
								background: m === mode ? "var(--color-accent)" : "var(--color-surface)",
								color: m === mode ? "#fff" : "var(--color-text-muted)",
								borderRight: m !== "year" ? "1px solid var(--color-border)" : undefined,
							}}
						>
							{m}
						</button>
					))}
				</div>
			</div>

			<div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
				{mode === "month" && <MonthView date={currentDate} events={events} onEntryClick={onEntryClick} onEntryDateChange={onEntryDateChange} />}
				{mode === "week" && <WeekView date={currentDate} events={events} onEntryClick={onEntryClick} onEntryDateChange={onEntryDateChange} />}
				{mode === "day" && <DayView date={currentDate} events={events} onEntryClick={onEntryClick} onEntryDateChange={onEntryDateChange} />}
				{mode === "year" && <YearView date={currentDate} events={events} />}
			</div>
		</div>
	);
}
