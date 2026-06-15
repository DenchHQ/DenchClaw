"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
	Combobox,
	ComboboxInput,
	ComboboxContent,
	ComboboxList,
	ComboboxItem,
} from "../ui/combobox";
import {
	IconFolderFilled,
	IconFileFilled,
	IconDatabaseFilled,
} from "@tabler/icons-react";
import { GoTools } from "react-icons/go";
import { RiApps2AiLine } from "react-icons/ri";
import { useTheme } from "next-themes";
import { type TreeNode } from "./file-manager-tree";
import { ProfileSwitcher } from "./profile-switcher";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";
import type { SearchIndexItem } from "@/lib/search-index";
import { displayObjectName } from "@/lib/object-display-name";
import { CrmObjectIcon } from "./crm-object-icon";

/** Descriptor for a custom CRM table rendered in the sidebar's CRM section. */
export type CustomCrmObject = {
	name: string;
	icon?: string;
	defaultView?: "table" | "kanban";
};

/** Shape returned by /api/workspace/suggest-files */
export type SuggestItem = {
	name: string;
	path: string;
	type: "folder" | "file" | "document" | "database";
};

function indexItemToSuggestItem(item: SearchIndexItem): SuggestItem {
	const fullPath = item.path ?? item.id;
	const fileName = fullPath.split("/").pop() ?? item.label;
	return {
		name: item.kind === "object" ? displayObjectName(item.label) : fileName,
		path: fullPath,
		type: (item.nodeType ?? (item.kind === "object" ? "folder" : "file")) as SuggestItem["type"],
	};
}

type WorkspaceSidebarProps = {
	// NOTE: v3 three-column refactor — file tree lives in the right panel now.
	// `tree`, `activePath`, `onSelect`, etc. are accepted for API compatibility but unused here.
	tree?: TreeNode[];
	activePath?: string | null;
	onSelect?: (node: TreeNode) => void;
	onRefresh?: () => void;
	orgName?: string;
	loading?: boolean;
	browseDir?: string | null;
	parentDir?: string | null;
	onNavigateUp?: () => void;
	onGoHome?: () => void;
	onFileSearchSelect?: (item: SuggestItem) => void;
	workspaceRoot?: string | null;
	onGoToChat?: () => void;
	onExternalDrop?: (node: TreeNode) => void;
	/** When true, renders as a mobile overlay drawer instead of a static sidebar. */
	mobile?: boolean;
	/** Close the mobile drawer. */
	onClose?: () => void;
	/** Fixed width in px when not mobile (overrides default 260). */
	width?: number;
	showHidden?: boolean;
	onToggleHidden?: () => void;
	/** Called when the user clicks the collapse/hide sidebar button. */
	onCollapse?: () => void;
	/** When true, render an icon-only minimal layout (collapsed-but-visible). */
	compact?: boolean;
	/** Toggle between compact (icon-only) and full mode. */
	onToggleCompact?: () => void;
  /** Active workspace hint used by the switcher. */
  activeWorkspace?: string | null;
  /** Called after workspace switches or workspace creation so parent can refresh state. */
  onWorkspaceChanged?: () => void;
  /** Navigate to a sidebar section (cloud, integrations, skills, cron). */
  onNavigate?: (
    target:
      | "cloud"
      | "integrations"
      | "skills"
      | "cron"
      | "crm-people"
      | "crm-companies"
      | "crm-inbox"
      | "crm-calendar",
  ) => void;
  /** Currently-active CRM nav item, used to highlight the row. */
  activeCrmTarget?: "people" | "companies" | "inbox" | "calendar" | null;
  /** Custom CRM tables (workspace.duckdb objects) to list under the default CRM nav. */
  customCrmObjects?: CustomCrmObject[];
  /** Currently-active custom CRM object name, used to highlight the row. */
  activeCrmObjectName?: string | null;
  /** Click handler invoked with the custom CRM object's name. */
  onNavigateToCrmObject?: (objectName: string) => void;
  /** Client-side search function from useSearchIndex for instant results. */
  searchFn?: (query: string, limit?: number) => SearchIndexItem[];
  /** Rendered inside the "Chats" tab at the top of the sidebar. Host provides
   *  an already-configured <ChatSessionsSidebar embedded /> (or equivalent). */
  chatsPanel?: React.ReactNode;
  /** Invoked when the user hits the "+" next to the Chats tab. */
  onNewChatSession?: () => void;
};

function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	if (!mounted) return <div className="w-[26px] h-[26px]" />;
	const isDark = resolvedTheme === "dark";
	return (
		<button
			type="button"
			onClick={() => setTheme(isDark ? "light" : "dark")}
			className="p-1.5 rounded-lg transition-colors"
			style={{ color: "var(--color-text-muted)" }}
			onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
			onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
			title={isDark ? "Switch to light mode" : "Switch to dark mode"}
		>
			{isDark ? (
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<circle cx="12" cy="12" r="4" />
					<path d="M12 2v2" /><path d="M12 20v2" />
					<path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
					<path d="M2 12h2" /><path d="M20 12h2" />
					<path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
				</svg>
			) : (
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
				</svg>
			)}
		</button>
	);
}

function SearchIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
		</svg>
	);
}

function SuggestTypeIcon({ type }: { type: string }) {
	switch (type) {
		case "folder": return <IconFolderFilled size={16} style={{ flexShrink: 0, color: "#60a5fa" }} />;
		case "document": return <IconFileFilled size={16} style={{ flexShrink: 0, opacity: 0.7 }} />;
		case "database": return <IconDatabaseFilled size={16} style={{ flexShrink: 0 }} />;
		default: return <IconFileFilled size={16} style={{ flexShrink: 0, opacity: 0.7 }} />;
	}
}

/* ─── File search (base-ui Combobox) ─── */

export function FileSearch({ onSelect, searchFn }: { onSelect: (item: SuggestItem) => void; searchFn?: (query: string, limit?: number) => SearchIndexItem[] }) {
	const [results, setResults] = useState<SuggestItem[]>([]);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const justSelectedRef = useRef(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const anchorRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		return () => { if (timerRef.current) clearTimeout(timerRef.current); };
	}, []);

	const handleInputValueChange = useCallback((inputValue: string) => {
		if (justSelectedRef.current) {
			justSelectedRef.current = false;
			return;
		}
		setQuery(inputValue);
		if (!inputValue.trim()) {
			setResults([]);
			setOpen(false);
			return;
		}
		if (searchFn) {
			const hits = searchFn(inputValue.trim(), 20);
			setResults(hits.map(indexItemToSuggestItem));
			setOpen(true);
		} else {
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(async () => {
				try {
					const res = await fetch(`/api/workspace/suggest-files?q=${encodeURIComponent(inputValue.trim())}`);
					const data = await res.json();
					setResults(data.items ?? []);
					setOpen(true);
				} catch {
					setResults([]);
				}
			}, 150);
		}
	}, [searchFn]);

	return (
		<Combobox
			value={null}
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen) setOpen(false);
			}}
			onValueChange={(val) => {
				if (val) {
					justSelectedRef.current = true;
					onSelect(val as SuggestItem);
					setOpen(false);
					setQuery("");
					setResults([]);
				}
			}}
			onInputValueChange={handleInputValueChange}
			filter={null}
			itemToStringLabel={() => ""}
		>
			<div ref={anchorRef} className="relative">
				<span
					className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10"
					style={{ color: "var(--color-text-muted)" }}
				>
					<SearchIcon />
				</span>
				<ComboboxInput
					placeholder="Search"
					className="w-full pl-9 pr-10 py-1.5 rounded-xl text-sm outline-none transition-colors"
					style={{
						background: "var(--color-surface-hover)",
						color: "var(--color-text)",
					}}
				/>
			</div>
			<ComboboxContent anchor={anchorRef}>
				<ComboboxList>
					{results.map((item) => (
						<ComboboxItem key={item.path} value={item}>
							<span className="flex-shrink-0" style={{ color: "var(--color-text-muted)", opacity: 0.55 }}>
								<SuggestTypeIcon type={item.type} />
							</span>
							<div className="min-w-0 flex-1">
								<div className="truncate font-medium">{item.name}</div>
								<div className="truncate text-xs" style={{ color: "var(--color-text-muted)" }}>
									{item.path.split("/").slice(0, -1).join("/")}
								</div>
							</div>
						</ComboboxItem>
					))}
				</ComboboxList>
				{query.trim() && results.length === 0 && (
					<div className="py-3 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
						No files found
					</div>
				)}
			</ComboboxContent>
		</Combobox>
	);
}

export function WorkspaceSidebar({
	orgName,
	onFileSearchSelect,
	mobile,
	onClose,
	showHidden,
	onToggleHidden,
	width: widthProp,
	onCollapse,
	compact = false,
	onToggleCompact,
  activeWorkspace,
  onWorkspaceChanged,
  onNavigate,
  activeCrmTarget = null,
  customCrmObjects,
  activeCrmObjectName = null,
  onNavigateToCrmObject,
  chatsPanel,
  onNewChatSession,
}: WorkspaceSidebarProps) {
	const width = mobile ? "280px" : (widthProp ?? 260);
	const isCompact = !mobile && compact;
	const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
	// Top-level tab: "home" shows the workspace / CRM / bottom nav. "chats"
	// swaps the body with a chat history list provided by the host.
	const [sidebarTab, setSidebarTab] = useState<"home" | "chats">("home");

	const crmNavItems = [
		{
			id: "crm-people" as const,
			label: "People",
			target: "people" as const,
			icon: (
				<svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
					<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
					<circle cx="9" cy="7" r="4" />
					<path d="M22 21v-2a4 4 0 0 0-3-3.87" />
					<path d="M16 3.13a4 4 0 0 1 0 7.75" />
				</svg>
			),
		},
		{
			id: "crm-companies" as const,
			label: "Companies",
			target: "companies" as const,
			icon: (
				<svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
					<path d="M3 21h18" />
					<path d="M5 21V7l8-4v18" />
					<path d="M19 21V11l-6-4" />
					<path d="M9 9h0" />
					<path d="M9 13h0" />
					<path d="M9 17h0" />
				</svg>
			),
		},
		{
			id: "crm-inbox" as const,
			label: "Inbox",
			target: "inbox" as const,
			icon: (
				<svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
					<polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
					<path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
				</svg>
			),
		},
		{
			id: "crm-calendar" as const,
			label: "Calendar",
			target: "calendar" as const,
			icon: (
				<svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
					<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
					<line x1="16" y1="2" x2="16" y2="6" />
					<line x1="8" y1="2" x2="8" y2="6" />
					<line x1="3" y1="10" x2="21" y2="10" />
				</svg>
			),
		},
	];

	const bottomNavItems = [
		{
			id: "cloud" as const,
			label: "Cloud",
			icon: (
				<svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
					<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
				</svg>
			),
		},
		{
			id: "integrations" as const,
			label: "Integrations",
			icon: <RiApps2AiLine className="h-4 w-4 shrink-0" aria-hidden />,
		},
		{
			id: "skills" as const,
			label: "Skills",
			icon: <GoTools className="h-4 w-4 shrink-0" aria-hidden />,
		},
		{
			id: "cron" as const,
			label: "Cron",
			icon: (
				<svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
					<circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
				</svg>
			),
		},
	];

	const compactSidebar = (
		<aside
			className="flex h-full min-h-0 shrink-0 flex-col border-r"
			style={{
				width: typeof width === "number" ? `${width}px` : width,
				minWidth: typeof width === "number" ? `${width}px` : width,
				background: "var(--color-bg)",
				borderColor: "var(--color-border)",
			}}
		>
			{/* Expand button — kept at the top of compact mode so the
			    "open the sidebar" affordance mirrors the position of the
			    collapse button in expanded mode (both live in the topbar
			    row), making the toggle feel like the same control. */}
			{onToggleCompact && (
				<div className="flex items-center justify-center h-[44px] shrink-0">
					<button
						type="button"
						onClick={onToggleCompact}
						className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
						style={{ color: "var(--color-text-muted)" }}
						onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
						onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
						title="Expand sidebar"
					>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<rect width="18" height="18" x="3" y="3" rx="2" />
						<path d="M15 3v18" />
					</svg>
					</button>
				</div>
			)}

			{/* Header: workspace switcher (icon-only). Click opens dropdown to switch workspaces. */}
			<div className="flex items-center justify-center pb-0.5 shrink-0">
				<ProfileSwitcher
					activeWorkspaceHint={activeWorkspace ?? null}
					onWorkspaceSwitch={() => { onWorkspaceChanged?.(); }}
					onWorkspaceDelete={() => { onWorkspaceChanged?.(); }}
					onCreateWorkspace={() => { setCreateWorkspaceOpen(true); }}
					trigger={({ onClick, activeWorkspace: workspaceName, switching }) => (
						<button
							type="button"
							onClick={onClick}
							disabled={switching}
							className="w-7 h-7 mx-auto rounded-lg overflow-hidden flex items-center justify-center transition-opacity hover:opacity-90"
							title={`${orgName || "Workspace"}${workspaceName ? ` — ${workspaceName}` : ""}`}
						>
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img
								src="/dench-workspace-icon.png"
								alt=""
								className="w-7 h-7 object-cover"
								draggable={false}
							/>
						</button>
					)}
				/>
			</div>

			{/* CRM nav (icons only). */}
			{onNavigate && (
				<div className="flex flex-col items-center gap-0.5 pt-1 pb-1">
					{crmNavItems.map((item) => {
						const active = activeCrmTarget === item.target;
						return (
							<button
								key={item.id}
								type="button"
								onClick={() => onNavigate(item.id)}
								className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
								style={{
									color: "var(--color-text)",
									background: active ? "var(--color-surface-hover)" : "transparent",
								}}
								onMouseEnter={(e) => {
									if (active) return;
									(e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
								}}
								onMouseLeave={(e) => {
									if (active) return;
									(e.currentTarget as HTMLElement).style.background = "transparent";
								}}
								title={item.label}
								aria-label={item.label}
							>
								{item.icon}
							</button>
						);
					})}
					{customCrmObjects && customCrmObjects.length > 0 && onNavigateToCrmObject && customCrmObjects.map((obj) => {
						const active = activeCrmObjectName === obj.name;
						const label = displayObjectName(obj.name);
						return (
							<button
								key={`crm-object-${obj.name}`}
								type="button"
								onClick={() => onNavigateToCrmObject(obj.name)}
								className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
								style={{
									color: "var(--color-text)",
									background: active ? "var(--color-surface-hover)" : "transparent",
								}}
								onMouseEnter={(e) => {
									if (active) return;
									(e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
								}}
								onMouseLeave={(e) => {
									if (active) return;
									(e.currentTarget as HTMLElement).style.background = "transparent";
								}}
								title={label}
								aria-label={label}
							>
								<CrmObjectIcon name={obj.icon} size={16} />
							</button>
						);
					})}
				</div>
			)}

			{/* Spacer pushes bottom nav + footer down. */}
			<div className="flex-1 min-h-0" />

			{/* Bottom nav (icons only). */}
			{onNavigate && (
				<div className="flex flex-col items-center gap-0.5 py-1">
					{bottomNavItems.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => onNavigate(item.id)}
							className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
							style={{ color: "var(--color-text)" }}
							onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
							onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
							title={item.label}
							aria-label={item.label}
						>
							{item.icon}
						</button>
					))}
				</div>
			)}

			{/* Footer: theme toggle + dotfiles toggle, stacked. */}
			<div className="flex flex-col items-center py-1.5 gap-0.5">
				{onToggleHidden && (
					<button
						type="button"
						onClick={onToggleHidden}
						className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
						style={{ color: showHidden ? "var(--color-text)" : "var(--color-text-muted)" }}
						onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
						onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
						title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							{showHidden ? (
								<>
									<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
									<circle cx="12" cy="12" r="3" />
								</>
							) : (
								<>
									<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
									<path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
									<path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
									<path d="m2 2 20 20" />
								</>
							)}
						</svg>
					</button>
				)}
				<ThemeToggle />
			</div>
		</aside>
	);

	const sidebar = (
		<aside
			className={`flex h-full min-h-0 shrink-0 flex-col ${mobile ? "drawer-left" : "border-r"}`}
			style={{
				width: typeof width === "number" ? `${width}px` : width,
				minWidth: typeof width === "number" ? `${width}px` : width,
				background: "var(--color-bg)",
				borderColor: "var(--color-border)",
			}}
		>
			{/* Header — workspace switcher always visible; browse-mode controls moved to the right panel's Files view */}
			<div
				className="flex items-center gap-1 px-2 h-[44px] shrink-0"
			>
				<div className="flex-1 min-w-0">
					<ProfileSwitcher
						activeWorkspaceHint={activeWorkspace ?? null}
						onWorkspaceSwitch={() => { onWorkspaceChanged?.(); }}
						onWorkspaceDelete={() => { onWorkspaceChanged?.(); }}
						onCreateWorkspace={() => { setCreateWorkspaceOpen(true); }}
						trigger={({ onClick, activeWorkspace: workspaceName, switching }) => (
							<button
								type="button"
								onClick={onClick}
								disabled={switching}
								className="text-[13px] flex items-center gap-1.5 truncate w-full transition-colors rounded-lg px-2 py-1.5"
								style={{ color: "var(--color-text)" }}
								onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
								onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
								title="Switch workspace"
							>
								<span className="truncate font-semibold">{orgName || "Workspace"}</span>
								{workspaceName && (
									<>
										<span className="shrink-0 opacity-40">/</span>
										<span className="truncate text-[12px]" style={{ color: "var(--color-text-muted)" }}>
											{workspaceName}
										</span>
									</>
								)}
								<span className="flex-1" />
								<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ color: "var(--color-text-muted)" }}>
									<path d="m6 9 6 6 6-6" />
								</svg>
							</button>
						)}
					/>
				</div>
				{(onToggleCompact || onCollapse) && (
					<button
						type="button"
						onClick={onToggleCompact ?? onCollapse}
						className="p-1.5 rounded-lg shrink-0 transition-colors"
						style={{ color: "var(--color-text-muted)" }}
						onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
						onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
						title={onToggleCompact ? "Collapse to icons" : "Hide sidebar (⌘B)"}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<rect width="18" height="18" x="3" y="3" rx="2" />
							<path d="M9 3v18" />
						</svg>
					</button>
				)}
			</div>

		{/* Tab switcher: Home (workspace nav) vs. Chats (session history) */}
		{chatsPanel && (
			<div className="px-2 pt-1 pb-1 flex items-center gap-1">
				{([
					{ id: "home", label: "Home" },
					{ id: "chats", label: "Chats" },
				] as const).map((tab) => {
					const active = sidebarTab === tab.id;
					return (
						<button
							key={tab.id}
							type="button"
							onClick={() => setSidebarTab(tab.id)}
							className="flex-1 px-2 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer"
							style={{
								color: active ? "var(--color-text)" : "var(--color-text-muted)",
								background: active ? "var(--color-surface-hover)" : "transparent",
							}}
							onMouseEnter={(e) => {
								if (active) return;
								(e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
							}}
							onMouseLeave={(e) => {
								if (active) return;
								(e.currentTarget as HTMLElement).style.background = "transparent";
							}}
						>
							{tab.label}
						</button>
					);
				})}
				{sidebarTab === "chats" && onNewChatSession && (
					<button
						type="button"
						onClick={onNewChatSession}
						className="p-1 rounded-md transition-colors cursor-pointer shrink-0"
						style={{ color: "var(--color-text-muted)" }}
						onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
						onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
						title="New chat"
						aria-label="New chat"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
							<path d="M5 12h14" /><path d="M12 5v14" />
						</svg>
					</button>
				)}
			</div>
		)}

		{sidebarTab === "chats" && chatsPanel ? (
			<div className="flex-1 min-h-0 flex flex-col relative">
				{chatsPanel}
			</div>
		) : (
			<>
		{onNavigate && (
			<div className="px-2 pt-1 pb-1">
				<div
					className="px-2 pt-2 pb-1 text-[9px] lowercase"
					style={{ color: "var(--color-text-muted)", letterSpacing: "0.05em" }}
				>
					workspace
				</div>
				<div className="space-y-0.5">
					{crmNavItems.map((item) => {
						const active = activeCrmTarget === item.target;
						return (
							<button
								key={item.id}
								type="button"
								onClick={() => onNavigate(item.id)}
								className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[13px] transition-colors"
								style={{
									color: "var(--color-text)",
									background: active ? "var(--color-surface-hover)" : "transparent",
								}}
								onMouseEnter={(e) => {
									if (active) return;
									(e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
								}}
								onMouseLeave={(e) => {
									if (active) return;
									(e.currentTarget as HTMLElement).style.background = "transparent";
								}}
							>
								<span className="shrink-0" style={{ color: "var(--color-text-muted)" }}>{item.icon}</span>
								{item.label}
							</button>
						);
					})}
					{customCrmObjects && customCrmObjects.length > 0 && onNavigateToCrmObject && customCrmObjects.map((obj) => {
						const active = activeCrmObjectName === obj.name;
						const label = displayObjectName(obj.name);
						return (
							<button
								key={`crm-object-${obj.name}`}
								type="button"
								onClick={() => onNavigateToCrmObject(obj.name)}
								className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[13px] transition-colors"
								style={{
									color: "var(--color-text)",
									background: active ? "var(--color-surface-hover)" : "transparent",
								}}
								onMouseEnter={(e) => {
									if (active) return;
									(e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
								}}
								onMouseLeave={(e) => {
									if (active) return;
									(e.currentTarget as HTMLElement).style.background = "transparent";
								}}
								title={label}
							>
								<span className="shrink-0" style={{ color: "var(--color-text-muted)" }}>
									<CrmObjectIcon name={obj.icon} size={16} />
								</span>
								{label}
							</button>
						);
					})}
				</div>
			</div>
		)}

			{/* v3: chat history moved into chat-panel header (Clock dropdown). */}
			<div className="flex-1 min-h-0" />

		{onNavigate && (
			<div className="px-2 py-1 space-y-0.5">
				{bottomNavItems.map((item) => (
					<button
						key={item.id}
						type="button"
						onClick={() => onNavigate(item.id)}
						className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[13px] transition-colors"
						style={{ color: "var(--color-text)" }}
						onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
						onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
					>
						<span className="shrink-0" style={{ color: "var(--color-text-muted)" }}>{item.icon}</span>
						{item.label}
					</button>
				))}
			</div>
		)}
			</>
		)}

		<div className="px-2 py-1.5 flex items-center justify-between">
			<a
				href="https://dench.com"
				target="_blank"
				rel="noopener noreferrer"
				className="flex items-center gap-2 px-2 py-1 rounded-lg text-[11px]"
				style={{ color: "var(--color-text-muted)" }}
			>
				dench.com{process.env.NEXT_PUBLIC_DENCHCLAW_VERSION ? ` v${process.env.NEXT_PUBLIC_DENCHCLAW_VERSION}` : ""}
			</a>
			<div className="flex items-center gap-0.5">
				{onToggleHidden && (
					<button
						type="button"
						onClick={onToggleHidden}
						className="p-1.5 rounded-lg transition-colors"
						style={{ color: showHidden ? "var(--color-text)" : "var(--color-text-muted)" }}
						title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							{showHidden ? (
								<>
									<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
									<circle cx="12" cy="12" r="3" />
								</>
							) : (
								<>
									<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
									<path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
									<path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
									<path d="m2 2 20 20" />
								</>
							)}
						</svg>
					</button>
				)}
				<ThemeToggle />
			</div>
		</div>

		</aside>
	);

	if (!mobile) {
		return (
			<>
				{isCompact ? compactSidebar : sidebar}
				<CreateWorkspaceDialog
					isOpen={createWorkspaceOpen}
					onClose={() => setCreateWorkspaceOpen(false)}
					onCreated={() => {
						onWorkspaceChanged?.();
					}}
				/>
			</>
		);
	}

	return (
		<>
			<div className="drawer-backdrop" onClick={() => void onClose?.()}>
				{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
				<div onClick={(e) => e.stopPropagation()} className="fixed inset-y-0 left-0 z-50">
					{sidebar}
				</div>
			</div>
			<CreateWorkspaceDialog
				isOpen={createWorkspaceOpen}
				onClose={() => setCreateWorkspaceOpen(false)}
				onCreated={() => {
					onWorkspaceChanged?.();
				}}
			/>
		</>
	);
}
