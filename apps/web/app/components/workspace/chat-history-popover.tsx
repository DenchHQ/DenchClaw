"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UnicodeSpinner } from "../unicode-spinner";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "../ui/context-menu";
import type {
	SidebarGatewaySession,
	SidebarSubagentInfo,
	WebSession,
} from "./chat-sessions-sidebar";

// ── Helpers (mirror chat-sessions-sidebar so the popover stands on its own) ──

function timeAgo(ts: number): string {
	const now = Date.now();
	const diff = now - ts;
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
}

// ── Tiny inline icons ──

function ClockIcon({ size = 16 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="10" />
			<polyline points="12 6 12 12 16 14" />
		</svg>
	);
}

function PlusIcon({ size = 16 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M5 12h14" /><path d="M12 5v14" />
		</svg>
	);
}

function MoreHorizontalIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
		</svg>
	);
}

function StopIcon() {
	return (
		<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<rect x="6" y="6" width="12" height="12" rx="2" />
		</svg>
	);
}

function SubagentIcon() {
	return (
		<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M16 3h5v5" /><path d="m21 3-7 7" /><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
		</svg>
	);
}

// Channel marks — keep in sync with chat-sessions-sidebar's CHANNEL_META.
const CHANNEL_COLORS: Record<string, string> = {
	telegram: "#2AABEE",
	whatsapp: "#25D366",
	discord: "#5865F2",
	slack: "#4A154B",
	signal: "#3A76F0",
	imessage: "#34C759",
	googlechat: "#00AC47",
	nostr: "#8B5CF6",
};

function ChannelDot({ channel }: { channel: string }) {
	const color = CHANNEL_COLORS[channel];
	if (!color) return null;
	return (
		<span
			aria-hidden
			className="inline-block shrink-0 rounded-full"
			style={{ background: color, width: 8, height: 8 }}
		/>
	);
}

// ── Row grouping (mirrors chat-sessions-sidebar) ──

type UnifiedRow =
	| { kind: "native"; ts: number; session: WebSession }
	| { kind: "gateway"; ts: number; gs: SidebarGatewaySession };

type RowGroup = {
	label: string;
	rows: UnifiedRow[];
};

function groupRows(rows: UnifiedRow[]): RowGroup[] {
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const yesterdayStart = todayStart - 86400000;
	const weekStart = todayStart - 7 * 86400000;
	const monthStart = todayStart - 30 * 86400000;

	const today: UnifiedRow[] = [];
	const yesterday: UnifiedRow[] = [];
	const thisWeek: UnifiedRow[] = [];
	const thisMonth: UnifiedRow[] = [];
	const older: UnifiedRow[] = [];

	for (const r of rows) {
		const t = r.ts;
		if (t >= todayStart) today.push(r);
		else if (t >= yesterdayStart) yesterday.push(r);
		else if (t >= weekStart) thisWeek.push(r);
		else if (t >= monthStart) thisMonth.push(r);
		else older.push(r);
	}

	const groups: RowGroup[] = [];
	if (today.length > 0) groups.push({ label: "today", rows: today });
	if (yesterday.length > 0) groups.push({ label: "yesterday", rows: yesterday });
	if (thisWeek.length > 0) groups.push({ label: "this week", rows: thisWeek });
	if (thisMonth.length > 0) groups.push({ label: "this month", rows: thisMonth });
	if (older.length > 0) groups.push({ label: "older", rows: older });
	return groups;
}

// ── Native session row (with double-click to rename) ──

function NativeRow({
	session,
	isActive,
	isStreaming,
	isHovered,
	sessionSubagents,
	activeSubagentKey,
	renamingId,
	renameValue,
	onHover,
	onLeave,
	onSelect,
	onStartRename,
	onCommitRename,
	onCancelRename,
	onRenameChange,
	onDelete,
	onStop,
	onSelectSubagent,
	onStopSubagent,
}: {
	session: WebSession;
	isActive: boolean;
	isStreaming: boolean;
	isHovered: boolean;
	sessionSubagents?: SidebarSubagentInfo[];
	activeSubagentKey?: string | null;
	renamingId: string | null;
	renameValue: string;
	onHover: (id: string) => void;
	onLeave: () => void;
	onSelect: (id: string) => void;
	onStartRename?: (id: string, currentTitle: string) => void;
	onCommitRename?: () => void;
	onCancelRename?: () => void;
	onRenameChange?: (next: string) => void;
	onDelete?: (id: string) => void;
	onStop?: (id: string) => void;
	onSelectSubagent?: (key: string) => void;
	onStopSubagent?: (key: string) => void;
}) {
	const [ctxOpen, setCtxOpen] = useState(false);
	const showActions = isHovered || ctxOpen || isStreaming;
	const highlighted = isHovered || ctxOpen;
	const renaming = renamingId === session.id;

	const rowContent = (
		<div
			className="group relative"
			onMouseEnter={() => onHover(session.id)}
			onMouseLeave={() => { if (!ctxOpen) onLeave(); }}
		>
			<div
				className="flex items-stretch w-full rounded-lg"
				style={{
					background: isActive
						? "var(--color-chat-sidebar-active-bg)"
						: highlighted
							? "var(--color-surface-hover)"
							: "transparent",
				}}
			>
				{renaming ? (
					<form
						className="flex-1 min-w-0 px-2 py-1.5"
						onSubmit={(e) => { e.preventDefault(); onCommitRename?.(); }}
					>
						<input
							type="text"
							value={renameValue}
							onChange={(e) => onRenameChange?.(e.target.value)}
							onBlur={onCommitRename}
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									e.preventDefault();
									e.stopPropagation();
									onCancelRename?.();
								}
							}}
							autoFocus
							className="w-full text-xs font-medium px-1 py-0.5 rounded outline-none border"
							style={{
								color: "var(--color-text)",
								background: "var(--color-surface)",
								borderColor: "var(--color-border)",
							}}
						/>
					</form>
				) : (
					<button
						type="button"
						onClick={() => onSelect(session.id)}
						onDoubleClick={(e) => {
							if (!onStartRename) return;
							e.preventDefault();
							e.stopPropagation();
							onStartRename(session.id, session.title);
						}}
						className="flex-1 min-w-0 text-left px-2 py-1.5 rounded-l-lg cursor-pointer"
						title={session.title || "Untitled chat"}
					>
						<div className="flex items-center gap-1.5">
							{isStreaming && (
								<UnicodeSpinner
									name="braille"
									className="text-[10px] flex-shrink-0"
									style={{ color: "var(--color-chat-sidebar-muted)" }}
								/>
							)}
							<div
								className="text-xs font-medium truncate"
								style={{
									color: isActive
										? "var(--color-chat-sidebar-active-text)"
										: "var(--color-text)",
								}}
							>
								{session.title || "Untitled chat"}
							</div>
						</div>
						<div
							className="mt-0.5 text-[10px]"
							style={{
								color: "var(--color-text-muted)",
								paddingLeft: isStreaming ? "calc(0.375rem + 6px)" : undefined,
							}}
						>
							{timeAgo(session.updatedAt)}
						</div>
					</button>
				)}

				{!renaming && (
					<div
						className={`shrink-0 flex items-center pr-1 gap-0.5 transition-opacity ${showActions ? "opacity-100" : "opacity-0"}`}
					>
						{isStreaming && onStop && (
							<button
								type="button"
								onClick={(e) => { e.stopPropagation(); onStop(session.id); }}
								className="flex items-center justify-center w-6 h-6 rounded-md transition-colors hover:bg-black/5"
								style={{ color: "var(--color-text-muted)" }}
								title="Stop chat"
								aria-label="Stop chat"
							>
								<StopIcon />
							</button>
						)}
						{(onStartRename || onDelete) && (
							<DropdownMenu>
								<DropdownMenuTrigger
									onClick={(e) => e.stopPropagation()}
									className="flex items-center justify-center w-6 h-6 rounded-md"
									style={{ color: "var(--color-text-muted)" }}
									title="More options"
									aria-label="More options"
								>
									<MoreHorizontalIcon />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" side="bottom">
									{onStartRename && (
										<DropdownMenuItem
											onSelect={() => onStartRename(session.id, session.title)}
										>
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></svg>
											Rename
										</DropdownMenuItem>
									)}
									{onDelete && (
										<DropdownMenuItem
											variant="destructive"
											onSelect={() => onDelete(session.id)}
										>
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
											Delete
										</DropdownMenuItem>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</div>
				)}
			</div>

			{sessionSubagents && sessionSubagents.length > 0 && (
				<div className="ml-4 border-l" style={{ borderColor: "var(--color-border)" }}>
					{sessionSubagents.map((sa) => {
						const isSubActive = activeSubagentKey === sa.childSessionKey;
						const isSubRunning = sa.status === "running";
						const subLabel = sa.label || sa.task;
						const truncated = subLabel.length > 40 ? subLabel.slice(0, 40) + "..." : subLabel;
						return (
							<div key={sa.childSessionKey} className="flex items-center">
								<button
									type="button"
									onClick={() => onSelectSubagent?.(sa.childSessionKey)}
									className="flex-1 text-left pl-3 pr-2 py-1.5 rounded-r-lg cursor-pointer"
									style={{
										background: isSubActive
											? "var(--color-chat-sidebar-active-bg)"
											: "transparent",
									}}
								>
									<div className="flex items-center gap-1.5">
										{isSubRunning && (
											<UnicodeSpinner
												name="braille"
												className="text-[9px] flex-shrink-0"
												style={{ color: "var(--color-chat-sidebar-muted)" }}
											/>
										)}
										<SubagentIcon />
										<span
											className="text-[11px] truncate"
											style={{
												color: isSubActive
													? "var(--color-chat-sidebar-active-text)"
													: "var(--color-text-muted)",
											}}
										>
											{truncated}
										</span>
									</div>
								</button>
								{isSubRunning && onStopSubagent && (
									<button
										type="button"
										onClick={(e) => { e.stopPropagation(); onStopSubagent(sa.childSessionKey); }}
										className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md mr-1 transition-colors hover:bg-black/5"
										style={{ color: "var(--color-text-muted)" }}
										title="Stop subagent"
										aria-label="Stop subagent"
									>
										<StopIcon />
									</button>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);

	if (!onStartRename && !onDelete) return rowContent;

	return (
		<ContextMenu onOpenChange={(open) => { setCtxOpen(open); if (!open) onLeave(); }}>
			<ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
			<ContextMenuContent className="min-w-[160px]">
				{onStartRename && (
					<ContextMenuItem onSelect={() => onStartRename(session.id, session.title)}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></svg>
						Rename
					</ContextMenuItem>
				)}
				{onDelete && (
					<ContextMenuItem variant="destructive" onSelect={() => onDelete(session.id)}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
						Delete
					</ContextMenuItem>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
}

// ── Gateway (channel) row ──

function GatewayRow({
	gs,
	isActive,
	isHovered,
	onHover,
	onLeave,
	onSelect,
}: {
	gs: SidebarGatewaySession;
	isActive: boolean;
	isHovered: boolean;
	onHover: (key: string) => void;
	onLeave: () => void;
	onSelect: (key: string, id: string) => void;
}) {
	return (
		<div onMouseEnter={() => onHover(gs.sessionKey)} onMouseLeave={onLeave}>
			<button
				type="button"
				onClick={() => onSelect(gs.sessionKey, gs.sessionId)}
				className="w-full text-left px-2 py-1.5 rounded-lg cursor-pointer"
				style={{
					background: isActive
						? "var(--color-chat-sidebar-active-bg)"
						: isHovered
							? "var(--color-surface-hover)"
							: "transparent",
				}}
				title={gs.title}
			>
				<div className="flex items-center gap-1.5">
					<ChannelDot channel={gs.channel} />
					<div
						className="text-xs font-medium truncate"
						style={{
							color: isActive
								? "var(--color-chat-sidebar-active-text)"
								: "var(--color-text)",
						}}
					>
						{gs.title}
					</div>
				</div>
				<div
					className="mt-0.5 text-[10px]"
					style={{ color: "var(--color-text-muted)", paddingLeft: "calc(8px + 0.375rem)" }}
				>
					{timeAgo(gs.updatedAt)}
				</div>
			</button>
		</div>
	);
}

// ── Main popover component ──

export type ChatHistoryPopoverProps = {
	sessions: WebSession[];
	activeSessionId: string | null;
	streamingSessionIds?: Set<string>;
	subagents?: SidebarSubagentInfo[];
	activeSubagentKey?: string | null;
	loading?: boolean;
	gatewaySessions?: SidebarGatewaySession[];
	activeGatewaySessionKey?: string | null;
	onSelectSession: (sessionId: string) => void;
	onNewSession: () => void;
	onSelectSubagent?: (sessionKey: string) => void;
	onSelectGatewaySession?: (sessionKey: string, sessionId: string) => void;
	onDeleteSession?: (sessionId: string) => void;
	onRenameSession?: (sessionId: string, newTitle: string) => void;
	onStopSession?: (sessionId: string) => void;
	onStopSubagent?: (sessionKey: string) => void;
	/** Compact mode shrinks paddings/icons. */
	compact?: boolean;
};

export function ChatHistoryPopover({
	sessions,
	activeSessionId,
	streamingSessionIds,
	subagents,
	activeSubagentKey,
	loading = false,
	gatewaySessions,
	activeGatewaySessionKey,
	onSelectSession,
	onNewSession,
	onSelectSubagent,
	onSelectGatewaySession,
	onDeleteSession,
	onRenameSession,
	onStopSession,
	onStopSubagent,
	compact = false,
}: ChatHistoryPopoverProps) {
	const [open, setOpen] = useState(false);
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);

	// Close on outside click.
	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (!containerRef.current) return;
			const target = e.target as Node;
			if (containerRef.current.contains(target)) return;
			// Allow clicks inside portaled menus (dropdown / context menu) without closing.
			const inPortal = (target as HTMLElement | null)?.closest?.(
				"[data-slot='dropdown-menu-content'], [data-slot='context-menu-content']",
			);
			if (inPortal) return;
			setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	// Close on Escape (only when no inline rename is active).
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !renamingId) {
				setOpen(false);
			}
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [open, renamingId]);

	// Reset transient row state whenever the popover is closed.
	useEffect(() => {
		if (!open) {
			setHoveredId(null);
			setRenamingId(null);
			setRenameValue("");
		}
	}, [open]);

	const handleSelect = useCallback(
		(id: string) => {
			onSelectSession(id);
			setOpen(false);
		},
		[onSelectSession],
	);

	const handleSelectSubagentItem = useCallback(
		(sessionKey: string) => {
			onSelectSubagent?.(sessionKey);
			setOpen(false);
		},
		[onSelectSubagent],
	);

	const handleSelectGateway = useCallback(
		(sessionKey: string, sessionId: string) => {
			onSelectGatewaySession?.(sessionKey, sessionId);
			setOpen(false);
		},
		[onSelectGatewaySession],
	);

	const handleStartRename = useCallback((sessionId: string, currentTitle: string) => {
		setRenamingId(sessionId);
		setRenameValue(currentTitle || "");
	}, []);

	const handleCommitRename = useCallback(() => {
		if (renamingId && renameValue.trim()) {
			onRenameSession?.(renamingId, renameValue.trim());
		}
		setRenamingId(null);
		setRenameValue("");
	}, [renamingId, renameValue, onRenameSession]);

	const handleCancelRename = useCallback(() => {
		setRenamingId(null);
		setRenameValue("");
	}, []);

	const handleNewChat = useCallback(() => {
		onNewSession();
		setOpen(false);
	}, [onNewSession]);

	const subagentsByParent = useMemo(() => {
		const map = new Map<string, SidebarSubagentInfo[]>();
		if (!subagents) return map;
		for (const sa of subagents) {
			let list = map.get(sa.parentSessionId);
			if (!list) { list = []; map.set(sa.parentSessionId, list); }
			list.push(sa);
		}
		return map;
	}, [subagents]);

	const groups = useMemo(() => {
		const rows: UnifiedRow[] = [];
		for (const s of sessions) {
			// Hide subagent (child) sessions — they render nested under their parent.
			// Keep file-scoped sessions (those with `filePath`) in the unified history;
			// in v3 they're regular top-level chats.
			if (s.id.includes(":subagent:")) continue;
			rows.push({ kind: "native", ts: s.updatedAt, session: s });
		}
		if (gatewaySessions) {
			for (const gs of gatewaySessions) {
				if (gs.channel === "cron" || gs.channel === "unknown") continue;
				rows.push({ kind: "gateway", ts: gs.updatedAt, gs });
			}
		}
		rows.sort((a, b) => b.ts - a.ts);
		return groupRows(rows);
	}, [sessions, gatewaySessions]);

	const totalRows = groups.reduce((acc, g) => acc + g.rows.length, 0);

	const triggerSize = compact ? 28 : 30;
	const popoverWidth = compact ? 300 : 340;

	return (
		<div ref={containerRef} className="relative flex items-center gap-0.5">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="rounded-lg flex items-center justify-center transition-colors cursor-pointer"
				style={{
					color: "var(--color-text-muted)",
					background: open ? "var(--color-surface-hover)" : "transparent",
					width: triggerSize,
					height: triggerSize,
				}}
				onMouseEnter={(e) => {
					(e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
				}}
				onMouseLeave={(e) => {
					if (open) return;
					(e.currentTarget as HTMLElement).style.background = "transparent";
				}}
				title="Chat history"
				aria-label="Chat history"
				aria-expanded={open}
			>
				<ClockIcon size={compact ? 14 : 15} />
			</button>
			<button
				type="button"
				onClick={handleNewChat}
				className="rounded-lg flex items-center justify-center transition-colors cursor-pointer"
				style={{
					color: "var(--color-text-muted)",
					width: triggerSize,
					height: triggerSize,
				}}
				onMouseEnter={(e) => {
					(e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
				}}
				onMouseLeave={(e) => {
					(e.currentTarget as HTMLElement).style.background = "transparent";
				}}
				title="New chat"
				aria-label="New chat"
			>
				<PlusIcon size={compact ? 14 : 15} />
			</button>

			{open && (
				<div
					className="absolute right-0 top-full mt-1 z-50 rounded-2xl border shadow-[0_10px_30px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden backdrop-blur-md"
					style={{
						width: popoverWidth,
						maxWidth: "calc(100vw - 1.5rem)",
						background: "color-mix(in srgb, var(--color-surface) 92%, transparent)",
						borderColor: "var(--color-border)",
					}}
				>
					<div
						className="flex items-center justify-between px-3 h-9 shrink-0 border-b"
						style={{ borderColor: "var(--color-border)" }}
					>
						<div className="text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>
							Chats
						</div>
						<button
							type="button"
							onClick={handleNewChat}
							className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer"
							style={{ color: "var(--color-text-muted)" }}
							onMouseEnter={(e) => {
								(e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
								(e.currentTarget as HTMLElement).style.color = "var(--color-text)";
							}}
							onMouseLeave={(e) => {
								(e.currentTarget as HTMLElement).style.background = "transparent";
								(e.currentTarget as HTMLElement).style.color = "var(--color-text-muted)";
							}}
							title="New chat"
						>
							<PlusIcon size={12} />
							New
						</button>
					</div>

					<div className="overflow-y-auto" style={{ maxHeight: "min(60vh, 480px)" }}>
						{loading && totalRows === 0 ? (
							<div className="px-4 py-8 flex flex-col items-center justify-center min-h-[120px]">
								<UnicodeSpinner name="braille" className="text-xl mb-2" style={{ color: "var(--color-text-muted)" }} />
								<p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Loading…</p>
							</div>
						) : totalRows === 0 ? (
							<div className="px-4 py-8 text-center">
								<p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
									No conversations yet.
								</p>
							</div>
						) : (
							<div className="px-2 py-1">
								{groups.map((group) => (
									<div key={group.label}>
										<div
											className="px-2 pt-3 pb-1 text-[9px] lowercase"
											style={{ color: "var(--color-text-muted)", letterSpacing: "0.05em" }}
										>
											{group.label}
										</div>
										{group.rows.map((row) => {
											if (row.kind === "native") {
												const session = row.session;
												return (
													<NativeRow
														key={`n-${session.id}`}
														session={session}
														isActive={
															session.id === activeSessionId &&
															!activeSubagentKey &&
															!activeGatewaySessionKey
														}
														isStreaming={streamingSessionIds?.has(session.id) ?? false}
														isHovered={session.id === hoveredId}
														sessionSubagents={subagentsByParent.get(session.id)}
														activeSubagentKey={activeSubagentKey}
														renamingId={renamingId}
														renameValue={renameValue}
														onHover={setHoveredId}
														onLeave={() => setHoveredId(null)}
														onSelect={handleSelect}
														onStartRename={onRenameSession ? handleStartRename : undefined}
														onCommitRename={handleCommitRename}
														onCancelRename={handleCancelRename}
														onRenameChange={setRenameValue}
														onDelete={onDeleteSession}
														onStop={onStopSession}
														onSelectSubagent={handleSelectSubagentItem}
														onStopSubagent={onStopSubagent}
													/>
												);
											}
											const gs = row.gs;
											return (
												<GatewayRow
													key={`g-${gs.sessionKey}`}
													gs={gs}
													isActive={activeGatewaySessionKey === gs.sessionKey}
													isHovered={hoveredId === gs.sessionKey}
													onHover={setHoveredId}
													onLeave={() => setHoveredId(null)}
													onSelect={handleSelectGateway}
												/>
											);
										})}
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
