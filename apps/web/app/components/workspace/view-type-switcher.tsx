"use client";

import type { ReactElement } from "react";
import { type ViewType, VIEW_TYPES } from "@/lib/object-filters";

// ---------------------------------------------------------------------------
// Icons for each view type
// ---------------------------------------------------------------------------

function TableIcon() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M12 3v18" /><path d="M3 12h18" /><rect width="18" height="18" x="3" y="3" rx="2" />
		</svg>
	);
}

function KanbanIcon() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<rect width="6" height="14" x="3" y="5" rx="1" /><rect width="6" height="10" x="9" y="9" rx="1" /><rect width="6" height="16" x="15" y="3" rx="1" />
		</svg>
	);
}

function CalendarIcon() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
		</svg>
	);
}

function TimelineIcon() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M3 6h7" /><path d="M6 12h10" /><path d="M5 18h5" /><path d="M14 6h7" /><path d="M18 12h3" /><path d="M12 18h9" />
		</svg>
	);
}

function GalleryIcon() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" />
			<rect width="7" height="7" x="3" y="14" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" />
		</svg>
	);
}

function ListIcon() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />
		</svg>
	);
}

const VIEW_TYPE_META: Record<ViewType, { icon: () => ReactElement; label: string }> = {
	table: { icon: TableIcon, label: "Table" },
	kanban: { icon: KanbanIcon, label: "Board" },
	calendar: { icon: CalendarIcon, label: "Calendar" },
	timeline: { icon: TimelineIcon, label: "Timeline" },
	gallery: { icon: GalleryIcon, label: "Gallery" },
	list: { icon: ListIcon, label: "List" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ViewTypeSwitcherProps = {
	value: ViewType;
	onChange: (type: ViewType) => void;
};

export function ViewTypeSwitcher({ value, onChange }: ViewTypeSwitcherProps) {
	return (
		<div className="flex items-center gap-1">
			{VIEW_TYPES.map((vt) => {
				const meta = VIEW_TYPE_META[vt];
				const Icon = meta.icon;
				const isActive = vt === value;
				return (
					<button
						key={vt}
						type="button"
						onClick={() => onChange(vt)}
						className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md transition-colors cursor-pointer"
						style={{
							background: isActive ? "var(--color-surface-hover)" : "transparent",
							color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
							fontWeight: isActive ? 500 : 400,
						}}
						title={meta.label}
					>
						<Icon />
						<span className="hidden sm:inline">{meta.label}</span>
					</button>
				);
			})}
		</div>
	);
}
