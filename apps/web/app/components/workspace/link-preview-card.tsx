"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { LinkPreviewData } from "@/app/api/workspace/link-preview/route";

/* ─── Client-side preview cache ─── */

const previewCache = new Map<string, LinkPreviewData | "loading" | "error">();
const subscribers = new Map<string, Set<() => void>>();

function subscribe(url: string, cb: () => void) {
	let subs = subscribers.get(url);
	if (!subs) {
		subs = new Set();
		subscribers.set(url, subs);
	}
	subs.add(cb);
	return () => {
		subs!.delete(cb);
		if (subs!.size === 0) {subscribers.delete(url);}
	};
}

function notify(url: string) {
	const subs = subscribers.get(url);
	if (subs) {for (const cb of subs) {cb();}}
}

async function fetchPreview(url: string) {
	if (previewCache.has(url)) {return;}
	previewCache.set(url, "loading");
	notify(url);
	try {
		const res = await fetch(
			`/api/workspace/link-preview?url=${encodeURIComponent(url)}`,
		);
		if (!res.ok) {throw new Error("fetch failed");}
		const data: LinkPreviewData = await res.json();
		previewCache.set(url, data);
	} catch {
		previewCache.set(url, "error");
	}
	notify(url);
}

export function useLinkPreview(url: string | undefined) {
	const [, rerender] = useState(0);

	useEffect(() => {
		if (!url) {return;}
		return subscribe(url, () => rerender((n) => n + 1));
	}, [url]);

	if (!url) {return { state: "idle" as const, data: undefined };}
	const cached = previewCache.get(url);
	if (!cached) {return { state: "idle" as const, data: undefined };}
	if (cached === "loading") {return { state: "loading" as const, data: undefined };}
	if (cached === "error") {return { state: "error" as const, data: undefined };}
	return { state: "ready" as const, data: cached };
}

/* ─── Hover trigger logic ─── */

const HOVER_DELAY_MS = 200;
const LEAVE_DELAY_MS = 200;

export function useLinkHover(url: string | undefined) {
	const [open, setOpen] = useState(false);
	const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const triggerRef = useRef<HTMLElement | null>(null);

	const clearTimers = useCallback(() => {
		if (enterTimerRef.current) {clearTimeout(enterTimerRef.current); enterTimerRef.current = null;}
		if (leaveTimerRef.current) {clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null;}
	}, []);

	const handleTriggerEnter = useCallback(() => {
		if (!url) {return;}
		if (leaveTimerRef.current) {clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null;}
		enterTimerRef.current = setTimeout(() => {
			void fetchPreview(url);
			setOpen(true);
		}, HOVER_DELAY_MS);
	}, [url]);

	const handleTriggerLeave = useCallback(() => {
		if (enterTimerRef.current) {clearTimeout(enterTimerRef.current); enterTimerRef.current = null;}
		leaveTimerRef.current = setTimeout(() => setOpen(false), LEAVE_DELAY_MS);
	}, []);

	const handleCardEnter = useCallback(() => {
		if (leaveTimerRef.current) {clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null;}
	}, []);

	const handleCardLeave = useCallback(() => {
		leaveTimerRef.current = setTimeout(() => setOpen(false), LEAVE_DELAY_MS);
	}, []);

	useEffect(() => clearTimers, [clearTimers]);

	return {
		open,
		triggerRef,
		triggerProps: {
			ref: triggerRef,
			onMouseEnter: handleTriggerEnter,
			onMouseLeave: handleTriggerLeave,
			onFocus: handleTriggerEnter,
			onBlur: handleTriggerLeave,
		},
		cardProps: {
			onMouseEnter: handleCardEnter,
			onMouseLeave: handleCardLeave,
		},
	};
}

/* ─── Preview card (portalled, fixed-positioned) ─── */

function PreviewCardContent({
	data,
	loading,
}: {
	data: LinkPreviewData | undefined;
	loading: boolean;
}) {
	if (loading || !data) {
		return (
			<div className="flex items-center gap-2 px-3 py-3">
				<div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-border)", borderTopColor: "transparent" }} />
				<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Loading preview...</span>
			</div>
		);
	}

	const hasImage = !!data.imageUrl;
	const hasContent = data.title || data.description;

	if (!hasContent && !hasImage) {
		return (
			<div className="flex items-center gap-2 px-3 py-2.5">
				{data.faviconUrl && (
					// eslint-disable-next-line @next/next/no-img-element
					<img src={data.faviconUrl} alt="" className="w-4 h-4 rounded-[3px] shrink-0" />
				)}
				<span className="text-xs font-medium truncate" style={{ color: "var(--color-text)" }}>{data.domain}</span>
			</div>
		);
	}

	return (
		<>
			{hasImage && (
				<div className="w-full h-[140px] overflow-hidden bg-black/5 dark:bg-white/5">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img
						src={data.imageUrl}
						alt=""
						className="w-full h-full object-cover"
						onError={(e) => {(e.currentTarget.parentElement as HTMLElement).style.display = "none";}}
					/>
				</div>
			)}
			<div className="px-3 py-2.5 space-y-1">
				<div className="flex items-center gap-1.5">
					{data.faviconUrl && (
						// eslint-disable-next-line @next/next/no-img-element
						<img
							src={data.faviconUrl}
							alt=""
							className="w-3.5 h-3.5 rounded-[3px] shrink-0"
							onError={(e) => {(e.currentTarget as HTMLElement).style.display = "none";}}
						/>
					)}
					<span className="text-[10px] font-medium truncate" style={{ color: "var(--color-text-muted)" }}>
						{data.siteName || data.domain}
					</span>
				</div>
				{data.title && (
					<p className="text-xs font-semibold leading-snug line-clamp-2" style={{ color: "var(--color-text)" }}>
						{data.title}
					</p>
				)}
				{data.description && (
					<p className="text-[11px] leading-relaxed line-clamp-3" style={{ color: "var(--color-text-muted)" }}>
						{data.description}
					</p>
				)}
			</div>
		</>
	);
}

export function LinkPreviewPortal({
	open,
	triggerRef,
	data,
	loading,
	cardProps,
}: {
	open: boolean;
	triggerRef: React.RefObject<HTMLElement | null>;
	data: LinkPreviewData | undefined;
	loading: boolean;
	cardProps: { onMouseEnter: () => void; onMouseLeave: () => void };
}) {
	const cardRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ top: number; left: number; placement: "above" | "below" } | null>(null);

	useEffect(() => {
		if (!open || !triggerRef.current) {setPos(null); return;}
		const rect = triggerRef.current.getBoundingClientRect();
		const cardWidth = 320;
		const cardHeight = 240;
		const margin = 8;

		const spaceBelow = window.innerHeight - rect.bottom;
		const placement = spaceBelow > cardHeight + margin ? "below" : "above";

		let top = placement === "below"
			? rect.bottom + margin
			: rect.top - cardHeight - margin;
		let left = rect.left + rect.width / 2 - cardWidth / 2;

		left = Math.max(margin, Math.min(left, window.innerWidth - cardWidth - margin));
		top = Math.max(margin, top);

		setPos({ top, left, placement });
	}, [open, triggerRef, data]);

	if (!open || !pos) {return null;}

	return createPortal(
		<div
			ref={cardRef}
			role="tooltip"
			{...cardProps}
			className="fixed z-[99999] w-[320px] rounded-xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150"
			style={{
				top: pos.top,
				left: pos.left,
				background: "var(--color-surface)",
				border: "1px solid var(--color-border)",
				boxShadow: "0 8px 30px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08)",
				transformOrigin: pos.placement === "below" ? "top center" : "bottom center",
			}}
		>
			<PreviewCardContent data={data} loading={loading} />
		</div>,
		document.body,
	);
}
