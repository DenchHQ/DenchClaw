"use client";

import { Suspense, useEffect, useState, useCallback, useRef, useMemo, useReducer, type ReactNode } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { WorkspaceSidebar } from "../components/workspace/workspace-sidebar";
import { FileManagerTree, type TreeNode } from "../components/workspace/file-manager-tree";
import { useWorkspaceWatcher } from "../hooks/use-workspace-watcher";
import { RightPanelContent } from "../components/workspace/right-panel-content";
import type {
  ContentState,
  ObjectData,
  FileData,
} from "./content-state";
import { ObjectTable, AddEntryModal } from "../components/workspace/object-table";
import { ObjectKanban } from "../components/workspace/object-kanban";
import { ObjectCalendar, type CalendarDateChangePayload } from "../components/workspace/object-calendar";
import { ObjectTimeline, type TimelineDateChangePayload } from "../components/workspace/object-timeline";
import { ObjectGallery } from "../components/workspace/object-gallery";
import { ObjectList } from "../components/workspace/object-list";
import { ViewTypeSwitcher } from "../components/workspace/view-type-switcher";
import { ViewSettingsPopover } from "../components/workspace/view-settings-popover";
import { IconPicker } from "../components/workspace/icon-picker";
import { DocumentView } from "../components/workspace/document-view";
import { FileViewer, isSpreadsheetFile } from "../components/workspace/file-viewer";
import { SpreadsheetEditor } from "../components/workspace/spreadsheet-editor";
import { HtmlViewer } from "../components/workspace/html-viewer";
import { AppViewer } from "../components/workspace/app-viewer";
import { MonacoCodeEditor } from "../components/workspace/code-editor";
import { MediaViewer, detectMediaType, type MediaType } from "../components/workspace/media-viewer";
import { DatabaseViewer, DuckDBMissing } from "../components/workspace/database-viewer";
import { RichDocumentEditor, isDocxFile, isTxtFile, textToHtml } from "../components/workspace/rich-document-editor";
import { Breadcrumbs } from "../components/workspace/breadcrumbs";
import { EmptyState } from "../components/workspace/empty-state";
import { ReportViewer } from "../components/charts/report-viewer";
import { InboxView } from "../components/crm/inbox-view";
import { CalendarView } from "../components/crm/calendar-view";
import { PersonProfile } from "../components/crm/person-profile";
import { CompanyProfile } from "../components/crm/company-profile";
import { ChatPanel, type ChatPanelHandle, type SubagentSpawnInfo } from "../components/chat-panel";
import { EntryDetailPanel } from "../components/workspace/entry-detail-panel";
import { useSearchIndex } from "@/lib/search-index";
import {
  parseWorkspaceLink,
  isWorkspaceLink,
  parseUrlState,
  buildUrl,
  serializeUrlState,
  mergePreservedTableView,
  type WorkspaceUrlState,
} from "@/lib/workspace-links";
import {
  type WorkspaceTabsState,
  type ContentTab,
  type ContentTabKind,
  EMPTY_TABS_STATE,
  workspaceTabsReducer,
  selectActiveContentTab,
  selectActivePath,
  ensureChatPresent,
  loadTabsState,
  saveTabsState,
  inferContentTabKindFromPath,
  inferContentTabTitle,
  contentTabIdFor,
  applyUrlToState,
  projectUrlState,
  createDraftChatTab,
  createSessionChatTab,
  createSubagentChatTab,
  createGatewayChatTab,
  makeContentTab,
} from "@/lib/workspace-tabs";
import { isCodeFile } from "@/lib/report-utils";
import { displayObjectName, displayObjectNameSingular } from "@/lib/object-display-name";
import { isSeedPeopleObjectId, isSeedCompanyObjectId } from "@/lib/seed-object-ids";
import { CronDashboard } from "../components/cron/cron-dashboard";
import { SkillStorePanel } from "../components/skill-store/skill-store-panel";
import { SkillTemplateGalleryPanel } from "../components/templates/skill-template-gallery-panel";
import { IntegrationsPanel } from "../components/integrations/integrations-panel";
import { ChatComposioModalHost } from "../components/integrations/chat-composio-modal-host";
import { CloudSettingsPanel } from "../components/settings/cloud-settings-panel";
import { CronJobDetail } from "../components/cron/cron-job-detail";
import { CronSessionView } from "../components/cron/cron-session-view";
import type { TableSelectionContext } from "@/lib/table-selection";
import type { CronJob, CronJobsResponse } from "../types/cron";
import { useIsMobile } from "../hooks/use-mobile";
import { ObjectFilterBar } from "../components/workspace/object-filter-bar";
import {
  type FilterGroup, type SortRule, type SavedView, type ViewType,
  type ViewTypeSettings,
  emptyFilterGroup, serializeFilters, resolveViewType, resolveViewSettings,
  autoDetectViewField,
} from "@/lib/object-filters";
import { UnicodeSpinner } from "../components/unicode-spinner";
import { ToastProvider } from "../components/workspace/toast";
import { SyncHealthBanner } from "../components/workspace/sync-health-banner";
import { ChatSessionsSidebar, type SidebarGatewaySession } from "../components/workspace/chat-sessions-sidebar";
import { RightPanel } from "../components/workspace/right-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../components/ui/context-menu";
import { resolveActiveViewSyncDecision } from "./object-view-active-view";
import { mergeNewlySeenColumns } from "./object-view-column-discovery";
import { resetWorkspaceStateOnSwitch } from "./workspace-switch";
// Note: TabBar (the chrome-tabs strip used by the legacy single-strip layout)
// is no longer used here — the v3 layout has separate inline strips for
// chats and content. Keep the file for components that may still mount it.
import {
  createChatRunsSnapshot,
  mergeChatRuntimeSnapshot,
  removeChatRuntimeSnapshot,
  type ChatTabRuntimeSnapshot,
  type ChatRunsSnapshot,
  type ChatPanelRuntimeState,
} from "@/lib/chat-session-registry";
import {
  fileReadUrl as fileApiUrl,
  rawFileReadUrl as rawFileUrl,
  isAbsolutePath,
  isHomeRelativePath,
  isVirtualPath,
} from "@/lib/workspace-paths";
import dynamic from "next/dynamic";
import type { ComposioChatAction } from "@/lib/composio-chat-actions";
import { startSkillTemplateChatFromDashboard } from "@/lib/skill-template-chat-start";
import type { SkillTemplateId } from "@/lib/skill-templates";

const TerminalDrawer = dynamic(
  () => import("../components/terminal/terminal-drawer"),
  { ssr: false },
);

// --- Types ---

type WorkspaceContext = {
  exists: boolean;
  organization?: { id?: string; name?: string; slug?: string };
  members?: Array<{ id: string; name: string; email: string; role: string }>;
};

// `ContentState`, `ObjectData`, `FileData`, and `DenchAppManifest` live in
// `./content-state` so they can be shared with `useTabContent` and
// `RightPanelContent` without pulling in the whole god-component.
export type { DenchAppManifest } from "./content-state";

type WebSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  filePath?: string;
};

type SkillTemplateConsumeResponse = {
  prompt: string | null;
  templateId?: string;
};

// Left sidebar has two visual modes driven by width:
// - compact (icon-only) at LEFT_SIDEBAR_COMPACT_WIDTH
// - full (labels, chat list, CRM nav) at >= LEFT_SIDEBAR_FULL_MIN
// Dragging the resize handle below LEFT_SIDEBAR_COMPACT_THRESHOLD snaps to compact;
// dragging into the [threshold, full min) gap snaps to full min.
const LEFT_SIDEBAR_COMPACT_WIDTH = 56;
const LEFT_SIDEBAR_COMPACT_THRESHOLD = 140;
const LEFT_SIDEBAR_FULL_MIN = 200;
const LEFT_SIDEBAR_FULL_DEFAULT = 260;
const LEFT_SIDEBAR_MIN = LEFT_SIDEBAR_COMPACT_WIDTH;
const LEFT_SIDEBAR_MAX = 480;
const CENTER_PANEL_MIN = 300;
const RIGHT_PANEL_MIN = 360;
const RIGHT_PANEL_MAX = 2000;
const STORAGE_LEFT = "dench-workspace-left-sidebar-width";
const STORAGE_RIGHT_PANEL = "dench-workspace-right-panel-width";
const STORAGE_RIGHT_PANEL_COLLAPSED = "dench-workspace-right-panel-collapsed";
const STORAGE_FILE_TREE_COLLAPSED = "dench-workspace-file-tree-collapsed";
const FILE_TREE_WIDTH = 240;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Vertical resize handle; uses cursor position so the handle follows the mouse (no stuck-at-limit). */
function ResizeHandle({
  mode,
  containerRef,
  min,
  max,
  onResize,
}: {
  mode: "left" | "right";
  containerRef: React.RefObject<HTMLElement | null>;
  min: number;
  max: number;
  onResize: (width: number) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const move = (ev: MouseEvent) => {
        const el = containerRef.current;
        if (!el) {return;}
        const rect = el.getBoundingClientRect();
        const width =
          mode === "left"
            ? ev.clientX - rect.left
            : rect.right - ev.clientX;
        onResize(clamp(width, min, max));
      };
      const up = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.body.style.removeProperty("user-select");
        document.body.style.removeProperty("cursor");
        document.body.classList.remove("resizing");
      };
      document.body.style.setProperty("user-select", "none");
      document.body.style.setProperty("cursor", "col-resize");
      document.body.classList.add("resizing");
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [containerRef, mode, min, max, onResize],
  );
  const showHover = isDragging || undefined;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className={`cursor-col-resize flex justify-center transition-colors ${showHover ? "bg-blue-600/30" : "hover:bg-blue-600/30"}`}
      style={{ position: "absolute", [mode === "left" ? "right" : "left"]: -2, top: 0, bottom: 0, width: 4, zIndex: 40 }}
    />
  );
}

// `TabIcon` and `ensureChatTabPresent` moved into
// `apps/web/app/components/workspace/content-tab-icon.tsx` and
// `apps/web/lib/workspace-tabs.ts` respectively, so the new model owns its
// own UI helpers and invariants.

/** Find a node in the tree by exact path. */
function findNode(
  tree: TreeNode[],
  path: string,
): TreeNode | null {
  for (const node of tree) {
    if (node.path === path) {return node;}
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) {return found;}
    }
  }
  return null;
}

/** Extract the object name from a tree path (last segment). */
function objectNameFromPath(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1];
}

/**
 * Locate a workspace object node by its raw object name (e.g. `"people"`,
 * `"company"`, `"vc_lead"`). Walks the raw tree so CRM navigation can find
 * objects independently from how the file tree chooses to render them.
 * Returns `null` if no matching node exists.
 */
function findCrmObjectNode(nodes: TreeNode[], objectName: string): TreeNode | null {
  for (const node of nodes) {
    if (node.type === "object" && objectNameFromPath(node.path) === objectName) {
      return node;
    }
    if (node.children) {
      const found = findCrmObjectNode(node.children, objectName);
      if (found) {return found;}
    }
  }
  return null;
}

/**
 * Resolve the `people` or `company` workspace object node, falling back to a
 * synthetic `{ name, path, type: "object" }` node when the tree fetch hasn't
 * surfaced it yet (or when the user is hitting the URL before the workspace
 * is fully populated). The synthetic path matches the seed schema's raw
 * object name so `loadContent` resolves it via `/api/workspace/objects/<name>`.
 */
function resolveCrmObjectNode(tree: TreeNode[], objectName: "people" | "company"): TreeNode {
  return (
    findCrmObjectNode(tree, objectName) ?? {
      name: objectName,
      path: objectName,
      type: "object",
    }
  );
}

/**
 * Walk the workspace tree and collect every object node that should appear in
 * the sidebar's CRM section. Excludes `people` / `company` / `companies` since
 * those already have dedicated rows in the hard-coded CRM nav. Hidden CRM-only
 * objects (`email_thread` / `email_message` / `calendar_event` / `interaction`)
 * are filtered out upstream by the tree API and never appear here.
 */
const CRM_NAV_EXCLUDED_OBJECT_NAMES: ReadonlySet<string> = new Set([
  "people",
  "company",
  "companies",
]);

/**
 * Object names whose reverse-relation columns are considered noise on the
 * People and Companies tables. These are system-managed CRM tables
 * (`email_thread`, `email_message`, `calendar_event`, `interaction`) that
 * the Gmail/Calendar sync auto-populates; their reverse chips on a People
 * or Company row aren't actionable for the user, so we default-hide them.
 *
 * Custom CRM objects' reverse columns are unaffected — only People and
 * Companies have the hiding applied. Surfacing these as opt-in toggles in
 * the column picker is future work.
 */
const NOISY_CRM_REVERSE_SOURCES: ReadonlySet<string> = new Set([
  "email_thread",
  "email_message",
  "calendar_event",
  "interaction",
]);

/** Object names that get noisy reverse columns hidden by default. */
const HIDE_NOISY_REVERSE_FOR_OBJECT_NAMES: ReadonlySet<string> = new Set([
  "people",
  "company",
  "companies",
]);

function collectCrmObjectNodes(
  tree: TreeNode[],
): Array<{ name: string; icon?: string; defaultView?: "table" | "kanban" }> {
  const byName = new Map<string, { name: string; icon?: string; defaultView?: "table" | "kanban" }>();
  function walk(nodes: TreeNode[]) {
    for (const node of nodes) {
      if (node.type === "object") {
        const name = objectNameFromPath(node.path);
        if (!CRM_NAV_EXCLUDED_OBJECT_NAMES.has(name) && !byName.has(name)) {
          byName.set(name, { name, icon: node.icon, defaultView: node.defaultView });
        }
      }
      if (node.children) {walk(node.children);}
    }
  }
  walk(tree);
  return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * Map a TreeNode-style type + path to the new content-tab kind. Virtual
 * paths (`~cron`, `~skills`, etc.) take precedence over the literal node
 * type so a synthetic `{path:"~cron", type:"folder"}` opens as the cron
 * dashboard, not as a directory listing.
 */
function nodeToContentTabKind(nodeType: string, path: string): ContentTabKind {
  if (path === "~cron") return "cron-dashboard";
  if (path.startsWith("~cron/")) return "cron-job";
  if (path === "~skills") return "skills";
  if (path === "~integrations") return "integrations";
  if (path === "~cloud") return "cloud";
  if (path === "~crm/inbox") return "crm-inbox";
  if (path === "~crm/calendar") return "crm-calendar";
  switch (nodeType) {
    case "object": return "object";
    case "document": return "document";
    case "database": return "database";
    case "report": return "report";
    case "app": return "app";
    case "folder": return "directory";
    case "file":
    default: return "file";
  }
}

/** Infer a tree node type from filename extension for ad-hoc path previews. */
function inferNodeTypeFromFileName(fileName: string): TreeNode["type"] {
  if (fileName.endsWith(".dench.app")) return "app";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "mdx") {return "document";}
  if (ext === "duckdb" || ext === "sqlite" || ext === "sqlite3" || ext === "db") {return "database";}
  return "file";
}

/** Normalize chat path references (supports file:// URLs). */
function normalizeChatPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith("file://")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "file:") {
      return trimmed;
    }
    const decoded = decodeURIComponent(url.pathname);
    // Windows file URLs are /C:/... in URL form
    if (/^\/[A-Za-z]:\//.test(decoded)) {
      return decoded.slice(1);
    }
    return decoded;
  } catch {
    return trimmed;
  }
}

/**
 * Resolve a path with fallback strategies:
 * 1. Exact match
 * 2. Try with knowledge/ prefix
 * 3. Try stripping knowledge/ prefix
 * 4. Match last segment against object names
 */
function resolveNode(
  tree: TreeNode[],
  path: string,
): TreeNode | null {
  let node = findNode(tree, path);
  if (node) {return node;}

  if (!path.startsWith("knowledge/")) {
    node = findNode(tree, `knowledge/${path}`);
    if (node) {return node;}
  }

  if (path.startsWith("knowledge/")) {
    node = findNode(tree, path.slice("knowledge/".length));
    if (node) {return node;}
  }

  const lastSegment = path.split("/").pop();
  if (lastSegment) {
    function findByName(nodes: TreeNode[]): TreeNode | null {
      for (const n of nodes) {
        if (n.type === "object" && objectNameFromPath(n.path) === lastSegment) {return n;}
        if (n.children) {
          const found = findByName(n.children);
          if (found) {return found;}
        }
      }
      return null;
    }
    node = findByName(tree);
    if (node) {return node;}
  }

  return null;
}

// --- Main Page ---

export function WorkspaceShell() {
  return (
    <ToastProvider>
      <Suspense fallback={
        <div className="flex h-full items-center justify-center" style={{ background: "var(--color-bg)" }}>
          <UnicodeSpinner name="braille" className="text-2xl" style={{ color: "var(--color-text-muted)" }} />
        </div>
      }>
        <WorkspacePageInner />
      </Suspense>
      {/* Polls /api/sync/status and shows a sticky banner when Gmail or
       *  Calendar incremental sync is failing. Outside the Suspense
       *  boundary so it shows even while the workspace is hydrating —
       *  a stuck sync is most useful to surface immediately on load. */}
      <SyncHealthBanner />
    </ToastProvider>
  );
}


function WorkspacePageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // `hydrationPhase` gates the URL sync effect so it doesn't push a URL
  // before the URL→state hydration has run. `postHydrationRender` is set by
  // the hydration effect and skipped once by the URL sync effect so that
  // re-applying the same URL doesn't trigger a redundant push.
  const hydrationPhase = useRef<"init" | "hydrated">("init");
  const postHydrationRender = useRef(false);

  // Visible main chat panel ref for session management
  const chatRef = useRef<ChatPanelHandle>(null);
  // Mounted main chat panels keyed by tab id so inactive tabs can keep streaming.
  const chatPanelRefs = useRef<Record<string, ChatPanelHandle | null>>({});
  const skillTemplateHandoffCheckedRef = useRef(false);
  const skillTemplatePromptSentRef = useRef(false);
  // Root layout ref for resize handle position (handle follows cursor)
  const layoutRef = useRef<HTMLDivElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(0);

  // Live-reactive tree via SSE watcher (with browse-mode support)
  const {
    tree, loading: treeLoading, exists: workspaceExists, refresh: refreshTree,
    reconnect: reconnectWorkspaceWatcher,
    browseDir, setBrowseDir, parentDir: browseParentDir, workspaceRoot, openclawDir,
    activeWorkspace: workspaceName,
    showHidden, setShowHidden,
  } = useWorkspaceWatcher();

  // Track tree changes to refresh search index
  const treeRefreshCount = useRef(0);
  const [searchRefreshSignal, setSearchRefreshSignal] = useState(0);
  useEffect(() => {
    if (tree.length > 0) {
      treeRefreshCount.current += 1;
      setSearchRefreshSignal(treeRefreshCount.current);
    }
  }, [tree]);

  // Search index for @ mention fuzzy search (files + entries)
  const { search: searchIndex } = useSearchIndex(searchRefreshSignal);

  const [context, setContext] = useState<WorkspaceContext | null>(null);

  // Chat session state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<WebSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [streamingSessionIds, setStreamingSessionIds] = useState<Set<string>>(new Set());
  const [chatRuntimeSnapshots, setChatRuntimeSnapshots] = useState<Record<string, ChatTabRuntimeSnapshot>>({});
  const [chatRunsSnapshot, setChatRunsSnapshot] = useState<ChatRunsSnapshot>(() =>
    createChatRunsSnapshot({ parentRuns: [], subagents: [] }),
  );

  // Subagent tracking
  const [subagents, setSubagents] = useState<SubagentSpawnInfo[]>([]);
  const [activeSubagentKey, setActiveSubagentKey] = useState<string | null>(null);

  // Gateway channel sessions
  const [gatewaySessions, setGatewaySessions] = useState<SidebarGatewaySession[]>([]);
  const [activeGatewaySessionKey, setActiveGatewaySessionKey] = useState<string | null>(null);

  // Cron jobs state
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);

  // Cron URL-backed view state
  const [cronView, setCronView] = useState<import("@/lib/workspace-links").CronDashboardView>("overview");
  const [cronCalMode, setCronCalMode] = useState<import("@/lib/object-filters").CalendarMode>("month");
  const [cronDate, setCronDate] = useState<string | null>(null);
  const [cronRunFilter, setCronRunFilter] = useState<import("@/lib/workspace-links").CronRunStatusFilter>("all");
  const [cronRun, setCronRun] = useState<number | null>(null);

  // Entry detail modal state
  const [entryModal, setEntryModal] = useState<{
    objectName: string;
    entryId: string;
  } | null>(null);

  // Mobile responsive state
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Sidebar collapse state (desktop only).
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true);
  const [mobileRightPanelOpen, setMobileRightPanelOpen] = useState(false);
  // File tree (right panel's left column) is now always available, independently
  // togglable from the right-panel collapse so users can hide it on CRM/page tabs
  // when they want more horizontal space. Persisted in localStorage.
  const [fileTreeCollapsed, setFileTreeCollapsed] = useState(false);

  // Terminal drawer state
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [templatesPanelOpen, setTemplatesPanelOpen] = useState(false);
  const [pendingComposioAction, setPendingComposioAction] = useState<ComposioChatAction | null>(null);
  const [tableSelectionContext, setTableSelectionContext] = useState<TableSelectionContext | null>(null);

  useEffect(() => {
    const updateLayoutWidth = () => {
      setLayoutWidth(layoutRef.current?.clientWidth ?? window.innerWidth);
    };
    updateLayoutWidth();

    const observer =
      typeof ResizeObserver !== "undefined" && layoutRef.current
        ? new ResizeObserver(updateLayoutWidth)
        : null;
    if (layoutRef.current) {
      observer?.observe(layoutRef.current);
    }
    window.addEventListener("resize", updateLayoutWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateLayoutWidth);
    };
  }, []);

  // Tabs state — single source of truth for content + chat tabs.
  // Replaces the older tabState/activePath/content/activeContentTabId quartet
  // which raced each other across effects. See `apps/web/lib/workspace-tabs.ts`.
  const [tabsState, dispatch] = useReducer(workspaceTabsReducer, EMPTY_TABS_STATE);
  const tabsStateRef = useRef<WorkspaceTabsState>(EMPTY_TABS_STATE);
  useEffect(() => {
    tabsStateRef.current = tabsState;
  }, [tabsState]);

  // Track which workspace we loaded tabs for, so we reload if the workspace switches
  // and don't save until we've loaded first.
  const tabLoadedForWorkspace = useRef<string | null>(null);

  // Load tabs from localStorage once workspace name is known
  useEffect(() => {
    const key = workspaceName || null;
    if (tabLoadedForWorkspace.current === key) return;
    tabLoadedForWorkspace.current = key;
    const loaded = loadTabsState(key);
    // v3 invariant: at least one chat tab must exist so the center never goes
    // blank — even when localStorage only stored file/CRM tabs.
    dispatch({ type: "replace", state: ensureChatPresent(loaded) });
    setChatRuntimeSnapshots({});
  }, [workspaceName]);

  // Persist tabs to localStorage on change (only after hydration completes)
  useEffect(() => {
    if (hydrationPhase.current !== "hydrated") return;
    saveTabsState(tabsState, workspaceName || null);
  }, [tabsState, workspaceName]);

  useEffect(() => {
    const validTabIds = new Set([
      ...tabsState.contentTabs.map((t) => t.id),
      ...tabsState.chatTabs.map((t) => t.id),
    ]);
    setChatRuntimeSnapshots((prev) => {
      let next = prev;
      for (const tabId of Object.keys(prev)) {
        if (!validTabIds.has(tabId)) {
          next = removeChatRuntimeSnapshot(next, tabId);
        }
      }
      return next;
    });
    for (const tabId of Object.keys(chatPanelRefs.current)) {
      if (!validTabIds.has(tabId)) {
        delete chatPanelRefs.current[tabId];
      }
    }
  }, [tabsState.contentTabs, tabsState.chatTabs]);

  // Derived selectors — `activePath` and the active tab references derive
  // from the reducer state, so they cannot drift from the tab strip.
  const activeContentTab = useMemo(
    () => selectActiveContentTab(tabsState),
    [tabsState],
  );
  const activePath = activeContentTab?.path ?? null;
  const activeContentTabId = tabsState.activeContentId;
  const activeChatTabId = tabsState.activeChatId;
  const contentTabs = tabsState.contentTabs;
  const mainChatTabs = tabsState.chatTabs;

  // Ref for the keyboard shortcut to close the active tab.
  const tabCloseActiveRef = useRef<(() => void) | null>(null);

  // v3: chat-switching helpers — dispatched against the chat-tab portion of
  // `tabsState`. They never touch the content tabs, so the right panel's
  // state is independent of which chat is shown in the center.
  const openBlankChatTab = useCallback(() => {
    const tab = createDraftChatTab();
    setActiveSessionId(null);
    setActiveSubagentKey(null);
    dispatch({ type: "openChat", tab: { ...tab, preview: true } });
    return tab;
  }, []);

  const openPermanentBlankChatTab = useCallback(() => {
    const tab = createDraftChatTab();
    setActiveSessionId(null);
    setActiveSubagentKey(null);
    dispatch({ type: "openChat", tab: { ...tab, preview: false } });
    return tab;
  }, []);

  const openSessionChatTab = useCallback((sessionId: string, title?: string) => {
    setActiveSessionId(sessionId);
    setActiveSubagentKey(null);
    const tab = createSessionChatTab({ sessionId, title });
    dispatch({ type: "openChat", tab: { ...tab, preview: true } });
  }, []);

  const openSubagentChatTab = useCallback((params: {
    sessionKey: string;
    parentSessionId: string;
    title?: string;
  }) => {
    setActiveSessionId(params.parentSessionId);
    setActiveSubagentKey(params.sessionKey);
    const tab = createSubagentChatTab(params);
    dispatch({ type: "openChat", tab: { ...tab, preview: true } });
  }, []);

  const openGatewayChatTab = useCallback((sessionKey: string, sessionId: string, channel?: string, title?: string) => {
    setActiveSessionId(null);
    setActiveSubagentKey(null);
    setActiveGatewaySessionKey(sessionKey);
    const tab = createGatewayChatTab({
      sessionKey,
      sessionId,
      channel: channel ?? "unknown",
      title: title ?? "Channel Chat",
    });
    dispatch({ type: "openChat", tab: { ...tab, preview: true } });
  }, []);

  const promoteTabById = useCallback((tabId: string | null | undefined) => {
    if (!tabId) return;
    // Try content first, then chat — ids are unique across both.
    if (tabsStateRef.current.contentTabs.some((t) => t.id === tabId)) {
      dispatch({ type: "promoteContent", id: tabId });
    } else {
      dispatch({ type: "promoteChat", id: tabId });
    }
  }, []);

  const promoteTabByPath = useCallback((path: string | null | undefined) => {
    if (!path) return;
    dispatch({ type: "promoteContentByPath", path });
  }, []);

  // The center column always shows whichever chat tab the chat strip last
  // focused; the file panel never changes this. Derived directly from the
  // reducer state with chat-session bookkeeping as a fallback.
  const visibleMainChatTabId = useMemo(() => {
    if (activeChatTabId && mainChatTabs.some((t) => t.id === activeChatTabId)) {
      return activeChatTabId;
    }
    if (activeGatewaySessionKey) {
      const match = mainChatTabs.find((t) => t.variant === "gateway" && t.sessionKey === activeGatewaySessionKey);
      if (match) return match.id;
    }
    if (activeSubagentKey) {
      const match = mainChatTabs.find((t) => t.sessionKey === activeSubagentKey);
      if (match) return match.id;
    }
    if (activeSessionId) {
      const match = mainChatTabs.find((t) => t.sessionId === activeSessionId);
      if (match) return match.id;
    }
    return mainChatTabs[0]?.id ?? null;
  }, [activeChatTabId, activeSessionId, activeSubagentKey, activeGatewaySessionKey, mainChatTabs]);

  // Keep `activeSessionId`/`activeSubagentKey` in sync with the visible chat
  // tab so child components (composer, inbox actions) don't need to know
  // about the tabsState shape.
  useEffect(() => {
    if (!activeChatTabId) return;
    const tab = mainChatTabs.find((t) => t.id === activeChatTabId);
    if (!tab) return;
    setActiveSessionId((prev) => prev === (tab.sessionId ?? null) ? prev : tab.sessionId ?? null);
    if (tab.variant === "subagent") {
      setActiveSubagentKey((prev) => prev === (tab.sessionKey ?? null) ? prev : tab.sessionKey ?? null);
    } else {
      setActiveSubagentKey((prev) => prev === null ? prev : null);
    }
    if (tab.variant === "gateway") {
      setActiveGatewaySessionKey((prev) => prev === (tab.sessionKey ?? null) ? prev : tab.sessionKey ?? null);
    } else {
      setActiveGatewaySessionKey((prev) => prev === null ? prev : null);
    }
  }, [activeChatTabId, mainChatTabs]);

  const setMainChatPanelRef = useCallback((tabId: string, handle: ChatPanelHandle | null) => {
    chatPanelRefs.current[tabId] = handle;
  }, []);

  useEffect(() => {
    chatRef.current = visibleMainChatTabId ? chatPanelRefs.current[visibleMainChatTabId] ?? null : null;
  }, [visibleMainChatTabId]);

  const handleChatRuntimeStateChange = useCallback((tabId: string, runtime: ChatPanelRuntimeState) => {
    setChatRuntimeSnapshots((prev) =>
      mergeChatRuntimeSnapshot(prev, {
        tabId,
        ...runtime,
      }),
    );
  }, []);

  const handleChatTabSessionChange = useCallback((tabId: string, sessionId: string | null) => {
    dispatch({ type: "bindChatSession", tabId, sessionId });
    if (visibleMainChatTabId === tabId || activeChatTabId === tabId) {
      setActiveSessionId(sessionId);
      setActiveSubagentKey(null);
    }
  }, [visibleMainChatTabId, activeChatTabId]);

  const sendMessageInChatTab = useCallback((tabId: string, message: string) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void chatPanelRefs.current[tabId]?.sendNewMessage(message);
      });
    });
  }, []);

  const handleStartDashboardTemplate = useCallback(
    (templateId: SkillTemplateId) => {
      setTemplatesPanelOpen(false);
      startSkillTemplateChatFromDashboard({
        templateId,
        openChatTab: openPermanentBlankChatTab,
        sendMessageInChatTab,
      });
    },
    [openPermanentBlankChatTab, sendMessageInChatTab],
  );

  // Navigate to a subagent panel when its card is clicked in the chat.
  // The identifier may be a childSessionKey (preferred) or a task label (legacy fallback).
  const handleSubagentClickFromChat = useCallback((identifier: string) => {
    const byKey = subagents.find((sa) => sa.childSessionKey === identifier);
    if (byKey) {
      openSubagentChatTab({
        sessionKey: byKey.childSessionKey,
        parentSessionId: byKey.parentSessionId,
        title: byKey.label || byKey.task,
      });
      return;
    }
    const byTask = subagents.find((sa) => sa.task === identifier);
    if (byTask) {
      openSubagentChatTab({
        sessionKey: byTask.childSessionKey,
        parentSessionId: byTask.parentSessionId,
        title: byTask.label || byTask.task,
      });
    }
  }, [openSubagentChatTab, subagents]);

  const handleSelectSubagent = useCallback((sessionKey: string) => {
    const subagent = subagents.find((entry) => entry.childSessionKey === sessionKey);
    if (!subagent) {
      return;
    }
    openSubagentChatTab({
      sessionKey,
      parentSessionId: subagent.parentSessionId,
      title: subagent.label || subagent.task,
    });
  }, [openSubagentChatTab, subagents]);

  const handleBackFromSubagent = useCallback(() => {
    if (!activeSubagentKey) {
      return;
    }
    const activeChild = subagents.find((entry) => entry.childSessionKey === activeSubagentKey);
    if (activeChild) {
      openSessionChatTab(activeChild.parentSessionId);
      return;
    }
    setActiveSubagentKey(null);
  }, [activeSubagentKey, openSessionChatTab, subagents]);

  /**
   * Open or focus a content tab for a TreeNode (or a synthetic node like
   * `~cron`). Stable id = `node.path` so reopening the same path focuses the
   * existing tab; preview replacement happens atomically in the reducer.
   */
  const openTabForNode = useCallback((
    node: { path: string; name: string; type: string },
    options?: { preview?: boolean },
  ) => {
    const kind = nodeToContentTabKind(node.type, node.path);
    const isObject = kind === "object";
    const title = isObject
      ? displayObjectName(node.name)
      : inferContentTabTitle(node.path, node.name);
    dispatch({
      type: "openContent",
      tab: {
        id: contentTabIdFor(kind, node.path),
        kind,
        path: node.path,
        title,
        preview: options?.preview ?? true,
      },
    });
  }, []);

  // Resizable sidebar widths (desktop only; persisted in localStorage).
  // Use static defaults so server and client match on first render (avoid hydration mismatch).
  // New default is compact (icon-only); user can drag to expand into full mode.
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(LEFT_SIDEBAR_COMPACT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(520);
  useEffect(() => {
    const left = window.localStorage.getItem(STORAGE_LEFT);
    const nLeft = left ? parseInt(left, 10) : NaN;
    if (Number.isFinite(nLeft)) {
      // Snap loaded width into a valid mode (compact or full range).
      const snapped =
        nLeft < LEFT_SIDEBAR_COMPACT_THRESHOLD
          ? LEFT_SIDEBAR_COMPACT_WIDTH
          : clamp(nLeft, LEFT_SIDEBAR_FULL_MIN, LEFT_SIDEBAR_MAX);
      setLeftSidebarWidth(snapped);
    }
    const right = window.localStorage.getItem(STORAGE_RIGHT_PANEL);
    const nRight = right ? parseInt(right, 10) : NaN;
    if (Number.isFinite(nRight)) {
      setRightPanelWidth(clamp(nRight, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX));
    }
    const collapsed = window.localStorage.getItem(STORAGE_RIGHT_PANEL_COLLAPSED);
    if (collapsed === "0") {
      setRightPanelCollapsed(false);
    }
    const treeCollapsed = window.localStorage.getItem(STORAGE_FILE_TREE_COLLAPSED);
    if (treeCollapsed === "1") {
      setFileTreeCollapsed(true);
    }
  }, []);

  // Whether the left sidebar is in compact (icon-only) mode.
  const isLeftSidebarCompact = leftSidebarWidth < LEFT_SIDEBAR_FULL_MIN;
  const reservedLeftSidebarWidth = !isMobile && !leftSidebarCollapsed ? leftSidebarWidth : 0;
  const availableRightPanelMaxWidth = useMemo(() => {
    const totalWidth = layoutWidth || (typeof window !== "undefined" ? window.innerWidth : 0);
    if (!totalWidth) {
      return rightPanelWidth;
    }
    return clamp(
      totalWidth - reservedLeftSidebarWidth - CENTER_PANEL_MIN,
      RIGHT_PANEL_MIN,
      RIGHT_PANEL_MAX,
    );
  }, [layoutWidth, reservedLeftSidebarWidth, rightPanelWidth]);
  // Right panel width contract — three values, three concerns:
  //   - rightPanelWidth          → user's saved preference (persisted to localStorage,
  //                                only mutated by the resize handle). Never used as a
  //                                rendered width directly.
  //   - renderedRightPanelWidth  → preference clamped to currently-available space.
  //                                Used as the inner content width so right-panel pages
  //                                instantly reflow when the left sidebar opens/closes,
  //                                instead of overflowing and getting clipped by the
  //                                outer aside's overflow-hidden.
  //   - effectiveRightPanelWidth → renderedRightPanelWidth, but 0 while collapsed.
  //                                Used as the OUTER aside width so collapse animates
  //                                smoothly (outer wipes over inner; inner stays at
  //                                rendered width during the 200ms transition).
  const renderedRightPanelWidth = Math.min(rightPanelWidth, availableRightPanelMaxWidth);
  const effectiveRightPanelWidth = rightPanelCollapsed ? 0 : renderedRightPanelWidth;

  // Snap-aware resize handler: dragging below the compact threshold snaps to icon mode;
  // dragging into the gap between threshold and full min snaps to full min.
  const handleLeftSidebarResize = useCallback((w: number) => {
    if (w < LEFT_SIDEBAR_COMPACT_THRESHOLD) {
      setLeftSidebarWidth(LEFT_SIDEBAR_COMPACT_WIDTH);
    } else if (w < LEFT_SIDEBAR_FULL_MIN) {
      setLeftSidebarWidth(LEFT_SIDEBAR_FULL_MIN);
    } else {
      setLeftSidebarWidth(clamp(w, LEFT_SIDEBAR_FULL_MIN, LEFT_SIDEBAR_MAX));
    }
  }, []);

  // Toggle handler for keyboard shortcut and the sidebar's expand/collapse button.
  const toggleLeftSidebarCompact = useCallback(() => {
    setLeftSidebarWidth((current) =>
      current < LEFT_SIDEBAR_FULL_MIN ? LEFT_SIDEBAR_FULL_DEFAULT : LEFT_SIDEBAR_COMPACT_WIDTH,
    );
  }, []);
  useEffect(() => {
    window.localStorage.setItem(STORAGE_LEFT, String(leftSidebarWidth));
  }, [leftSidebarWidth]);
  useEffect(() => {
    window.localStorage.setItem(STORAGE_RIGHT_PANEL, String(rightPanelWidth));
  }, [rightPanelWidth]);
  useEffect(() => {
    window.localStorage.setItem(STORAGE_RIGHT_PANEL_COLLAPSED, rightPanelCollapsed ? "1" : "0");
  }, [rightPanelCollapsed]);
  useEffect(() => {
    window.localStorage.setItem(STORAGE_FILE_TREE_COLLAPSED, fileTreeCollapsed ? "1" : "0");
  }, [fileTreeCollapsed]);

  // Keyboard shortcuts: Cmd+B = toggle left sidebar, Cmd+Shift+B = toggle right sidebar, Cmd+J = toggle terminal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "b") {
        e.preventDefault();
        if (e.shiftKey) {
          setRightPanelCollapsed((v) => !v);
        } else {
          setLeftSidebarCollapsed((v) => !v);
        }
        return;
      }

      if (mod && key === "e" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setFileTreeCollapsed((v) => !v);
        return;
      }

      if (mod && key === "j" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setTerminalOpen((v) => !v);
        return;
      }

      if (mod && key === "w" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        tabCloseActiveRef.current?.();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Derive file context for chat sidebar directly from activePath (stable across loading).
  // Exclude reserved virtual paths (~chats, ~cron, etc.) where file-scoped chat is irrelevant.
  const fileContext = useMemo(() => {
    if (!activePath) { return undefined; }
    // v3: include virtual paths (~crm/*, ~cloud, ~skills, ~integrations, ~cron, etc.) so
    // the agent is aware when the user is viewing CRM tables, cloud settings, etc.
    const filename = (() => {
      if (activePath.startsWith("~crm/")) {
        const view = activePath.slice("~crm/".length);
        return `CRM ${view.charAt(0).toUpperCase()}${view.slice(1)}`;
      }
      if (activePath === "~cloud") return "Cloud settings";
      if (activePath === "~integrations") return "Integrations panel";
      if (activePath === "~skills") return "Skills store";
      if (activePath === "~cron") return "Cron dashboard";
      if (activePath.startsWith("~cron/")) return `Cron job ${activePath.slice("~cron/".length)}`;
      return activePath.split("/").pop() || activePath;
    })();
    const isDirectory =
      activeContentTab?.kind === "directory" ||
      activeContentTab?.kind === "browse" ||
      isVirtualPath(activePath) ||
      activeContentTab?.kind === "crm-inbox" ||
      activeContentTab?.kind === "crm-calendar";
    return { path: activePath, filename, isDirectory, tableSelection: tableSelectionContext ?? undefined };
  }, [activePath, activeContentTab?.kind, tableSelectionContext]);

  // Live reload from the agent: ContentRenderer/useTabContent owns the live
  // file payload now, so this stub simply forces a refresh of the active tab
  // when the file under it changes on disk. The cache is invalidated lazily
  // by the SSE-driven tree refresh.
  const handleFileChanged = useCallback((_newContent: string) => {
    // No-op: `useTabContent` re-fetches when its tab changes; live in-place
    // edits during streaming are handled inside ContentRenderer's children.
  }, []);

  const refreshContext = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace/context");
      const data = await res.json();
      setContext(data);
    } catch {
      // ignore
    }
  }, []);

  // Fetch workspace context on mount
  useEffect(() => {
    void refreshContext();
  }, [refreshContext]);

  // Fetch chat sessions
  // v3: keep file-scoped sessions too — the per-file session strip is gone, so
  // every non-subagent chat lives in the unified history dropdown now.
  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/web-sessions?includeAll=true");
      const data = await res.json();
      const all: WebSession[] = data.sessions ?? [];
      setSessions(all);
    } catch {
      // ignore
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions, sidebarRefreshKey]);

  const refreshSessions = useCallback(() => {
    setSidebarRefreshKey((k) => k + 1);
  }, []);

  // Fetch gateway channel sessions
  const fetchGatewaySessions = useCallback(async () => {
    try {
      const res = await fetch("/api/gateway/sessions");
      const data = await res.json();
      const sessions: SidebarGatewaySession[] = (data.sessions ?? []).map(
        (s: { sessionKey: string; sessionId: string; channel: string; origin?: { label?: string; provider?: string }; updatedAt: number }) => ({
          sessionKey: s.sessionKey,
          sessionId: s.sessionId,
          channel: s.channel,
          title: s.origin?.label || `${s.channel.charAt(0).toUpperCase() + s.channel.slice(1)} Session`,
          updatedAt: s.updatedAt,
          origin: s.origin,
        }),
      );
      setGatewaySessions(sessions);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void fetchGatewaySessions();
    const gwInterval = setInterval(fetchGatewaySessions, 10_000);
    return () => { clearInterval(gwInterval); };
  }, [fetchGatewaySessions]);

  const handleWorkspaceChanged = useCallback(() => {
    // The newly-active workspace may not be onboarded yet (e.g. a fresh
    // workspace someone just created, or one they hadn't finished setting
    // up). The home page server component only checks onboarding on its
    // initial render, so a soft in-place reset would strand the user on `/`
    // looking at a half-empty UI. Probe `/api/onboarding/state` first and
    // hard-navigate to `/onboarding` when the new workspace still needs it;
    // otherwise fall through to the smooth in-memory reset.
    void (async () => {
      try {
        const res = await fetch("/api/onboarding/state", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { currentStep?: string };
          if (data.currentStep && data.currentStep !== "complete") {
            window.location.assign("/onboarding");
            return;
          }
        }
      } catch {
        // Network/parse failure: fall through to soft reset rather than
        // trapping the user — the next refresh will surface onboarding.
      }
      resetWorkspaceStateOnSwitch({
        setBrowseDir,
        clearActiveContent: () => dispatch({ type: "activateContent", id: null }),
        setActiveSessionId,
        setActiveSubagentKey,
        resetMainChat: () => {
          chatPanelRefs.current = {};
          setChatRuntimeSnapshots({});
          setChatRunsSnapshot(createChatRunsSnapshot({ parentRuns: [], subagents: [] }));
          setStreamingSessionIds(new Set());
          setSubagents([]);
          dispatch({ type: "replace", state: ensureChatPresent(EMPTY_TABS_STATE) });
        },
        replaceUrlToRoot: () => {
          // URL sync effect will write the correct URL after state is cleared
        },
        reconnectWorkspaceWatcher,
        refreshSessions,
        refreshContext: () => {
          void refreshContext();
        },
      });
    })();
  }, [reconnectWorkspaceWatcher, refreshContext, refreshSessions, router, setBrowseDir]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const res = await fetch(`/api/web-sessions/${sessionId}`, { method: "DELETE" });
      if (!res.ok) {return;}
      const closedTabIds = new Set(
        tabsStateRef.current.chatTabs
          .filter((tab) => tab.sessionId === sessionId || tab.parentSessionId === sessionId)
          .map((tab) => tab.id),
      );
      // The reducer's `closeChatsForSession` automatically re-creates a draft
      // when the deletion would empty the chat strip, preserving the
      // ensureChatPresent invariant.
      dispatch({ type: "closeChatsForSession", sessionId });
      setChatRuntimeSnapshots((prev) => {
        let next = prev;
        for (const tabId of closedTabIds) {
          next = removeChatRuntimeSnapshot(next, tabId);
        }
        return next;
      });
      if (activeSessionId === sessionId) {
        const remaining = sessions.filter((s) => s.id !== sessionId);
        if (remaining.length > 0) {
          openSessionChatTab(remaining[0].id, remaining[0].title);
        } else {
          openBlankChatTab();
        }
      }
      void fetchSessions();
    },
    [activeSessionId, sessions, fetchSessions, openBlankChatTab, openSessionChatTab],
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, newTitle: string) => {
      await fetch(`/api/web-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      void fetchSessions();
    },
    [fetchSessions],
  );

  // Poll for parent/subagent run state so tabs and sidebars can reflect
  // background activity across all open chats.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/chat/runs");
        if (cancelled) {return;}
        const data = await res.json();
        const parentRuns: Array<{ sessionId: string; status: "running" | "waiting-for-subagents" | "completed" | "error" }> = data.parentRuns ?? [];
        const nextSubagents: SubagentSpawnInfo[] = data.subagents ?? [];
        const ids = parentRuns
          .filter((run) => run.status === "running" || run.status === "waiting-for-subagents")
          .map((run) => run.sessionId);
        setChatRunsSnapshot(createChatRunsSnapshot({
          parentRuns,
          subagents: nextSubagents.map((subagent) => ({
            childSessionKey: subagent.childSessionKey,
            status: subagent.status ?? "completed",
          })),
        }));
        setSubagents(nextSubagents);
        setStreamingSessionIds((prev) => {
          // Only update state if the set actually changed (avoid re-renders).
          if (prev.size === ids.length && ids.every((id) => prev.has(id))) {return prev;}
          return new Set(ids);
        });
      } catch {
        // ignore
      }
    };
    void poll();
    const id = setInterval(poll, 3_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Fetch cron jobs for sidebar
  const fetchCronJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/cron/jobs");
      const data: CronJobsResponse = await res.json();
      setCronJobs(data.jobs ?? []);
    } catch {
      // ignore - cron might not be configured
    }
  }, []);

  useEffect(() => {
    void fetchCronJobs();
    const id = setInterval(fetchCronJobs, 30_000);
    return () => clearInterval(id);
  }, [fetchCronJobs]);

  // Closing the entry-detail panel is mutually exclusive with opening any
  // content tab. We dispatch this alongside `openContent`/`activateContent`
  // so the panel doesn't float on top of newly-loaded content.
  const closeEntryModalIfOpen = useCallback(() => {
    setEntryModal((prev) => (prev ? null : prev));
  }, []);

  // Whether DuckDB is missing — surfaced from `useTabContent` via
  // `RightPanelContent` so the placeholder UI can react.
  const handleDuckDBMissing = useCallback(() => {
    // The render layer reads `content.kind === "duckdb-missing"` and shows
    // the install prompt. Nothing extra to do here.
  }, []);

  // Open the right panel and widen it so the chat stays at its min width.
  // Used when the user clicks something that needs the right panel to be visible.
  const ensureRightPanelOpenWide = useCallback(() => {
    if (typeof window === "undefined") {
      setRightPanelCollapsed(false);
      return;
    }
    const totalWidth = layoutRef.current?.clientWidth ?? window.innerWidth;
    const ideal = totalWidth - reservedLeftSidebarWidth - CENTER_PANEL_MIN;
    const wideTarget = clamp(ideal, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX);
    setRightPanelCollapsed(false);
    setRightPanelWidth((current) => Math.max(current, wideTarget));
  }, [reservedLeftSidebarWidth]);

  const handleNavigate = useCallback(
    (
      target:
        | "cloud"
        | "integrations"
        | "skills"
        | "cron"
        | "crm-people"
        | "crm-companies"
        | "crm-inbox"
        | "crm-calendar",
    ) => {
      // Make sure the right panel is open and wide enough to actually use
      // when the user clicks one of the data tabs (People, Companies, etc.).
      // Without this, clicking a tab does nothing visible if the panel is
      // collapsed.
      ensureRightPanelOpenWide();

      // People / Companies render through the standard ObjectView pipeline
      // (same path as `?path=<custom-object>`), so the toolbar, table, saved
      // views, and column controls match every other CRM object.
      if (target === "crm-people" || target === "crm-companies") {
        const objectName = target === "crm-people" ? "people" : "company";
        const node = resolveCrmObjectNode(tree, objectName);
        // preview: false → each left-sidebar click opens a NEW persistent
        // tab instead of replacing the existing preview tab. If the tab is
        // already open, the reducer focuses it.
        openTabForNode(node, { preview: false });
        closeEntryModalIfOpen();
        return;
      }

      // Map sidebar nav targets directly to content tabs in the new model.
      const config = {
        cloud: { path: "~cloud", name: "Cloud" },
        integrations: { path: "~integrations", name: "Integrations" },
        skills: { path: "~skills", name: "Skills" },
        cron: { path: "~cron", name: "Cron" },
        "crm-inbox": { path: "~crm/inbox", name: "Inbox" },
        "crm-calendar": { path: "~crm/calendar", name: "Calendar" },
      }[target];
      openTabForNode({ path: config.path, name: config.name, type: "folder" }, { preview: false });
      closeEntryModalIfOpen();
    },
    [openTabForNode, tree, ensureRightPanelOpenWide, closeEntryModalIfOpen],
  );

  const handleComposioActionFromChat = useCallback((action: ComposioChatAction) => {
    setPendingComposioAction({
      action: action.action,
      toolkitSlug: action.toolkitSlug ?? null,
      toolkitName: action.toolkitName ?? null,
    });
  }, []);

  const handleComposioActionHandled = useCallback(() => {
    setPendingComposioAction(null);
  }, []);

  const handleComposioFallbackToIntegrations = useCallback(() => {
    handleNavigate("integrations");
  }, [handleNavigate]);

  const handleNodeSelect = useCallback(
    (node: TreeNode) => {
      // --- Browse-mode: detect special OpenClaw directories ---
      // When the user clicks a known OpenClaw folder while browsing the
      // filesystem, switch back to workspace mode or show the appropriate
      // dashboard instead of showing raw files.
      if (browseDir && isAbsolutePath(node.path)) {
        // Clicking the workspace root → restore full workspace mode
        if (workspaceRoot && node.path === workspaceRoot) {
          setBrowseDir(null);
          return;
        }
        if (openclawDir) {
          // Clicking any web-chat directory → switch to workspace mode & open chats
          if (openclawDir && node.path.startsWith(openclawDir + "/web-chat")) {
            setBrowseDir(null);
            dispatch({ type: "activateContent", id: null });
            openBlankChatTab();
            return;
          }
        }
        // Clicking a folder in browse mode → navigate into it so the tree
        // is fetched fresh, AND show it in the main panel with the chat sidebar.
        // The browse tab keys off `browse:<absolute-path>` so successive
        // browse navigation reuses the same slot.
        if (node.type === "folder") {
          setBrowseDir(node.path);
          dispatch({
            type: "openContent",
            tab: {
              id: contentTabIdFor("browse", node.path, { browsePath: node.path }),
              kind: "browse",
              path: node.path,
              title: node.name,
              meta: { browsePath: node.path },
              preview: true,
            },
          });
          closeEntryModalIfOpen();
          return;
        }
      }

      // --- Virtual path handlers (workspace mode) ---
      if (node.path.startsWith("~chats/")) {
        const sessionId = node.path.slice("~chats/".length);
        openSessionChatTab(sessionId);
        return;
      }
      if (node.path === "~chats") {
        openBlankChatTab();
        return;
      }
      if (node.path === "~skills") { handleNavigate("skills"); return; }
      if (node.path === "~integrations") { handleNavigate("integrations"); return; }
      if (node.path === "~cloud") { handleNavigate("cloud"); return; }
      if (node.path === "~cron" || node.path.startsWith("~cron/")) {
        openTabForNode(node);
        closeEntryModalIfOpen();
        return;
      }
      // Workspace-mode folders are expanded/collapsed inline in the sidebar
      // tree — don't open them in the main content panel.
      if (node.type === "folder") {
        return;
      }
      openTabForNode(node);
      closeEntryModalIfOpen();
    },
    [openBlankChatTab, openSessionChatTab, openTabForNode, browseDir, workspaceRoot, openclawDir, setBrowseDir, handleNavigate, closeEntryModalIfOpen],
  );

  // Tab handler callbacks — pure dispatches into the tabs reducer.
  const handleTabActivate = useCallback((tabId: string) => {
    // ids are unique across content + chat tabs.
    const isContent = tabsStateRef.current.contentTabs.some((t) => t.id === tabId);
    if (isContent) {
      closeEntryModalIfOpen();
      dispatch({ type: "activateContent", id: tabId });
    } else {
      dispatch({ type: "activateChat", id: tabId });
    }
  }, [closeEntryModalIfOpen]);

  const handleTabClose = useCallback((tabId: string) => {
    const isContent = tabsStateRef.current.contentTabs.some((t) => t.id === tabId);
    if (isContent) {
      dispatch({ type: "closeContent", id: tabId });
    } else {
      dispatch({ type: "closeChat", id: tabId });
    }
  }, []);

  // Keep ref in sync so keyboard shortcut can close active tab
  useEffect(() => {
    tabCloseActiveRef.current = () => {
      if (tabsState.activeContentId) {
        handleTabClose(tabsState.activeContentId);
      } else if (tabsState.activeChatId) {
        handleTabClose(tabsState.activeChatId);
      }
    };
  }, [tabsState.activeContentId, tabsState.activeChatId, handleTabClose]);

  const handleTabCloseOthers = useCallback((tabId: string) => {
    const isContent = tabsStateRef.current.contentTabs.some((t) => t.id === tabId);
    if (isContent) {
      dispatch({ type: "closeOtherContent", id: tabId });
    }
  }, []);

  const handleTabCloseToRight = useCallback((tabId: string) => {
    const isContent = tabsStateRef.current.contentTabs.some((t) => t.id === tabId);
    if (isContent) {
      dispatch({ type: "closeContentToRight", id: tabId });
    }
  }, []);

  const handleTabCloseAll = useCallback(() => {
    dispatch({ type: "closeAllContent" });
    setActiveSessionId(null);
    setActiveSubagentKey(null);
    setEntryModal(null);
  }, []);

  const handleTabReorder = useCallback((tabId: string, _from: number, to: number) => {
    const isContent = tabsStateRef.current.contentTabs.some((t) => t.id === tabId);
    if (isContent) {
      dispatch({ type: "promoteContent", id: tabId });
      dispatch({ type: "reorderContent", id: tabId, toIndex: to });
    }
  }, []);

  const handleTabTogglePin = useCallback((tabId: string) => {
    const isContent = tabsStateRef.current.contentTabs.some((t) => t.id === tabId);
    if (isContent) {
      dispatch({ type: "togglePinContent", id: tabId });
    } else {
      dispatch({ type: "togglePinChat", id: tabId });
    }
  }, []);

  // Open inline file-path mentions from chat in a new workspace tab.
  const handleFilePathClickFromChat = useCallback(
    async (rawPath: string) => {
      const inputPath = normalizeChatPath(rawPath);
      if (!inputPath) {return false;}

      const openNode = (node: TreeNode) => {
        handleNodeSelect(node);
        return true;
      };

      // For workspace-relative paths, prefer the live tree so we preserve semantics.
      if (
        !isAbsolutePath(inputPath) &&
        !isHomeRelativePath(inputPath) &&
        !inputPath.startsWith("./") &&
        !inputPath.startsWith("../")
      ) {
        const node = resolveNode(tree, inputPath);
        if (node) {
          return openNode(node);
        }
      }

      try {
        const res = await fetch(`/api/workspace/path-info?path=${encodeURIComponent(inputPath)}`);
        if (!res.ok) {return false;}
        const info = await res.json() as {
          path?: string;
          name?: string;
          type?: "file" | "directory" | "other";
        };
        if (!info.path || !info.name || !info.type) {return false;}

        // If this absolute path is inside the current workspace, map it
        // back to a workspace-relative node first.
        if (workspaceRoot && (info.path === workspaceRoot || info.path.startsWith(`${workspaceRoot}/`))) {
          const relPath = info.path === workspaceRoot ? "" : info.path.slice(workspaceRoot.length + 1);
          if (relPath) {
            const node = resolveNode(tree, relPath);
            if (node) {
              return openNode(node);
            }
          }
        }

        if (info.type === "directory") {
          const dirNode: TreeNode = { name: info.name, path: info.path, type: "folder" };
          return openNode(dirNode);
        }

        if (info.type === "file") {
          const fileNode: TreeNode = {
            name: info.name,
            path: info.path,
            type: inferNodeTypeFromFileName(info.name),
          };
          return openNode(fileNode);
        }
      } catch {
        // Ignore -- chat message bubble shows inline error state.
      }

      return false;
    },
    [tree, handleNodeSelect, workspaceRoot],
  );

  // Paths that should stay out of the CRM nav because they already have
  // dedicated product pages. The file tree itself should show every table.
  const CRM_HIDDEN_TREE_PATHS = useMemo(() => new Set([
    "people",
    "company",
    "companies",
    "email_thread",
    "email_message",
    "calendar_event",
    "interaction",
  ]), []);
  const enhancedTree = tree;
  // The sidebar-nav version: only strips the hardcoded CRM tables (which
  // have their own dedicated pages) so custom objects like `task` still
  // show up under "Home" as dynamic CRM entries.
  const sidebarNavTree = useMemo(
    () => tree.filter((node) => !CRM_HIDDEN_TREE_PATHS.has(node.path)),
    [tree, CRM_HIDDEN_TREE_PATHS],
  );

  // Compute the effective parentDir for ".." navigation.
  // In browse mode: use browseParentDir from the API.
  // In workspace mode: use the parent of the workspace root (allows escaping workspace).
  const effectiveParentDir = useMemo(() => {
    if (browseDir) {
      return browseParentDir;
    }
    // In workspace mode, allow ".." to go up from workspace root
    if (workspaceRoot) {
      const parent = workspaceRoot === "/" ? null : workspaceRoot.split("/").slice(0, -1).join("/") || "/";
      return parent;
    }
    return null;
  }, [browseDir, browseParentDir, workspaceRoot]);

  // Handle ".." navigation
  const handleNavigateUp = useCallback(() => {
    if (effectiveParentDir != null) {
      setBrowseDir(effectiveParentDir);
    }
  }, [effectiveParentDir, setBrowseDir]);

  // Return to workspace mode
  const handleGoHome = useCallback(() => {
    setBrowseDir(null);
  }, [setBrowseDir]);

  // Navigate to the main chat / home panel. v3: does not touch right panel state.
  const handleGoToChat = useCallback(() => {
    setActiveSessionId(null);
    setActiveSubagentKey(null);
    setActiveGatewaySessionKey(null);
    // Ensure a draft chat tab is present and focus it; the reducer's
    // `ensureChatPresent` handles the empty-strip case.
    const drafts = tabsStateRef.current.chatTabs.filter((t) => t.variant === "draft");
    if (drafts.length === 0) {
      const tab = createDraftChatTab();
      dispatch({ type: "openChat", tab: { ...tab, preview: true } });
    } else {
      dispatch({ type: "activateChat", id: drafts[0].id });
    }
  }, []);

  // Insert a file mention into the chat editor when a sidebar item is dropped on the chat input.
  const handleSidebarExternalDrop = useCallback((node: TreeNode) => {
    chatRef.current?.insertFileMention?.(node.name, node.path);
  }, []);

  // Handle file search selection: navigate sidebar to the file's location and open it
  const handleFileSearchSelect = useCallback(
    (item: { name: string; path: string; type: string }) => {
      const itemPath = browseDir == null && workspaceRoot && item.path.startsWith(workspaceRoot + "/")
        ? item.path.slice(workspaceRoot.length + 1)
        : item.path;
      const node: TreeNode = {
        name: item.name,
        path: itemPath,
        type: item.type as TreeNode["type"],
      };
      if (item.type === "folder" && browseDir != null) {
        setBrowseDir(item.path);
      } else if (item.type !== "folder" && browseDir != null) {
        const parentOfFile = item.path.split("/").slice(0, -1).join("/") || "/";
        setBrowseDir(parentOfFile);
      }
      openTabForNode(node);
      closeEntryModalIfOpen();
    },
    [browseDir, workspaceRoot, setBrowseDir, openTabForNode, closeEntryModalIfOpen],
  );

  // (URL sync moved below into the single bidirectional projection.)

  // Terminal URL sync — independent of workspace hydration so it works app-wide.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const current = params.get("terminal") === "1";
    if (current === terminalOpen) return;
    if (terminalOpen) {
      params.set("terminal", "1");
    } else {
      params.delete("terminal");
    }
    const qs = params.toString();
    const url = qs ? `/?${qs}` : "/";
    window.history.replaceState(window.history.state, "", url);
  }, [terminalOpen]);

  // Open entry modal handler
  const handleOpenEntry = useCallback(
    (objectName: string, entryId: string, relatedObjectId?: string) => {
      // People + Company entries swap the MAIN panel for an Attio-style
      // profile (mirroring dench-2025's base-object-vs-generic-object
      // pattern). All other objects keep the existing side-panel modal.
      // The parent tab points at the resolved workspace object so the
      // back-to-list affordance lands on the unified ObjectView.
      //
      // Routing precedence:
      //   1. `relatedObjectId` (when provided by a relation chip) is the
      //      authoritative signal — comparing against the seed CRM object
      //      IDs avoids false positives where a custom user object happens
      //      to be named "company" / "companies" / "people".
      //   2. Fallback to raw `objectName` matching for direct nav (URL
      //      hydration, sidebar Companies/People entries) where no
      //      relation field id is available.
      const isSeedPerson = relatedObjectId
        ? isSeedPeopleObjectId(relatedObjectId)
        : objectName === "people";
      const isSeedCompany = relatedObjectId
        ? isSeedCompanyObjectId(relatedObjectId)
        : objectName === "company" || objectName === "companies";
      if (isSeedPerson) {
        // Person profile is its own content tab kind; the URL effect serializes
        // the open profile back to `?entry=people:<id>` automatically.
        dispatch({
          type: "openContent",
          tab: {
            id: contentTabIdFor("crm-person", "people", { entryId }),
            kind: "crm-person",
            path: "people",
            title: "Person",
            meta: { entryId },
            preview: true,
          },
        });
        setEntryModal(null);
      } else if (isSeedCompany) {
        dispatch({
          type: "openContent",
          tab: {
            id: contentTabIdFor("crm-company", "company", { entryId }),
            kind: "crm-company",
            path: "company",
            title: "Company",
            meta: { entryId },
            preview: true,
          },
        });
        setEntryModal(null);
      } else {
        // Generic objects keep the side-panel modal flow.
        setEntryModal({ objectName, entryId });
      }
    },
    [],
  );

  // Close entry modal handler — URL sync effect drops `?entry=` automatically.
  const handleCloseEntry = useCallback(() => {
    setEntryModal(null);
  }, []);

  const handleProfileTabChange = useCallback((profileTab: string) => {
    const activeId = tabsStateRef.current.activeContentId;
    if (!activeId) {return;}
    dispatch({ type: "updateContentMeta", id: activeId, meta: { profileTab } });
  }, []);

  // -- URL <-> state bidirectional projection ------------------------------
  //
  // The new model has a SINGLE projection function (`projectUrlState`) and a
  // SINGLE applier (`applyUrlToState`). The URL is a pure derivation of the
  // tabs reducer state plus shell flags; hydration / popstate apply the URL
  // back through the same `applyUrl` action. There is no `lastPushedQs`
  // bookkeeping or `postHydrationRender` flag — both are unnecessary because
  // the reducer is idempotent (re-applying the same URL state is a no-op).

  /** Build a URL kind resolver that uses the live workspace tree. */
  const buildShellUrlState = useCallback(() => ({
    resolveKind: (path: string): ContentTabKind | null => {
      const node = resolveNode(tree, path);
      if (node) return nodeToContentTabKind(node.type, node.path);
      // CRM legacy paths route through the canonical object names.
      if (path.startsWith("~crm/")) {
        const view = path.slice("~crm/".length).split("/")[0];
        if (view === "people" || view === "companies") return "object";
      }
      return null;
    },
  }), [tree]);

  // state -> URL: dispatched on every tabs/shell-state change. Compares to
  // `window.location.search` to avoid a circular dependency loop with
  // `useSearchParams`.
  useEffect(() => {
    if (hydrationPhase.current !== "hydrated") return;
    if (postHydrationRender.current) {
      postHydrationRender.current = false;
      return;
    }

    const projected = projectUrlState(tabsState, {
      chatSessionId: activeSessionId,
      chatSubagentKey: activeSubagentKey,
      entryModal,
      browseDir,
      showHidden,
      terminalOpen,
      cron: {
        view: cronView,
        calMode: cronCalMode,
        date: cronDate,
        runFilter: cronRunFilter,
        run: cronRun,
      },
    });
    // Object-view state (search / filters / sort / view / cols / page) is
    // owned by the per-table ObjectView and lives in the URL. The shell
    // doesn't know those values, but it must not stomp them when it
    // re-projects the URL for unrelated state changes. The merge helper
    // carries them over only when the active table path is unchanged so
    // switching tables drops the previous table's view state.
    const current = new URLSearchParams(window.location.search);
    const merged = mergePreservedTableView(projected, current);
    const nextQs = serializeUrlState(merged);
    const currentQs = current.toString();
    if (nextQs !== currentQs) {
      const url = nextQs ? `/?${nextQs}` : "/";
      router.push(url, { scroll: false });
    }
  }, [
    tabsState,
    activeSessionId,
    activeSubagentKey,
    entryModal,
    browseDir,
    showHidden,
    terminalOpen,
    cronView,
    cronCalMode,
    cronDate,
    cronRunFilter,
    cronRun,
    router,
  ]);

  // URL -> state: hydrate once when tree + tabs have loaded, then re-apply on
  // popstate. Both paths funnel through the reducer's `applyUrl` action.
  useEffect(() => {
    if (hydrationPhase.current !== "init") return;
    if (treeLoading || tree.length === 0) return;
    if (tabLoadedForWorkspace.current !== (workspaceName || null)) return;

    const urlState = parseUrlState(searchParams);
    const shell = buildShellUrlState();
    dispatch({ type: "applyUrl", url: urlState, shell });

    // Chat-only URLs route to `openChat` so the chat strip can mount the
    // requested session/subagent.
    if (!urlState.path && !urlState.crm && !urlState.entry && urlState.chat) {
      if (urlState.subagent) {
        openSubagentChatTab({
          sessionKey: urlState.subagent,
          parentSessionId: urlState.chat,
          title: "Subagent",
        });
      } else {
        openSessionChatTab(urlState.chat);
      }
    }
    if (urlState.entry && urlState.entry.objectName !== "people" && urlState.entry.objectName !== "company" && urlState.entry.objectName !== "companies") {
      setEntryModal(urlState.entry);
    }
    if (urlState.browse) setBrowseDir(urlState.browse);
    if (urlState.hidden) setShowHidden(true);
    if (urlState.terminal) setTerminalOpen(true);
    if (urlState.cronView) setCronView(urlState.cronView);
    if (urlState.cronCalMode) setCronCalMode(urlState.cronCalMode);
    if (urlState.cronDate) setCronDate(urlState.cronDate);
    if (urlState.cronRunFilter) setCronRunFilter(urlState.cronRunFilter);
    if (urlState.cronRun != null) setCronRun(urlState.cronRun);

    postHydrationRender.current = true;
    hydrationPhase.current = "hydrated";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs exactly once
  }, [tree, treeLoading, searchParams, workspaceName]);

  // popstate: same logic as hydration, but always runs.
  useEffect(() => {
    const handlePopState = () => {
      const urlState = parseUrlState(window.location.search);
      const shell = buildShellUrlState();
      dispatch({ type: "applyUrl", url: urlState, shell });

      if (!urlState.path && !urlState.crm && !urlState.entry && urlState.chat) {
        if (urlState.subagent) {
          openSubagentChatTab({
            sessionKey: urlState.subagent,
            parentSessionId: urlState.chat,
            title: "Subagent",
          });
        } else {
          openSessionChatTab(urlState.chat);
        }
      }
      if (urlState.entry && urlState.entry.objectName !== "people" && urlState.entry.objectName !== "company" && urlState.entry.objectName !== "companies") {
        setEntryModal(urlState.entry);
      } else {
        setEntryModal(null);
      }
      if (urlState.browse) {
        setBrowseDir(urlState.browse);
      } else if (!urlState.path || !isAbsolutePath(urlState.path)) {
        setBrowseDir(null);
      }
      setShowHidden(Boolean(urlState.hidden));
      setTerminalOpen(Boolean(urlState.terminal));
      if (urlState.cronView) setCronView(urlState.cronView);
      if (urlState.cronCalMode) setCronCalMode(urlState.cronCalMode);
      if (urlState.cronDate) setCronDate(urlState.cronDate);
      if (urlState.cronRunFilter) setCronRunFilter(urlState.cronRunFilter);
      if (urlState.cronRun != null) setCronRun(urlState.cronRun);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [buildShellUrlState, openSessionChatTab, openSubagentChatTab, setBrowseDir, setShowHidden]);

  // Cron job detail resolution lives in `useTabContent` now; the cron-job
  // tab's content state derives from the live `cronJobs` array each render,
  // so no separate effect is needed to backfill it after jobs arrive.

  // Handle ?send= URL parameter: open a new chat session and auto-send the message.
  // Used by the "Install DuckDB" button and similar in-app triggers.
  useEffect(() => {
    const sendParam = searchParams.get("send");
    if (!sendParam) {return;}

    // Clear the send param from the URL, preserving other params
    const params = new URLSearchParams(window.location.search);
    params.delete("send");
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });

    const tab = openBlankChatTab();
    sendMessageInChatTab(tab.id, sendParam);
  }, [openBlankChatTab, searchParams, router, sendMessageInChatTab]);

  // After onboarding, consume a selected starter template once and use the
  // same blank-chat path as other in-app auto-send entry points.
  useEffect(() => {
    if (searchParams.get("send")) {return;}
    if (
      skillTemplateHandoffCheckedRef.current ||
      skillTemplatePromptSentRef.current
    ) {
      return;
    }
    skillTemplateHandoffCheckedRef.current = true;

    async function consumeSkillTemplatePrompt() {
      try {
        const res = await fetch("/api/onboarding/skill-template/consume", {
          method: "POST",
        });
        if (!res.ok) {return;}
        const data = (await res.json()) as SkillTemplateConsumeResponse;
        if (
          typeof data.prompt !== "string" ||
          !data.prompt.trim() ||
          skillTemplatePromptSentRef.current
        ) {
          return;
        }
        skillTemplatePromptSentRef.current = true;
        const tab = openBlankChatTab();
        sendMessageInChatTab(tab.id, data.prompt);
      } catch {
        // This is a best-effort first-run handoff; the workspace should still load.
      }
    }

    void consumeSkillTemplatePrompt();
  }, [openBlankChatTab, searchParams, sendMessageInChatTab]);

  const formatBreadcrumbSegment = useCallback(
    (segment: string, partialPath: string) => {
      if (isAbsolutePath(partialPath)) return segment;
      const node = resolveNode(tree, partialPath);
      if (node?.type === "object") return displayObjectName(segment);
      return segment;
    },
    [tree],
  );

  const handleBreadcrumbNavigate = useCallback(
    (path: string) => {
      if (!path) {
        dispatch({ type: "activateContent", id: null });
        return;
      }

      // Absolute paths (browse mode): navigate the sidebar directly.
      // Intermediate parent folders aren't in the browse-mode tree, so
      // resolveNode would fail — call setBrowseDir to update the sidebar.
      if (isAbsolutePath(path)) {
        const name = path.split("/").pop() || path;
        setBrowseDir(path);
        dispatch({
          type: "openContent",
          tab: {
            id: contentTabIdFor("browse", path, { browsePath: path }),
            kind: "browse",
            path,
            title: name,
            meta: { browsePath: path },
            preview: true,
          },
        });
        return;
      }

      // Relative paths (workspace mode): resolve and navigate via handleNodeSelect
      // so virtual paths, chat context, etc. are all handled properly.
      const node = resolveNode(tree, path);
      if (node) {
        handleNodeSelect(node);
      }
    },
    [tree, handleNodeSelect, setBrowseDir],
  );

  // Navigate to an object by name (used by relation links)
  const handleNavigateToObject = useCallback(
    (objectName: string) => {
      function findObjectNode(nodes: TreeNode[]): TreeNode | null {
        for (const node of nodes) {
          if (node.type === "object" && objectNameFromPath(node.path) === objectName) {
            return node;
          }
          if (node.children) {
            const found = findObjectNode(node.children);
            if (found) {return found;}
          }
        }
        return null;
      }
      const node = findObjectNode(tree);
      if (node) {
        ensureRightPanelOpenWide();
        handleNodeSelect(node);
      }
    },
    [tree, handleNodeSelect, ensureRightPanelOpenWide],
  );

  /**
   * Unified navigate handler for links in the editor and read mode.
   * Handles /workspace?entry=..., /workspace?path=..., and legacy relative paths.
   */
  const handleEditorNavigate = useCallback(
    (href: string) => {
      // Try parsing as a workspace URL first (/workspace?entry=... or /workspace?path=...)
      const parsed = parseWorkspaceLink(href);
      if (parsed) {
        if (parsed.kind === "entry") {
          handleOpenEntry(parsed.objectName, parsed.entryId);
          return;
        }
        // File/object link -- resolve using the path from the URL
        const node = resolveNode(tree, parsed.path);
        if (node) {
          handleNodeSelect(node);
          return;
        }
      }

      // Fallback: treat as a raw relative path (legacy links)
      const node = resolveNode(tree, href);
      if (node) {
        handleNodeSelect(node);
      }
    },
    [tree, handleNodeSelect, handleOpenEntry],
  );

  // Refresh callback for the currently displayed object — exposed via the
  // hook's `refreshActive` callback inside RightPanelContent and surfaced to
  // ObjectView through onRefreshObject below. We hand the hook a ref so the
  // callback can be invoked without re-rendering.
  const refreshActiveRef = useRef<() => void>(() => {});
  const refreshCurrentObject = useCallback(async () => {
    refreshActiveRef.current();
  }, []);
  const handleRefreshActiveChange = useCallback((refresh: () => void) => {
    refreshActiveRef.current = refresh;
  }, []);

  // Auto-refresh the active object tab when the workspace tree updates.
  const prevTreeRef = useRef(tree);
  useEffect(() => {
    if (prevTreeRef.current === tree) return;
    prevTreeRef.current = tree;
    if (activeContentTab?.kind === "object") {
      refreshActiveRef.current();
    }
  }, [tree, activeContentTab?.kind]);

  // Top-level safety net: catch workspace link clicks anywhere in the page
  // to prevent full-page navigation and handle via client-side state instead.
  const handleContainerClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const link = target.closest("a");
      if (!link) {return;}
      const href = link.getAttribute("href");
      if (!href) {return;}
      // Intercept /workspace?... links to handle them in-app
      if (isWorkspaceLink(href)) {
        event.preventDefault();
        event.stopPropagation();
        handleEditorNavigate(href);
      }
    },
    [handleEditorNavigate],
  );

  // Cron navigation handlers — open / focus the appropriate cron tab. The
  // useTabContent hook resolves the actual cron job payload from the live
  // `cronJobs` list, so we only need to dispatch tab changes.
  const handleSelectCronJob = useCallback((jobId: string) => {
    const path = `~cron/${jobId}`;
    dispatch({
      type: "openContent",
      tab: {
        id: contentTabIdFor("cron-job", path, { cronJobId: jobId }),
        kind: "cron-job",
        path,
        title: jobId,
        meta: { cronJobId: jobId },
        preview: true,
      },
    });
  }, []);

  const handleBackToCronDashboard = useCallback(() => {
    dispatch({
      type: "openContent",
      tab: {
        id: "~cron",
        kind: "cron-dashboard",
        path: "~cron",
        title: "Cron",
        preview: true,
      },
    });
    setCronRunFilter("all");
    setCronRun(null);
  }, []);

  const handleCronSendCommand = useCallback((message: string) => {
    const tab = openBlankChatTab();
    sendMessageInChatTab(tab.id, message);
  }, [openBlankChatTab, sendMessageInChatTab]);

  // Derive the active session's title for the header / right sidebar
  const activeSessionTitle = useMemo(() => {
    if (!activeSessionId) {return undefined;}
    const s = sessions.find((sess) => sess.id === activeSessionId);
    return s?.title || undefined;
  }, [activeSessionId, sessions]);

  useEffect(() => {
    dispatch({ type: "syncChatTitles", sessions, subagents });
  }, [sessions, subagents]);

  // Promote the active draft chat tab's title to the (newly named) active
  // session title once the backend assigns one.
  useEffect(() => {
    if (!activeSessionTitle || !activeChatTabId) return;
    const active = tabsStateRef.current.chatTabs.find((t) => t.id === activeChatTabId);
    if (active && active.variant !== "subagent" && active.title !== activeSessionTitle) {
      dispatch({ type: "renameChat", id: active.id, title: activeSessionTitle });
    }
  }, [activeSessionTitle, activeChatTabId]);

  const runningSubagentKeys = useMemo(
    () => new Set(subagents.filter((subagent) => subagent.status === "running").map((subagent) => subagent.childSessionKey)),
    [subagents],
  );

  const liveChatTabIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of mainChatTabs) {
      const runtime = chatRuntimeSnapshots[tab.id];
      if (runtime?.isStreaming) {
        ids.add(tab.id);
        continue;
      }
      if (tab.sessionKey && (runningSubagentKeys.has(tab.sessionKey) || chatRunsSnapshot.subagentStatuses.get(tab.sessionKey) === "running")) {
        ids.add(tab.id);
        continue;
      }
      if (tab.sessionId && streamingSessionIds.has(tab.sessionId)) {
        ids.add(tab.id);
      }
    }
    return ids;
  }, [chatRunsSnapshot.subagentStatuses, chatRuntimeSnapshots, mainChatTabs, runningSubagentKeys, streamingSessionIds]);

  const optimisticallyStopParentSession = useCallback((sessionId: string) => {
    setStreamingSessionIds((prev) => {
      if (!prev.has(sessionId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    setSubagents((prev) => prev.map((subagent) =>
      subagent.parentSessionId === sessionId && subagent.status === "running"
        ? { ...subagent, status: "completed" }
        : subagent,
    ));
    setChatRuntimeSnapshots((prev) => {
      const next: Record<string, ChatTabRuntimeSnapshot> = {};
      for (const [tabId, snapshot] of Object.entries(prev)) {
        next[tabId] = snapshot.sessionId === sessionId
          ? { ...snapshot, isStreaming: false, isReconnecting: false, status: "ready" }
          : snapshot;
      }
      return next;
    });
  }, []);

  const optimisticallyStopSubagent = useCallback((sessionKey: string) => {
    setSubagents((prev) => prev.map((subagent) =>
      subagent.childSessionKey === sessionKey && subagent.status === "running"
        ? { ...subagent, status: "completed" }
        : subagent,
    ));
    setChatRuntimeSnapshots((prev) => {
      const next: Record<string, ChatTabRuntimeSnapshot> = {};
      for (const [tabId, snapshot] of Object.entries(prev)) {
        next[tabId] = snapshot.sessionKey === sessionKey
          ? { ...snapshot, isStreaming: false, isReconnecting: false, status: "ready" }
          : snapshot;
      }
      return next;
    });
  }, []);

  const stopParentSession = useCallback(async (sessionId: string) => {
    optimisticallyStopParentSession(sessionId);
    try {
      await fetch("/api/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, cascadeChildren: true }),
      });
    } catch {
      // Best-effort optimistic stop; polling will reconcile state.
    }
  }, [optimisticallyStopParentSession]);

  const stopSubagentSession = useCallback(async (sessionKey: string) => {
    optimisticallyStopSubagent(sessionKey);
    try {
      await fetch("/api/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey }),
      });
    } catch {
      // Best-effort optimistic stop; polling will reconcile state.
    }
  }, [optimisticallyStopSubagent]);

  const handleStopChatTab = useCallback((tabId: string) => {
    const tab = tabsStateRef.current.chatTabs.find((entry) => entry.id === tabId);
    if (!tab) return;
    if (tab.sessionKey) {
      void stopSubagentSession(tab.sessionKey);
      return;
    }
    if (tab.sessionId) {
      void stopParentSession(tab.sessionId);
    }
  }, [stopParentSession, stopSubagentSession]);

  // v3 three-column layout derived values.
  // - Center always renders the chat panel stack (one session at a time in the center).
  // - Right panel renders content tabs (files, CRM, cloud, etc.) in a single unified
  //   tab strip alongside the always-available Files sidebar. When no content tab is
  //   active the content area shows a placeholder while the file tree (if expanded)
  //   lets the user pick something.
  // contentTabs and the chat-tab presence invariants are now enforced by the
  // workspace-tabs reducer itself — there is no trackTab effect to race the
  // tabsState updates, no destructive cleanup effect to wipe activePath, and
  // no always-have-a-chat-tab effect (it lives in `ensureChatPresent` inside
  // the reducer). The previous v3 effects here have been deleted; their
  // intent is preserved by the reducer invariants.

  // Right-panel content tab handlers — pure dispatches.
  const handleContentTabActivate = useCallback((tabId: string) => {
    closeEntryModalIfOpen();
    dispatch({ type: "activateContent", id: tabId });
  }, [closeEntryModalIfOpen]);

  const handleContentTabClose = useCallback((tabId: string) => {
    dispatch({ type: "closeContent", id: tabId });
  }, []);

  // Custom CRM tables surfaced in the sidebar's CRM section. Derived from
  // the sidebar-scoped tree (which still contains object nodes) rather
  // than the file-tree-scoped one (which strips them).
  const customCrmObjects = useMemo(() => collectCrmObjectNodes(sidebarNavTree), [sidebarNavTree]);

  const sidebarCommonProps = {
    activePath: null,
    orgName: context?.organization?.name,
    browseDir,
    onFileSearchSelect: handleFileSearchSelect,
    searchFn: searchIndex,
    workspaceRoot,
    onGoToChat: handleGoToChat,
    activeWorkspace: workspaceName,
    onWorkspaceChanged: handleWorkspaceChanged,
    activeCrmTarget: (
      activeContentTab?.kind === "crm-person" ||
      (activeContentTab?.kind === "object" && activeContentTab.path === "people")
        ? "people" as const
        : activeContentTab?.kind === "crm-company" ||
          (activeContentTab?.kind === "object" &&
            (activeContentTab.path === "company" || activeContentTab.path === "companies"))
          ? "companies" as const
          : activeContentTab?.kind === "crm-inbox"
            ? "inbox" as const
            : activeContentTab?.kind === "crm-calendar"
              ? "calendar" as const
              : null
    ),
    customCrmObjects,
    activeCrmObjectName: activeContentTab?.kind === "object" ? activeContentTab.path : null,
    onNavigateToCrmObject: handleNavigateToObject,
    onNewChatSession: () => openPermanentBlankChatTab(),
    chatsPanel: (
      <ChatSessionsSidebar
        embedded
        sessions={sessions}
        activeSessionId={activeSessionId}
        streamingSessionIds={streamingSessionIds}
        subagents={subagents}
        activeSubagentKey={activeSubagentKey}
        loading={sessionsLoading}
        gatewaySessions={gatewaySessions}
        activeGatewaySessionKey={activeGatewaySessionKey}
        onSelectSession={(sessionId) => {
          const session = sessions.find((entry) => entry.id === sessionId);
          openSessionChatTab(sessionId, session?.title);
        }}
        onNewSession={() => openPermanentBlankChatTab()}
        onSelectSubagent={handleSelectSubagent}
        onSelectGatewaySession={(sessionKey, sessionId) => {
          const gs = gatewaySessions.find((s) => s.sessionKey === sessionKey);
          openGatewayChatTab(sessionKey, sessionId, gs?.channel, gs?.title);
        }}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
      />
    ),
  };

  // Shared props for the chat-panel header history dropdown.
  // Defined here so all open ChatPanel tabs see the same up-to-date data.
  const chatHistoryPanelProps = {
    historySessions: sessions,
    historyStreamingSessionIds: streamingSessionIds,
    historySubagents: subagents,
    historyActiveSubagentKey: activeSubagentKey,
    historyLoading: sessionsLoading,
    historyGatewaySessions: gatewaySessions,
    historyActiveGatewaySessionKey: activeGatewaySessionKey,
    onSelectHistorySession: (sessionId: string) => {
      const session = sessions.find((entry) => entry.id === sessionId);
      openSessionChatTab(sessionId, session?.title);
    },
    onNewChatSession: () => {
      openPermanentBlankChatTab();
    },
    onOpenTemplates: () => setTemplatesPanelOpen(true),
    onSelectHistorySubagent: handleSelectSubagent,
    onSelectHistoryGatewaySession: (sessionKey: string, sessionId: string) => {
      const gs = gatewaySessions.find((s) => s.sessionKey === sessionKey);
      openGatewayChatTab(sessionKey, sessionId, gs?.channel, gs?.title);
    },
    onRenameHistorySession: handleRenameSession,
    onDeleteHistorySession: handleDeleteSession,
  };

  // Render-prop slots for `RightPanelContent`. These keep `ContentRenderer`
  // and `EntryDetailPanel` (with their large prop tornados) co-located here
  // while the layout component owns the file tree + tab strip + content area.
  const renderRightPanelEntryDetail = useCallback((entry: { objectName: string; entryId: string }) => (
    <EntryDetailPanel
      objectName={entry.objectName}
      entryId={entry.entryId}
      members={context?.members}
      tree={tree}
      searchFn={searchIndex}
      onClose={handleCloseEntry}
      onNavigateEntry={(objName, eid, relatedObjectId) => handleOpenEntry(objName, eid, relatedObjectId)}
      onNavigateObject={(objName) => {
        handleCloseEntry();
        handleNavigateToObject(objName);
      }}
      onRefresh={refreshCurrentObject}
      onNavigate={handleEditorNavigate}
    />
  ), [
    context?.members, tree, searchIndex, handleCloseEntry, handleOpenEntry,
    handleNavigateToObject, refreshCurrentObject, handleEditorNavigate,
  ]);

  const renderRightPanelContentBody = useCallback((c: ContentState, _tab: ContentTab | null) => (
    <ContentRenderer
      content={c}
      workspaceExists={workspaceExists}
      expectedPath={workspaceRoot}
      tree={tree}
      activePath={activePath}
      browseDir={browseDir}
      treeLoading={treeLoading}
      members={context?.members}
      onNodeSelect={handleNodeSelect}
      onNavigateToObject={handleNavigateToObject}
      onRefreshObject={refreshCurrentObject}
      onRefreshTree={refreshTree}
      onNavigate={handleEditorNavigate}
      onOpenEntry={handleOpenEntry}
      activeEntryId={undefined}
      searchFn={searchIndex}
      onSelectCronJob={handleSelectCronJob}
      onBackToCronDashboard={handleBackToCronDashboard}
      cronView={cronView}
      onCronViewChange={setCronView}
      cronCalMode={cronCalMode}
      onCronCalModeChange={setCronCalMode}
      cronDate={cronDate}
      onCronDateChange={setCronDate}
      cronRunFilter={cronRunFilter}
      onCronRunFilterChange={setCronRunFilter}
      cronRun={cronRun}
      onCronRunChange={setCronRun}
      onSendCommand={handleCronSendCommand}
      onMakeTabPermanent={promoteTabByPath}
      onTableSelectionContextChange={setTableSelectionContext}
      onProfileTabChange={handleProfileTabChange}
    />
  ), [
    workspaceExists, workspaceRoot, tree, activePath, browseDir, treeLoading,
    context?.members, handleNodeSelect, handleNavigateToObject,
    refreshCurrentObject, refreshTree, handleEditorNavigate, handleOpenEntry,
    searchIndex, handleSelectCronJob, handleBackToCronDashboard,
    cronView, cronCalMode, cronDate, cronRunFilter, cronRun,
    handleCronSendCommand, promoteTabByPath, setTableSelectionContext,
    handleProfileTabChange,
  ]);

  const renderRightPanelPlaceholder = useCallback(() => (
    <p className="text-sm text-center px-6 max-w-xs" style={{ color: "var(--color-text-muted)" }}>
      Select a file or open a page from the sidebar
    </p>
  ), []);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      ref={layoutRef}
      className="flex h-full min-h-0"
      style={{ background: "var(--color-main-bg)" }}
      onClick={handleContainerClick}
    >
      {/* ── Left sidebar ── */}
      {isMobile ? (
        sidebarOpen && (
          <WorkspaceSidebar
            {...sidebarCommonProps}
            tree={enhancedTree}
            onSelect={(node) => { handleNodeSelect(node); setSidebarOpen(false); }}
            onRefresh={refreshTree}
            loading={treeLoading}
            parentDir={effectiveParentDir}
            onNavigateUp={handleNavigateUp}
            onGoHome={handleGoHome}
            onExternalDrop={handleSidebarExternalDrop}
            showHidden={showHidden}
            onToggleHidden={() => setShowHidden((v) => !v)}
            onNavigate={(target) => { handleNavigate(target); setSidebarOpen(false); }}
            mobile
            onClose={() => setSidebarOpen(false)}
          />
        )
      ) : (
        <div
          className="sidebar-animate flex shrink-0 flex-col relative z-10 overflow-hidden"
          style={{
            width: leftSidebarCollapsed ? 0 : leftSidebarWidth,
            minWidth: leftSidebarCollapsed ? 0 : leftSidebarWidth,
            transition: "width 200ms ease, min-width 200ms ease",
          }}
        >
          <div className="flex flex-col h-full relative" style={{ width: leftSidebarWidth, minWidth: leftSidebarWidth }}>
            <ResizeHandle
              mode="left"
              containerRef={layoutRef}
              min={LEFT_SIDEBAR_MIN}
              max={LEFT_SIDEBAR_MAX}
              onResize={handleLeftSidebarResize}
            />
            <WorkspaceSidebar
              {...sidebarCommonProps}
              tree={enhancedTree}
              onSelect={handleNodeSelect}
              onRefresh={refreshTree}
              loading={treeLoading}
              parentDir={effectiveParentDir}
              onNavigateUp={handleNavigateUp}
              onGoHome={handleGoHome}
              onExternalDrop={handleSidebarExternalDrop}
              showHidden={showHidden}
              onToggleHidden={() => setShowHidden((v) => !v)}
              width={leftSidebarWidth}
              compact={isLeftSidebarCompact}
              onToggleCompact={toggleLeftSidebarCompact}
              onCollapse={() => setLeftSidebarCollapsed(true)}
              onNavigate={handleNavigate}
            />
          </div>
        </div>
      )}


      {/* ── Center: chat panel ── */}
      <main className="flex-1 flex flex-col min-w-[300px] overflow-hidden relative" style={{ background: "var(--color-main-bg)" }}>
        {/* Mobile top bar */}
        {isMobile && (
          <div
            className="px-2 py-1.5 border-b flex-shrink-0 flex items-center gap-1.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg flex-shrink-0"
              style={{ color: "var(--color-text-muted)" }}
              title="Open sidebar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="18" y2="18" />
              </svg>
            </button>
            <div className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
              {activeSessionTitle || context?.organization?.name || "Chat"}
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setMobileRightPanelOpen(true)}
                className="p-1.5 rounded-lg flex-shrink-0"
                style={{ color: "var(--color-text-muted)" }}
                title="Open files & content"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setTerminalOpen((v) => !v)}
                className="p-1.5 rounded-lg flex-shrink-0"
                style={{ color: terminalOpen ? "var(--color-text)" : "var(--color-text-muted)", background: terminalOpen ? "var(--color-surface-hover)" : "transparent" }}
                title="Terminal"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => openPermanentBlankChatTab()}
                className="p-1.5 rounded-lg flex-shrink-0"
                style={{ color: "var(--color-text-muted)" }}
                title="New chat"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14" /><path d="M5 12h14" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Chat panel stack — always visible, never replaced by content */}
        <div className="flex-1 flex min-h-0 min-w-0 flex-col overflow-hidden" style={{ background: "var(--color-main-bg)" }}>
          {mainChatTabs.map((tab) => {
            const isGateway = tab.variant === "gateway";
            const subagent = !isGateway && tab.sessionKey
              ? subagents.find((entry) => entry.childSessionKey === tab.sessionKey)
              : null;
            const isVisible = tab.id === visibleMainChatTabId;
            const showLeftToggle = !isMobile && leftSidebarCollapsed;
            const showRightToggle = !isMobile && rightPanelCollapsed;
            const headerLeftSlot = showLeftToggle ? (
              <button
                type="button"
                onClick={() => setLeftSidebarCollapsed(false)}
                className="p-1.5 rounded-md transition-colors cursor-pointer"
                style={{ color: "var(--color-text-muted)" }}
                title="Show sidebar (⌘B)"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 3v18" />
                </svg>
              </button>
            ) : undefined;
            const headerRightSlot = showRightToggle ? (
              <button
                type="button"
                onClick={() => setRightPanelCollapsed(false)}
                className="p-1.5 rounded-md transition-colors cursor-pointer"
                style={{ color: "var(--color-text-muted)" }}
                title="Show right panel (⌘⇧B)"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                </svg>
              </button>
            ) : undefined;
            return (
              <div
                key={tab.id}
                className={isVisible ? "flex-1 flex min-h-0 min-w-0 flex-col overflow-hidden" : "hidden"}
              >
                <ChatPanel
                  ref={(handle) => setMainChatPanelRef(tab.id, handle)}
                  sessionTitle={tab.title}
                  initialSessionId={isGateway ? undefined : (tab.sessionKey ? undefined : tab.sessionId ?? undefined)}
                  onActiveSessionChange={isGateway || tab.sessionKey ? undefined : (id) => handleChatTabSessionChange(tab.id, id)}
                  onSessionsChange={isGateway ? undefined : refreshSessions}
                  onConversationActivity={() => promoteTabById(tab.id)}
                  onSubagentClick={handleSubagentClickFromChat}
                  onFilePathClick={handleFilePathClickFromChat}
                  onComposioAction={handleComposioActionFromChat}
                  onDeleteSession={isGateway || tab.sessionKey ? undefined : handleDeleteSession}
                  onRenameSession={isGateway || tab.sessionKey ? undefined : handleRenameSession}
                  compact={isMobile}
                  sessionKey={isGateway ? undefined : (tab.sessionKey ?? undefined)}
                  subagentTask={subagent?.task}
                  subagentLabel={subagent?.label}
                  onBack={tab.sessionKey && !isGateway ? handleBackFromSubagent : undefined}
                  hideHeaderActions={false}
                  headerLeftSlot={headerLeftSlot}
                  headerRightSlot={headerRightSlot}
                  onRuntimeStateChange={(runtime) => handleChatRuntimeStateChange(tab.id, runtime)}
                  onOpenCloudSettings={() => handleNavigate("cloud")}
                  gatewaySessionKey={isGateway ? tab.sessionKey : undefined}
                  gatewaySessionId={isGateway ? tab.sessionId : undefined}
                  gatewayChannel={isGateway ? tab.channel : undefined}
                  visible={isVisible}
                  searchFn={searchIndex}
                  fileContext={isVisible ? fileContext : undefined}
                  onFileChanged={handleFileChanged}
                  {...chatHistoryPanelProps}
                />
              </div>
            );
          })}
        </div>

        <ChatComposioModalHost
          request={pendingComposioAction}
          onRequestHandled={handleComposioActionHandled}
          onFallbackToIntegrations={handleComposioFallbackToIntegrations}
        />

        <SkillTemplateGalleryPanel
          open={templatesPanelOpen}
          onOpenChange={setTemplatesPanelOpen}
          onStartTemplate={handleStartDashboardTemplate}
        />

        {terminalOpen && (
          <TerminalDrawer onClose={() => setTerminalOpen(false)} cwd={workspaceRoot ?? undefined} />
        )}
      </main>

      {/* ── Right panel ── */}
      {!isMobile && (
        <aside
          className={`sidebar-animate flex-shrink-0 min-h-0 flex flex-col relative ${rightPanelCollapsed ? "overflow-hidden" : "border-l overflow-hidden"}`}
          style={{
            width: effectiveRightPanelWidth,
            minWidth: effectiveRightPanelWidth,
            borderColor: "var(--color-border)",
            background: "var(--color-bg)",
            transition: "width 200ms ease, min-width 200ms ease",
          }}
        >
          <div className="flex h-full min-h-0 flex-col relative overflow-hidden" style={{ width: renderedRightPanelWidth, minWidth: renderedRightPanelWidth }}>
            <ResizeHandle
              mode="right"
              containerRef={layoutRef}
              min={RIGHT_PANEL_MIN}
              max={availableRightPanelMaxWidth}
              onResize={setRightPanelWidth}
            />
            <RightPanel>
              <RightPanelContent
                tabsState={tabsState}
                activeContentTab={activeContentTab}
                fileTreeCollapsed={fileTreeCollapsed}
                enhancedTree={enhancedTree}
                effectiveParentDir={effectiveParentDir}
                browseDir={browseDir}
                workspaceRoot={workspaceRoot}
                fileSearchFn={searchIndex}
                entryModal={entryModal}
                tree={tree}
                cronJobs={cronJobs}
                onTreeNodeSelect={handleNodeSelect}
                onTreeRefresh={refreshTree}
                onTreeNavigateUp={handleNavigateUp}
                onTreeExternalDrop={handleSidebarExternalDrop}
                onTreeFileSearchSelect={handleFileSearchSelect}
                onTreeGoHome={handleGoHome}
                onSetFileTreeCollapsed={setFileTreeCollapsed}
                onSetRightPanelCollapsed={setRightPanelCollapsed}
                onActivateContent={handleContentTabActivate}
                onCloseContent={handleContentTabClose}
                onCloseOtherContent={handleTabCloseOthers}
                onCloseContentToRight={handleTabCloseToRight}
                onCloseAllContent={handleTabCloseAll}
                onDuckDBMissing={handleDuckDBMissing}
                onRefreshActiveChange={handleRefreshActiveChange}
                renderContent={renderRightPanelContentBody}
                renderEntryDetail={renderRightPanelEntryDetail}
                renderPlaceholder={renderRightPanelPlaceholder}
              />
            </RightPanel>
          </div>
        </aside>
      )}

      {/* Mobile right panel drawer */}
      {isMobile && mobileRightPanelOpen && (
        <div className="drawer-backdrop" onClick={() => setMobileRightPanelOpen(false)}>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div onClick={(e) => e.stopPropagation()} className="fixed inset-y-0 right-0 z-50 drawer-right" style={{ width: "min(90vw, 400px)", background: "var(--color-bg)" }}>
            <div className="flex flex-col h-full">
              <RightPanel>
                <RightPanelContent
                  tabsState={tabsState}
                  activeContentTab={activeContentTab}
                  fileTreeCollapsed={fileTreeCollapsed}
                  enhancedTree={enhancedTree}
                  effectiveParentDir={effectiveParentDir}
                  browseDir={browseDir}
                  workspaceRoot={workspaceRoot}
                  fileSearchFn={searchIndex}
                  entryModal={entryModal}
                  tree={tree}
                  cronJobs={cronJobs}
                  onTreeNodeSelect={handleNodeSelect}
                  onTreeRefresh={refreshTree}
                  onTreeNavigateUp={handleNavigateUp}
                  onTreeFileSearchSelect={handleFileSearchSelect}
                  onTreeGoHome={handleGoHome}
                  onSetFileTreeCollapsed={setFileTreeCollapsed}
                  onSetRightPanelCollapsed={() => setMobileRightPanelOpen(false)}
                  onActivateContent={handleContentTabActivate}
                  onCloseContent={handleContentTabClose}
                  onCloseOtherContent={handleTabCloseOthers}
                  onCloseContentToRight={handleTabCloseToRight}
                  onCloseAllContent={handleTabCloseAll}
                  onDuckDBMissing={handleDuckDBMissing}
                  onRefreshActiveChange={handleRefreshActiveChange}
                  renderContent={renderRightPanelContentBody}
                  renderEntryDetail={renderRightPanelEntryDetail}
                  renderPlaceholder={renderRightPanelPlaceholder}
                />
              </RightPanel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// NOTE: legacy ChatSidebarPreview helpers were removed in v3 three-column refactor.
// Non-chat content is rendered by ContentRenderer inside the right panel now.

// --- Content Renderer ---

function ContentRenderer({
  content,
  workspaceExists,
  expectedPath,
  tree,
  activePath,
  browseDir,
  treeLoading,
  members,
  onNodeSelect,
  onNavigateToObject,
  onRefreshObject,
  onRefreshTree,
  onNavigate,
  onOpenEntry,
  activeEntryId,
  searchFn,
  onSelectCronJob,
  onBackToCronDashboard,
  cronView,
  onCronViewChange,
  cronCalMode,
  onCronCalModeChange,
  cronDate,
  onCronDateChange,
  cronRunFilter,
  onCronRunFilterChange,
  cronRun,
  onCronRunChange,
  onSendCommand,
  onMakeTabPermanent,
  onTableSelectionContextChange,
  onProfileTabChange,
}: {
  content: ContentState;
  workspaceExists: boolean;
  expectedPath?: string | null;
  tree: TreeNode[];
  activePath: string | null;
  browseDir?: string | null;
  treeLoading?: boolean;
  members?: Array<{ id: string; name: string; email: string; role: string }>;
  onNodeSelect: (node: TreeNode) => void;
  onNavigateToObject: (objectName: string) => void;
  onRefreshObject: () => void;
  onRefreshTree: () => void;
  onNavigate: (href: string) => void;
  onOpenEntry: (
    objectName: string,
    entryId: string,
    relatedObjectId?: string,
  ) => void;
  activeEntryId?: string;
  searchFn: (query: string, limit?: number) => import("@/lib/search-index").SearchIndexItem[];
  onSelectCronJob: (jobId: string) => void;
  onBackToCronDashboard: () => void;
  cronView: import("@/lib/workspace-links").CronDashboardView;
  onCronViewChange: (view: import("@/lib/workspace-links").CronDashboardView) => void;
  cronCalMode: import("@/lib/object-filters").CalendarMode;
  onCronCalModeChange: (mode: import("@/lib/object-filters").CalendarMode) => void;
  cronDate: string | null;
  onCronDateChange: (date: string | null) => void;
  cronRunFilter: import("@/lib/workspace-links").CronRunStatusFilter;
  onCronRunFilterChange: (filter: import("@/lib/workspace-links").CronRunStatusFilter) => void;
  cronRun: number | null;
  onCronRunChange: (run: number | null) => void;
  onSendCommand: (message: string) => void;
  onMakeTabPermanent: (path: string) => void;
  onTableSelectionContextChange: (selection: TableSelectionContext | null) => void;
  onProfileTabChange: (profileTab: string) => void;
}) {
  switch (content.kind) {
    case "loading":
      return (
        <div className="flex items-center justify-center h-full">
          <UnicodeSpinner name="braille" className="text-2xl" style={{ color: "var(--color-text-muted)" }} />
        </div>
      );

    case "object":
      return (
        <ObjectView
          key={content.data.object.name}
          data={content.data}
          members={members}
          onNavigateToObject={onNavigateToObject}
          onRefreshObject={onRefreshObject}
          onRefreshTree={onRefreshTree}
          onOpenEntry={onOpenEntry}
          activeEntryId={activeEntryId}
          onSelectionContextChange={onTableSelectionContextChange}
        />
      );

    case "document":
      return (
        <DocumentView
          content={content.data.content}
          title={content.title}
          filePath={activePath ?? undefined}
          tree={tree}
          onSave={onRefreshTree}
          onNavigate={onNavigate}
          searchFn={searchFn}
          onDirty={activePath ? () => onMakeTabPermanent(activePath) : undefined}
        />
      );

    case "file":
      return (
        <FileViewer
          content={content.data.content}
          filename={content.filename}
          type={content.data.type === "yaml" ? "yaml" : "text"}
        />
      );

    case "code":
      return (
        <MonacoCodeEditor
          content={content.data.content}
          filename={content.filename}
          filePath={content.filePath}
          onDirty={content.filePath ? () => onMakeTabPermanent(content.filePath) : undefined}
        />
      );

    case "media":
      return (
        <MediaViewer
          url={content.url}
          filename={content.filename}
          mediaType={content.mediaType}
          filePath={content.filePath}
        />
      );

    case "spreadsheet":
      return (
        <SpreadsheetEditor
          url={content.url}
          filename={content.filename}
          filePath={content.filePath}
          onDirty={() => onMakeTabPermanent(content.filePath)}
        />
      );

    case "html":
      return (
        <HtmlViewer
          rawUrl={content.rawUrl}
          contentUrl={content.contentUrl}
          filename={content.filename}
        />
      );

    case "app":
      return (
        <AppViewer
          appPath={content.appPath}
          manifest={content.manifest}
        />
      );

    case "database":
      return (
        <DatabaseViewer
          dbPath={content.dbPath}
          filename={content.filename}
        />
      );

    case "report":
      return (
        <ReportViewer
          reportPath={content.reportPath}
        />
      );

    case "directory": {
      // In browse mode the top-level tree is the live listing of browseDir
      // (same data source as the sidebar). Use it directly instead of the
      // possibly-stale node.children stored in content state.
      const isBrowseLive = browseDir != null && activePath === browseDir;
      if (isBrowseLive && treeLoading) {
        return (
          <div className="flex items-center justify-center h-full">
            <UnicodeSpinner name="braille" className="text-2xl" style={{ color: "var(--color-text-muted)" }} />
          </div>
        );
      }
      const directoryNode = isBrowseLive
        ? { ...content.node, children: tree }
        : content.node;
      return (
        <DirectoryListing
          node={directoryNode}
          onNodeSelect={onNodeSelect}
        />
      );
    }

    case "cron-dashboard":
      return (
        <CronDashboard
          onSelectJob={onSelectCronJob}
          onSendCommand={onSendCommand}
          activeView={cronView}
          onViewChange={onCronViewChange}
          calendarMode={cronCalMode}
          onCalendarModeChange={onCronCalModeChange}
          calendarDate={cronDate}
          onCalendarDateChange={onCronDateChange}
        />
      );

    case "skill-store":
      return (
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-5xl p-6">
            <SkillStorePanel />
          </div>
        </div>
      );

    case "integrations":
      return (
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-5xl p-6">
            <IntegrationsPanel />
          </div>
        </div>
      );

    case "cloud":
      return (
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-5xl p-6">
            <div className="mb-6">
              <h1 className="font-instrument text-3xl tracking-tight" style={{ color: "var(--color-text)" }}>Cloud</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>Manage your Dench Cloud connection and model settings.</p>
            </div>
            <CloudSettingsPanel />
          </div>
        </div>
      );

    case "cron-job":
      return (
        <CronJobDetail
          job={content.job}
          onBack={onBackToCronDashboard}
          onSendCommand={onSendCommand}
          runFilter={cronRunFilter}
          onRunFilterChange={onCronRunFilterChange}
          expandedRunTs={cronRun}
          onExpandedRunChange={onCronRunChange}
        />
      );

    case "cron-session":
      return (
        <CronSessionView
          job={content.job}
          run={content.run}
          sessionId={content.sessionId}
          onBack={() => onBackToCronDashboard()}
          onBackToJob={() => onSelectCronJob(content.jobId)}
        />
      );

    case "duckdb-missing":
      return <DuckDBMissing />;

    case "richDocument":
      return (
        <RichDocumentEditor
          mode={content.mode}
          initialHtml={content.html}
          filePath={content.filePath}
          onSave={onRefreshTree}
          onDirty={() => onMakeTabPermanent(content.filePath)}
        />
      );

    case "crm-inbox":
      return <InboxView onOpenPerson={(id) => onOpenEntry("people", id)} />;

    case "crm-calendar":
      return (
        <CalendarView
          onOpenPerson={(id) => onOpenEntry("people", id)}
          onOpenCompany={(id) => onOpenEntry("company", id)}
        />
      );

    case "crm-person":
      return (
        <PersonProfile
          personId={content.entryId}
          activeTab={content.profileTab}
          onOpenPerson={(id) => onOpenEntry("people", id)}
          onOpenCompany={(id) => onOpenEntry("company", id)}
          onBackToList={() => onNavigateToObject("people")}
          onTabChange={onProfileTabChange}
        />
      );

    case "crm-company":
      return (
        <CompanyProfile
          companyId={content.entryId}
          activeTab={content.profileTab}
          onOpenPerson={(id) => onOpenEntry("people", id)}
          onOpenCompany={(id) => onOpenEntry("company", id)}
          onBackToList={() => onNavigateToObject("company")}
          onTabChange={onProfileTabChange}
        />
      );

    case "none":
    default:
      if (tree.length === 0) {
        return <EmptyState workspaceExists={workspaceExists} expectedPath={expectedPath} />;
      }
      return <WelcomeView tree={tree} onNodeSelect={onNodeSelect} />;
  }
}

// --- Object View (header + display field selector + table/kanban) ---

function ObjectView({
  data,
  members,
  onNavigateToObject,
  onRefreshObject,
  onRefreshTree,
  onOpenEntry,
  activeEntryId,
  onSelectionContextChange,
}: {
  data: ObjectData;
  members?: Array<{ id: string; name: string; email: string; role: string }>;
  onNavigateToObject: (objectName: string) => void;
  onRefreshObject: () => void;
  onRefreshTree?: () => void;
  onOpenEntry?: (
    objectName: string,
    entryId: string,
    relatedObjectId?: string,
  ) => void;
  activeEntryId?: string;
  onSelectionContextChange?: (selection: TableSelectionContext | null) => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const safeEntryId = (e: Record<string, unknown>) => {
    const candidate = e.entry_id ?? e.id;
    if (typeof candidate === "string") {return candidate;}
    if (typeof candidate === "number" || typeof candidate === "boolean" || typeof candidate === "bigint") {
      return String(candidate);
    }
    return "";
  };
  const [updatingDisplayField, setUpdatingDisplayField] = useState(false);

  // Resolve the initial view state for this table.
  //
  // View state (search/filters/sort/view/viewType/cols/page) lives in the
  // URL as the source of truth. ObjectView is keyed by `data.object.name`
  // upstream, so this useMemo runs once per table (a new mount on every
  // table switch). That means switching tables A → B does NOT carry A's
  // view state to B: the new ObjectView mount reads the URL fresh, and the
  // shell URL effect drops view params on path change so the URL itself
  // does not leak A's filter into the B query string.
  const initialState = useMemo(() => {
    const url = parseUrlState(searchParams);
    return {
      view: url.view ?? undefined,
      viewType: url.viewType ?? undefined,
      filters: url.filters ?? undefined,
      search: url.search ?? undefined,
      sort: url.sort ?? undefined,
      page: url.page ?? undefined,
      pageSize: url.pageSize ?? undefined,
      cols: url.cols ?? undefined,
    };
  // Initial state — frozen at mount, deliberately ignores prop/url changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.object.name]);

  // --- View type state ---
  const [currentViewType, setCurrentViewType] = useState<ViewType>(
    () => initialState.viewType ?? resolveViewType(undefined, undefined, data.object.default_view),
  );
  const [viewSettings, setViewSettings] = useState<ViewTypeSettings>(
    () => data.viewSettings ?? {},
  );

  // --- Filter state ---
  const [filters, setFilters] = useState<FilterGroup>(() => initialState.filters ?? emptyFilterGroup());
  const [savedViews, setSavedViews] = useState<SavedView[]>(data.savedViews ?? []);
  const [activeViewName, setActiveViewName] = useState<string | undefined>(initialState.view ?? data.activeView);

  // --- Server-side pagination state ---
  const [serverPage, setServerPage] = useState(initialState.page ?? data.page ?? 1);
  const [serverPageSize, setServerPageSize] = useState(initialState.pageSize ?? data.pageSize ?? 100);
  const [totalCount, setTotalCount] = useState(data.totalCount ?? data.entries.length);
  const [entries, setEntries] = useState(data.entries);
  const [serverSearch, setServerSearch] = useState(initialState.search ?? "");
  const [sortRules, _setSortRules] = useState<SortRule[] | undefined>(initialState.sort ?? undefined);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasActiveServerQuery =
    filters.rules.length > 0 ||
    ((sortRules?.length ?? 0) > 0) ||
    serverSearch.trim().length > 0;

  // Column visibility: maps field IDs to boolean (false = hidden)
  const [viewColumns, setViewColumns] = useState<string[] | undefined>(initialState.cols ?? undefined);
  // Track which field IDs we've already seen for this object so newly-arriving
  // fields (created via the Add Column popover, AI yaml edits, etc.) get
  // auto-added to `viewColumns` instead of defaulting to hidden under an
  // active visibility whitelist. See `mergeNewlySeenColumns` for the rule.
  const seenFieldIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const result = mergeNewlySeenColumns(viewColumns, seenFieldIdsRef.current, data.fields);
    seenFieldIdsRef.current = result.nextSeen;
    if (result.nextViewColumns !== viewColumns) {
      setViewColumns(result.nextViewColumns);
    }
  }, [data.fields, viewColumns]);
  // Column widths: maps field name to pixel width (persisted in view_settings / saved views)
  const [columnWidths, setColumnWidths] = useState<Record<string, number> | undefined>(
    () => data.viewSettings?.column_widths,
  );

  // --- Unified toolbar state (lifted up so the controls live above the view) ---
  const [globalFilter, setGlobalFilter] = useState<string>(initialState.search ?? "");
  const [stickyFirstColumn, setStickyFirstColumn] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Persist this table's view state to the URL. Skip the first run so we
  // don't immediately re-push the URL with the values we just hydrated.
  //
  // The URL is the source of truth for view state. We rewrite ONLY the
  // view-state slots and merge them with whatever non-view-state params
  // are already on the URL (path, entry, terminal, …). The shell URL
  // effect protects against bleed across tables by dropping these params
  // on path change.
  const objectViewMounted = useRef(false);
  useEffect(() => {
    if (!objectViewMounted.current) {
      objectViewMounted.current = true;
      return;
    }

    const defaultVt = resolveViewType(undefined, undefined, data.object.default_view);
    const currentParams = new URLSearchParams(window.location.search);

    const setOrDelete = (key: string, value: string | null) => {
      if (value == null || value === "") {
        currentParams.delete(key);
      } else {
        currentParams.set(key, value);
      }
    };

    setOrDelete("viewType", currentViewType !== defaultVt ? currentViewType : null);
    setOrDelete(
      "view",
      activeViewName && activeViewName !== data.activeView ? activeViewName : null,
    );
    setOrDelete(
      "filters",
      filters.rules.length > 0 ? btoa(JSON.stringify(filters)) : null,
    );
    setOrDelete("search", serverSearch || null);
    setOrDelete(
      "sort",
      sortRules && sortRules.length > 0 ? btoa(JSON.stringify(sortRules)) : null,
    );
    setOrDelete("page", serverPage > 1 ? String(serverPage) : null);
    setOrDelete("pageSize", serverPageSize !== 100 ? String(serverPageSize) : null);
    setOrDelete(
      "cols",
      viewColumns && viewColumns.length > 0 ? viewColumns.join(",") : null,
    );

    const nextQs = currentParams.toString();
    const liveQs = window.location.search.replace(/^\?/, "");
    if (nextQs !== liveQs) {
      router.replace(nextQs ? `/?${nextQs}` : "/", { scroll: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentViewType, activeViewName, filters, serverSearch, sortRules, serverPage, serverPageSize, viewColumns]);

  // Convert field-name-based columns list to TanStack VisibilityState keyed by field ID.
  // On People/Companies we also force-hide the noisy system-table reverse
  // columns (email_thread, email_message, calendar_event, interaction) even
  // when the user has no saved view, so the table starts clean.
  const columnVisibility = useMemo(() => {
    const vis: Record<string, boolean> = {};
    if (viewColumns && viewColumns.length > 0) {
      for (const field of data.fields) {
        vis[field.id] = viewColumns.includes(field.name);
      }
      vis["created_at"] = viewColumns.includes("created_at");
      vis["updated_at"] = viewColumns.includes("updated_at");
    }
    if (
      HIDE_NOISY_REVERSE_FOR_OBJECT_NAMES.has(data.object.name) &&
      data.reverseRelations
    ) {
      for (const rr of data.reverseRelations) {
        if (NOISY_CRM_REVERSE_SOURCES.has(rr.sourceObjectName)) {
          vis[`rev_${rr.sourceObjectName}_${rr.fieldName}`] = false;
        }
      }
    }
    return Object.keys(vis).length === 0 ? undefined : vis;
  }, [viewColumns, data.fields, data.reverseRelations, data.object.name]);

  // Callback for column visibility changes from the DataTable.
  // Converts TanStack VisibilityState (field IDs) back to field-name-based viewColumns.
  const handleColumnVisibilityChanged = useCallback((vis: Record<string, boolean>) => {
    const visibleNames: string[] = [];
    for (const field of data.fields) {
      if (vis[field.id] !== false) visibleNames.push(field.name);
    }
    if (vis["created_at"] !== false) visibleNames.push("created_at");
    if (vis["updated_at"] !== false) visibleNames.push("updated_at");
    setViewColumns(visibleNames.length > 0 ? visibleNames : undefined);
  }, [data.fields]);

  // Column sizing: convert field-name-based widths to TanStack ColumnSizingState (keyed by field ID)
  const columnSizing = useMemo(() => {
    if (!columnWidths) return undefined;
    const sizing: Record<string, number> = {};
    for (const field of data.fields) {
      if (columnWidths[field.name] != null) sizing[field.id] = columnWidths[field.name];
    }
    if (columnWidths["created_at"] != null) sizing["created_at"] = columnWidths["created_at"];
    if (columnWidths["updated_at"] != null) sizing["updated_at"] = columnWidths["updated_at"];
    return Object.keys(sizing).length > 0 ? sizing : undefined;
  }, [columnWidths, data.fields]);

  // Callback for column sizing changes — converts back to field-name-based and persists
  const handleColumnSizingChanged = useCallback((sizing: Record<string, number>) => {
    const widths: Record<string, number> = {};
    for (const field of data.fields) {
      if (sizing[field.id] != null) widths[field.name] = Math.round(sizing[field.id]);
    }
    if (sizing["created_at"] != null) widths["created_at"] = Math.round(sizing["created_at"]);
    if (sizing["updated_at"] != null) widths["updated_at"] = Math.round(sizing["updated_at"]);
    const next = Object.keys(widths).length > 0 ? widths : undefined;
    setColumnWidths(next);
    // Persist to view_settings in .object.yaml
    const newSettings = { ...viewSettings, column_widths: next };
    void fetch(
      `/api/workspace/objects/${encodeURIComponent(data.object.name)}/views`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ views: savedViews, activeView: activeViewName, viewSettings: newSettings }),
      },
    ).catch(() => {});
  }, [data.fields, data.object.name, viewSettings, savedViews, activeViewName]);

  // Fetch entries from server with current pagination/filter/sort/search state
  const fetchEntries = useCallback(async (opts?: {
    page?: number;
    pageSize?: number;
    filters?: FilterGroup;
    sort?: SortRule[];
    search?: string;
  }) => {
    const p = opts?.page ?? serverPage;
    const ps = opts?.pageSize ?? serverPageSize;
    const f = opts?.filters ?? filters;
    const s = opts?.sort ?? sortRules;
    const q = opts?.search ?? serverSearch;

    const params = new URLSearchParams();
    params.set("page", String(p));
    params.set("pageSize", String(ps));
    if (f && f.rules.length > 0) {
      params.set("filters", serializeFilters(f));
    }
    if (s && s.length > 0) {
      params.set("sort", JSON.stringify(s));
    }
    if (q) {
      params.set("search", q);
    }

    try {
      const res = await fetch(
        `/api/workspace/objects/${encodeURIComponent(data.object.name)}?${params.toString()}`
      );
      if (!res.ok) {return;}
      const result: ObjectData = await res.json();
      setEntries(result.entries);
      setTotalCount(result.totalCount ?? result.entries.length);
      setServerPage(result.page ?? p);
      setServerPageSize(result.pageSize ?? ps);
    } catch {
      // ignore
    }
  }, [serverPage, serverPageSize, filters, sortRules, serverSearch, data.object.name]);

  // Sync incoming object data. If a server query is active (filters/search/sort),
  // re-fetch with the active query instead of showing unfiltered parent entries.
  useEffect(() => {
    if (hasActiveServerQuery) {
      void fetchEntries();
      return;
    }
    setEntries(data.entries);
    setTotalCount(data.totalCount ?? data.entries.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to parent data updates
  }, [data.entries, data.totalCount]);

  // Sync saved views when data changes (e.g. SSE refresh from AI editing .object.yaml)
  useEffect(() => {
    setSavedViews(data.savedViews ?? []);
    if (data.viewSettings) {setViewSettings(data.viewSettings);}

    const decision = resolveActiveViewSyncDecision({
      savedViews: data.savedViews,
      activeView: data.activeView,
      currentActiveViewName: activeViewName,
      currentFilters: filters,
      currentViewColumns: viewColumns,
      currentColumnWidths: columnWidths,
      currentViewType: currentViewType,
      currentSettings: viewSettings,
    });
    if (decision?.shouldApply) {
      setFilters(decision.nextFilters);
      setViewColumns(decision.nextColumns);
      if (decision.nextColumnWidths !== undefined) setColumnWidths(decision.nextColumnWidths);
      setActiveViewName(decision.nextActiveViewName);
      if (decision.nextViewType) {setCurrentViewType(decision.nextViewType);}
      if (decision.nextSettings) {setViewSettings((prev) => ({ ...prev, ...decision.nextSettings }));}
      // Re-fetch with filters from the synchronized active view.
      void fetchEntries({ page: 1, filters: decision.nextFilters });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.savedViews, data.activeView]);

  // When filters change, reset to page 1 and re-fetch
  const handleFiltersChange = useCallback((newFilters: FilterGroup) => {
    setFilters(newFilters);
    setServerPage(1);
    void fetchEntries({ page: 1, filters: newFilters });
  }, [fetchEntries]);

  // Server-side search with debounce
  const handleServerSearch = useCallback((query: string) => {
    setServerSearch(query);
    if (searchTimerRef.current) {clearTimeout(searchTimerRef.current);}
    searchTimerRef.current = setTimeout(() => {
      setServerPage(1);
      void fetchEntries({ page: 1, search: query });
    }, 300);
  }, [fetchEntries]);

  // Server-side sort: when the user picks Sort ascending / descending in
  // a column header menu, ObjectTable translates TanStack's internal
  // sorting state into SortRule[] (keyed by field name) and forwards
  // here. We mirror it into `sortRules` so the URL effect persists it
  // and refetch with the new ORDER BY so subsequent pages stay
  // consistent (the previous behaviour only sorted the visible page
  // client-side, which broke the moment you paginated).
  const handleServerSort = useCallback((sort: SortRule[]) => {
    _setSortRules(sort.length > 0 ? sort : undefined);
    setServerPage(1);
    void fetchEntries({ page: 1, sort });
  }, [fetchEntries]);

  // Page change
  const handlePageChange = useCallback((page: number) => {
    setServerPage(page);
    void fetchEntries({ page });
  }, [fetchEntries]);

  // Page size change
  const handlePageSizeChange = useCallback((size: number) => {
    setServerPageSize(size);
    setServerPage(1);
    void fetchEntries({ page: 1, pageSize: size });
  }, [fetchEntries]);

  // Override onRefreshObject to re-fetch with current pagination state
  const handleRefresh = useCallback(() => {
    void fetchEntries();
    onRefreshObject();
  }, [fetchEntries, onRefreshObject]);

  // Use entries from server (already filtered server-side)
  const filteredEntries = entries;

  // ---- Stable props for ObjectTable ----
  // The ObjectTable / DataTable / row / cell tree is heavily memoized; if we
  // pass fresh function/object references on every parent render, every
  // memoization downstream busts and we end up re-rendering all 100 rows on
  // every state tick. Keep these stable.

  /** Open the entry detail modal for an entry in THIS object. */
  const handleEntryClick = useCallback(
    (entryId: string) => {
      onOpenEntry?.(data.object.name, entryId);
    },
    [onOpenEntry, data.object.name],
  );
  // Pass `undefined` (not a noop) when no parent handler exists so the
  // ObjectTable can still suppress the click affordance.
  const handleEntryClickProp = onOpenEntry ? handleEntryClick : undefined;

  /** Open the +Add entry modal. */
  const handleOpenAddModal = useCallback(() => {
    setShowAddModal(true);
  }, []);

  /** Server pagination prop, memoized so the object identity is stable
   * unless one of the actual values changes. */
  const serverPaginationProp = useMemo(
    () => ({
      totalCount,
      page: serverPage,
      pageSize: serverPageSize,
      onPageChange: handlePageChange,
      onPageSizeChange: handlePageSizeChange,
    }),
    [totalCount, serverPage, serverPageSize, handlePageChange, handlePageSizeChange],
  );

  // Save view to .object.yaml via API
  const handleSaveView = useCallback(async (name: string) => {
    const newView: SavedView = {
      name,
      view_type: currentViewType,
      filters,
      columns: viewColumns,
      column_widths: columnWidths,
      settings: viewSettings,
    };
    const updated = [...savedViews.filter((v) => v.name !== name), newView];
    setSavedViews(updated);
    setActiveViewName(name);
    try {
      await fetch(
        `/api/workspace/objects/${encodeURIComponent(data.object.name)}/views`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ views: updated, activeView: name, viewSettings }),
        },
      );
    } catch {
      // ignore save errors
    }
  }, [filters, savedViews, data.object.name, currentViewType, viewColumns, columnWidths, viewSettings]);

  const handleLoadView = useCallback((view: SavedView) => {
    const newFilters = view.filters ?? emptyFilterGroup();
    setFilters(newFilters);
    setViewColumns(view.columns);
    setColumnWidths(view.column_widths);
    setActiveViewName(view.name);
    if (view.view_type) {setCurrentViewType(view.view_type);}
    if (view.settings) {setViewSettings((prev) => ({ ...prev, ...view.settings }));}
    setServerPage(1);
    void fetchEntries({ page: 1, filters: newFilters });
  }, [fetchEntries]);

  const handleDeleteView = useCallback(async (name: string) => {
    const updated = savedViews.filter((v) => v.name !== name);
    setSavedViews(updated);
    if (activeViewName === name) {
      setActiveViewName(undefined);
      setFilters(emptyFilterGroup());
      setViewColumns(undefined);
    }
    try {
      await fetch(
        `/api/workspace/objects/${encodeURIComponent(data.object.name)}/views`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            views: updated,
            activeView: activeViewName === name ? undefined : activeViewName,
          }),
        },
      );
    } catch {
      // ignore
    }
  }, [savedViews, activeViewName, data.object.name]);

  const handleSetActiveView = useCallback(async (name: string | undefined) => {
    setActiveViewName(name);
    if (!name) {setViewColumns(undefined);}
    try {
      await fetch(
        `/api/workspace/objects/${encodeURIComponent(data.object.name)}/views`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ views: savedViews, activeView: name }),
        },
      );
    } catch {
      // ignore
    }
  }, [savedViews, data.object.name]);

  // View type change handler
  const handleViewTypeChange = useCallback((vt: ViewType) => {
    setCurrentViewType(vt);
  }, []);

  // View settings change handler (persists to .object.yaml)
  const handleViewSettingsChange = useCallback(async (newSettings: ViewTypeSettings) => {
    setViewSettings(newSettings);
    try {
      await fetch(
        `/api/workspace/objects/${encodeURIComponent(data.object.name)}/views`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ views: savedViews, activeView: activeViewName, viewSettings: newSettings }),
        },
      );
    } catch {
      // ignore
    }
  }, [savedViews, activeViewName, data.object.name]);

  // Resolve effective settings for current view type with auto-detection fallbacks
  const effectiveSettings = useMemo(() => {
    const activeView = savedViews.find((v) => v.name === activeViewName);
    const merged = resolveViewSettings(activeView?.settings, viewSettings);
    const fieldMetas = [
      ...data.fields.map((f) => ({ name: f.name, type: f.type })),
      { name: "created_at", type: "date" },
      { name: "updated_at", type: "date" },
    ];

    if (currentViewType === "kanban" && !merged.kanbanField) {
      merged.kanbanField = autoDetectViewField("kanban", "kanbanField", fieldMetas);
    }
    if (currentViewType === "calendar" && !merged.calendarDateField) {
      merged.calendarDateField = autoDetectViewField("calendar", "calendarDateField", fieldMetas);
    }
    if (currentViewType === "timeline" && !merged.timelineStartField) {
      merged.timelineStartField = autoDetectViewField("timeline", "timelineStartField", fieldMetas);
    }
    if (currentViewType === "gallery" && !merged.galleryTitleField) {
      merged.galleryTitleField = autoDetectViewField("gallery", "galleryTitleField", fieldMetas);
    }
    if (currentViewType === "list" && !merged.listTitleField) {
      merged.listTitleField = autoDetectViewField("list", "listTitleField", fieldMetas);
    }
    return merged;
  }, [currentViewType, viewSettings, savedViews, activeViewName, data.fields]);

  const handleDisplayFieldChange = async (fieldName: string) => {
    setUpdatingDisplayField(true);
    try {
      const res = await fetch(
        `/api/workspace/objects/${encodeURIComponent(data.object.name)}/display-field`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayField: fieldName }),
        },
      );
      if (res.ok) {
        onRefreshObject();
      }
    } catch {
      // ignore
    } finally {
      setUpdatingDisplayField(false);
    }
  };

  // Persist date changes from calendar/timeline drag-and-drop with optimistic UI
  const handleCalendarDateChange = useCallback(async (payload: CalendarDateChangePayload) => {
    const dateFieldName = effectiveSettings.calendarDateField;
    const endDateFieldName = effectiveSettings.calendarEndDateField;
    if (!dateFieldName) {return;}

    const fields: Record<string, string> = { [dateFieldName]: payload.newDate };
    if (endDateFieldName && payload.newEndDate) {
      fields[endDateFieldName] = payload.newEndDate;
    }

    // Optimistic update
    setEntries((prev) => prev.map((e) => {
      if (safeEntryId(e) !== payload.entryId) {return e;}
      const updated = { ...e, [dateFieldName]: payload.newDate };
      if (endDateFieldName && payload.newEndDate) {updated[endDateFieldName] = payload.newEndDate;}
      return updated;
    }));

    try {
      await fetch(
        `/api/workspace/objects/${encodeURIComponent(data.object.name)}/entries/${encodeURIComponent(payload.entryId)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) },
      );
    } catch { /* rollback happens on next SSE refresh */ }
  }, [effectiveSettings, data.object.name]);

  const handleTimelineDateChange = useCallback(async (payload: TimelineDateChangePayload) => {
    const startFieldName = effectiveSettings.timelineStartField;
    const endFieldName = effectiveSettings.timelineEndField;
    if (!startFieldName) {return;}

    const fields: Record<string, string> = { [startFieldName]: payload.newStartDate };
    if (endFieldName) {
      fields[endFieldName] = payload.newEndDate;
    }

    setEntries((prev) => prev.map((e) => {
      if (safeEntryId(e) !== payload.entryId) {return e;}
      const updated = { ...e, [startFieldName]: payload.newStartDate };
      if (endFieldName) {updated[endFieldName] = payload.newEndDate;}
      return updated;
    }));

    try {
      await fetch(
        `/api/workspace/objects/${encodeURIComponent(data.object.name)}/entries/${encodeURIComponent(payload.entryId)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) },
      );
    } catch { /* rollback happens on next SSE refresh */ }
  }, [effectiveSettings, data.object.name]);

  const displayFieldCandidates = data.fields.filter(
    (f) => !["relation", "boolean", "richtext"].includes(f.type),
  );

  const hasRelationFields = data.fields.some((f) => f.type === "relation");
  const hasReverseRelations =
    data.reverseRelations && data.reverseRelations.some(
      (rr) => Object.keys(rr.entries).length > 0,
    );

  const filterBarMembers = useMemo(
    () => members?.map((m) => ({ id: m.id, name: m.name })),
    [members],
  );

  // Include synthetic timestamp columns so view settings pickers can find date fields
  const fieldsWithTimestamps = useMemo(() => [
    ...data.fields,
    { id: "created_at", name: "created_at", type: "date" } as typeof data.fields[number],
    { id: "updated_at", name: "updated_at", type: "date" } as typeof data.fields[number],
  ], [data.fields]);

  // Keep the unified search input in sync with external changes to serverSearch
  // (e.g. when loading a saved view that clears search).
  useEffect(() => {
    setGlobalFilter(serverSearch);
  }, [serverSearch]);

  // Unified search handler — drives the global filter (for live UI feedback)
  // and triggers the debounced server-side search.
  const handleGlobalFilterChange = useCallback(
    (value: string) => {
      setGlobalFilter(value);
      handleServerSearch(value);
    },
    [handleServerSearch],
  );

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      {/* Unified toolbar — title + count, view switcher, search, filter, views, settings, refresh, +Add.
          Use `flex-wrap` so when the right panel is narrow the items wrap to
          a second row instead of overlapping each other. `overflow-x-auto`
          would also clip vertically (CSS quirk) and hide dropdown menus. */}
      <div
        className="px-4 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 flex-shrink-0 min-w-0"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        {/* Left: icon picker + title + count (shrinks first when space is tight) */}
        <div className="flex items-center gap-1.5 min-w-0 flex-shrink">
          <IconPicker
            value={data.object.icon ?? null}
            onChange={async (next) => {
              try {
                const res = await fetch(
                  `/api/workspace/objects/${encodeURIComponent(data.object.name)}/icon`,
                  {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ icon: next }),
                  },
                );
                if (!res.ok) return;
              } catch {
                return;
              }
              onRefreshObject();
              onRefreshTree?.();
            }}
            title={`Change icon for ${displayObjectName(data.object.name)}`}
          />
          <h1
            className="text-sm font-semibold truncate"
            style={{ color: "var(--color-text)" }}
            title={data.object.description || displayObjectName(data.object.name)}
          >
            {displayObjectName(data.object.name)}
          </h1>
          <span
            className="text-[11px] tabular-nums px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{
              color: "var(--color-text-muted)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            }}
            title={`${totalCount.toLocaleString()} ${totalCount === 1 ? "entry" : "entries"} · ${data.fields.length} fields`}
          >
            {totalCount.toLocaleString()}
          </span>
        </div>

        {/* Middle: icon-only view switcher */}
        <ViewTypeSwitcher value={currentViewType} onChange={handleViewTypeChange} />

        {/* Right: search, filter, views, settings, refresh, +Add.
            `ml-auto` pushes this cluster to the right edge whether the row
            wraps or not. */}
        <div className="ml-auto flex min-w-0 max-w-full flex-[1_1_280px] flex-wrap items-center justify-end gap-1.5">
          {/* Search input — shrinks/wraps before core actions disappear. */}
          <div
            className="flex min-w-[128px] max-w-[180px] flex-[1_1_150px] items-center gap-1.5 h-7 px-2 rounded-md focus-within:ring-2 focus-within:ring-(--color-accent)/30 transition-shadow"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
              style={{ color: "var(--color-text-muted)", opacity: 0.6 }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={globalFilter}
              onChange={(e) => handleGlobalFilterChange(e.target.value)}
              placeholder={`Search ${displayObjectName(data.object.name)}...`}
              className="w-full h-full text-[12px] bg-transparent outline-none border-0 p-0"
              style={{ color: "var(--color-text)" }}
            />
            {globalFilter && (
              <button
                type="button"
                onClick={() => handleGlobalFilterChange("")}
                className="shrink-0 h-4 w-4 rounded-full flex items-center justify-center cursor-pointer"
                style={{ color: "var(--color-text-muted)" }}
                title="Clear search"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Filter + Views (compact pills) */}
          <ObjectFilterBar
            fields={data.fields}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            savedViews={savedViews}
            activeViewName={activeViewName}
            onSaveView={handleSaveView}
            onLoadView={handleLoadView}
            onDeleteView={handleDeleteView}
            onSetActiveView={handleSetActiveView}
            members={filterBarMembers}
          />

          {/* Settings gear — description, display field, view-type settings, columns */}
          <ViewSettingsPopover
            viewType={currentViewType}
            settings={effectiveSettings}
            fields={fieldsWithTimestamps}
            onSettingsChange={handleViewSettingsChange}
            description={data.object.description}
            displayField={data.effectiveDisplayField}
            displayFieldCandidates={displayFieldCandidates}
            onDisplayFieldChange={handleDisplayFieldChange}
            updatingDisplayField={updatingDisplayField}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={handleColumnVisibilityChanged}
            stickyFirstColumn={stickyFirstColumn}
            onStickyFirstColumnChange={setStickyFirstColumn}
          />

          {/* Refresh */}
          <button
            type="button"
            onClick={handleRefresh}
            className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
            style={{ color: "var(--color-text-muted)" }}
            title="Refresh"
            aria-label="Refresh"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </button>

          {/* Add entry button */}
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] font-medium cursor-pointer transition-colors"
            style={{
              background: "var(--color-accent)",
              color: "#fff",
            }}
            title={`Add ${displayObjectNameSingular(data.object.name)}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span className="hidden md:inline">Add</span>
          </button>
        </div>
      </div>

      {/* View renderer — full-width, no padding */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {currentViewType === "kanban" && (
          <div className="h-full overflow-auto px-6 py-4">
            <ObjectKanban
              objectName={data.object.name}
              fields={data.fields}
              entries={filteredEntries}
              statuses={data.statuses}
              members={members}
              relationLabels={data.relationLabels}
              onEntryClick={handleEntryClickProp}
              onRefresh={handleRefresh}
            />
          </div>
        )}
        {currentViewType === "table" && (
          <ObjectTable
            objectName={data.object.name}
            fields={data.fields}
            entries={filteredEntries}
            members={members}
            relationLabels={data.relationLabels}
            relationFaviconUrls={data.relationFaviconUrls}
            reverseRelations={data.reverseRelations}
            onNavigateToObject={onNavigateToObject}
            onNavigateToEntry={onOpenEntry}
            onEntryClick={handleEntryClickProp}
            onRefresh={handleRefresh}
            activeEntryId={activeEntryId}
            columnVisibility={columnVisibility}
            onColumnVisibilityChanged={handleColumnVisibilityChanged}
            columnSizing={columnSizing}
            onColumnSizingChanged={handleColumnSizingChanged}
            serverPagination={serverPaginationProp}
            onServerSearch={handleServerSearch}
            onServerSort={handleServerSort}
            hideInternalToolbar
            globalFilter={globalFilter}
            onGlobalFilterChange={handleGlobalFilterChange}
            stickyFirstColumnValue={stickyFirstColumn}
            onStickyFirstColumnChange={setStickyFirstColumn}
            onAddRequest={handleOpenAddModal}
            onSelectionContextChange={onSelectionContextChange}
          />
        )}
        {currentViewType === "calendar" && (
          <div className="h-full overflow-auto px-6 py-4">
            <ObjectCalendar
              objectName={data.object.name}
              fields={data.fields}
              entries={filteredEntries}
              dateField={effectiveSettings.calendarDateField ?? ""}
              endDateField={effectiveSettings.calendarEndDateField}
              mode={effectiveSettings.calendarMode ?? "month"}
              onModeChange={(mode) => handleViewSettingsChange({ ...effectiveSettings, calendarMode: mode })}
              members={members}
              onEntryClick={handleEntryClickProp}
              onEntryDateChange={handleCalendarDateChange}
            />
          </div>
        )}
        {currentViewType === "timeline" && (
          <div className="h-full overflow-auto px-6 py-4">
            <ObjectTimeline
              objectName={data.object.name}
              fields={data.fields}
              entries={filteredEntries}
              startDateField={effectiveSettings.timelineStartField ?? ""}
              endDateField={effectiveSettings.timelineEndField}
              groupField={effectiveSettings.timelineGroupField}
              zoom={effectiveSettings.timelineZoom ?? "week"}
              onZoomChange={(zoom) => handleViewSettingsChange({ ...effectiveSettings, timelineZoom: zoom })}
              members={members}
              onEntryClick={handleEntryClickProp}
              onEntryDateChange={handleTimelineDateChange}
            />
          </div>
        )}
        {currentViewType === "gallery" && (
          <div className="h-full overflow-auto px-6 py-4">
            <ObjectGallery
              objectName={data.object.name}
              fields={data.fields}
              entries={filteredEntries}
              titleField={effectiveSettings.galleryTitleField}
              coverField={effectiveSettings.galleryCoverField}
              members={members}
              relationLabels={data.relationLabels}
              onEntryClick={handleEntryClickProp}
            />
          </div>
        )}
        {currentViewType === "list" && (
          <div className="h-full overflow-auto px-6 py-4">
            <ObjectList
              objectName={data.object.name}
              fields={data.fields}
              entries={filteredEntries}
              titleField={effectiveSettings.listTitleField}
              subtitleField={effectiveSettings.listSubtitleField}
              members={members}
              onEntryClick={handleEntryClickProp}
            />
          </div>
        )}
      </div>

      {/* Add entry modal — lifted here so +Add works from any view */}
      {showAddModal && (
        <AddEntryModal
          objectName={data.object.name}
          fields={data.fields.filter((f) => f.type !== "action")}
          members={members}
          onClose={() => setShowAddModal(false)}
          onSaved={handleRefresh}
        />
      )}
    </div>
  );
}

// --- Directory Listing ---

function DirectoryListing({
  node,
  onNodeSelect,
}: {
  node: TreeNode;
  onNodeSelect: (node: TreeNode) => void;
}) {
  const children = node.children ?? [];

  const titleText = node.type === "object" ? displayObjectName(node.name) : node.name;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1
        className={`font-instrument text-3xl tracking-tight mb-1${node.type === "object" ? "" : " capitalize"}`}
        style={{ color: "var(--color-text)" }}
      >
        {titleText}
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-text-muted)" }}>
        {children.length} items
      </p>

      {children.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          This folder is empty.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {children.map((child) => (
            <button
              type="button"
              key={child.path}
              onClick={() => onNodeSelect(child)}
              className="flex items-center gap-3 p-4 rounded-2xl text-left transition-all duration-100 cursor-pointer"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                boxShadow: "var(--shadow-sm)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor =
                  "var(--color-border-strong)";
                (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor =
                  "var(--color-border)";
                (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
              }}
            >
              <span
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background:
                    child.type === "object"
                      ? "var(--color-chip-object)"
                      : child.type === "document"
                        ? "var(--color-chip-document)"
                        : child.type === "database"
                          ? "var(--color-chip-database)"
                          : child.type === "report"
                            ? "var(--color-chip-report)"
                            : "var(--color-surface-hover)",
                  color:
                    child.type === "object"
                      ? "var(--color-chip-object-text)"
                      : child.type === "document"
                        ? "var(--color-chip-document-text)"
                        : child.type === "database"
                          ? "var(--color-chip-database-text)"
                          : child.type === "report"
                            ? "var(--color-chip-report-text)"
                            : "var(--color-text-muted)",
                }}
              >
                <NodeTypeIcon type={child.type} />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="text-sm font-medium truncate"
                  style={{ color: "var(--color-text)" }}
                >
                  {child.type === "object"
                    ? displayObjectName(child.name)
                    : child.name.replace(/\.md$/, "")}
                </div>
                <div
                  className="text-xs capitalize"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {child.type}
                  {child.children ? ` (${child.children.length})` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Welcome View (no selection) ---

function WelcomeView({
  tree,
  onNodeSelect,
}: {
  tree: TreeNode[];
  onNodeSelect: (node: TreeNode) => void;
}) {
  const objects: TreeNode[] = [];
  const documents: TreeNode[] = [];

  function collect(nodes: TreeNode[]) {
    for (const n of nodes) {
      if (n.type === "object") {objects.push(n);}
      else if (n.type === "document") {documents.push(n);}
      if (n.children) {collect(n.children);}
    }
  }
  collect(tree);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1
        className="font-instrument text-3xl tracking-tight mb-2"
        style={{ color: "var(--color-text)" }}
      >
        Workspace
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-text-muted)" }}>
        Select an item from the sidebar, or browse the sections below.
      </p>

      {objects.length > 0 && (
        <div className="mb-8">
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--color-text-muted)" }}
          >
            Objects
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {objects.map((obj) => (
              <button
                type="button"
                key={obj.path}
                onClick={() => onNodeSelect(obj)}
                className="flex items-center gap-3 p-4 rounded-2xl text-left transition-all duration-100 cursor-pointer"
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "var(--shadow-sm)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "var(--color-accent)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "var(--color-border)";
                }}
              >
                <span
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: "var(--color-chip-object)",
                    color: "var(--color-chip-object-text)",
                  }}
                >
                  <NodeTypeIcon type="object" />
                </span>
                <div className="min-w-0">
                  <div
                    className="text-sm font-medium truncate"
                    style={{ color: "var(--color-text)" }}
                  >
                    {displayObjectName(obj.name)}
                  </div>
                  <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {obj.defaultView === "kanban" ? "Kanban board" : "Table view"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {documents.length > 0 && (
        <div>
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--color-text-muted)" }}
          >
            Documents
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {documents.map((doc) => (
              <button
                type="button"
                key={doc.path}
                onClick={() => onNodeSelect(doc)}
                className="flex items-center gap-3 p-4 rounded-2xl text-left transition-all duration-100 cursor-pointer"
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "var(--shadow-sm)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--color-chip-document-text)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "var(--color-border)";
                }}
              >
                <span
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: "var(--color-chip-document)",
                    color: "var(--color-chip-document-text)",
                  }}
                >
                  <NodeTypeIcon type="document" />
                </span>
                <div className="min-w-0">
                  <div
                    className="text-sm font-medium truncate"
                    style={{ color: "var(--color-text)" }}
                  >
                    {doc.name.replace(/\.md$/, "")}
                  </div>
                  <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Document
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Shared icon for node types ---

function NodeTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "object":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v18" /><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" />
        </svg>
      );
    case "document":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />
        </svg>
      );
    case "folder":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </svg>
      );
    case "database":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5V19A9 3 0 0 0 21 19V5" />
          <path d="M3 12A9 3 0 0 0 21 12" />
        </svg>
      );
    case "report":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" x2="12" y1="20" y2="10" />
          <line x1="18" x2="18" y1="20" y2="4" />
          <line x1="6" x2="6" y1="20" y2="14" />
        </svg>
      );
    default:
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
        </svg>
      );
  }
}
