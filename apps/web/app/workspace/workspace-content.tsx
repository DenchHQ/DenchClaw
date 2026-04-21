"use client";

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { WorkspaceSidebar, FileSearch } from "../components/workspace/workspace-sidebar";
import { FileManagerTree, type TreeNode } from "../components/workspace/file-manager-tree";
import { useWorkspaceWatcher } from "../hooks/use-workspace-watcher";
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
import { parseWorkspaceLink, isWorkspaceLink, parseUrlState, buildUrl, buildWorkspaceSyncParams, type WorkspaceUrlState } from "@/lib/workspace-links";
import { isCodeFile } from "@/lib/report-utils";
import { displayObjectName, displayObjectNameSingular } from "@/lib/object-display-name";
import { isSeedPeopleObjectId, isSeedCompanyObjectId } from "@/lib/seed-object-ids";
import { CronDashboard } from "../components/cron/cron-dashboard";
import { SkillStorePanel } from "../components/skill-store/skill-store-panel";
import { IntegrationsPanel } from "../components/integrations/integrations-panel";
import { ChatComposioModalHost } from "../components/integrations/chat-composio-modal-host";
import { CloudSettingsPanel } from "../components/settings/cloud-settings-panel";
import { CronJobDetail } from "../components/cron/cron-job-detail";
import { CronSessionView } from "../components/cron/cron-session-view";
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
import { resetWorkspaceStateOnSwitch } from "./workspace-switch";
import { TabBar } from "../components/workspace/tab-bar";
import {
  type Tab, type TabState,
  HOME_TAB_ID, HOME_TAB,
  generateTabId, loadTabs, saveTabs, openTab, closeTab,
  closeOtherTabs, closeTabsToRight, closeAllTabs,
  activateTab, reorderTabs, togglePinTab, makeTabPermanent,
  inferTabType, inferTabTitle,
} from "@/lib/tab-state";
import {
  bindParentSessionToChatTab,
  closeChatTabsForSession,
  createBlankChatTab,
  isChatTab,
  openOrFocusParentChatTab,
  openOrFocusSubagentChatTab,
  openOrFocusGatewayChatTab,
  resolveChatIdentityForTab,
  syncParentChatTabTitles,
  syncSubagentChatTabTitles,
  updateChatTabTitle,
} from "@/lib/chat-tabs";
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

type ReverseRelation = {
  fieldName: string;
  sourceObjectName: string;
  sourceObjectId: string;
  displayField: string;
  entries: Record<string, Array<{ id: string; label: string }>>;
};

type ObjectData = {
  object: {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    default_view?: string;
    display_field?: string;
  };
  fields: Array<{
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
  }>;
  statuses: Array<{
    id: string;
    name: string;
    color?: string;
    sort_order?: number;
  }>;
  entries: Record<string, unknown>[];
  relationLabels?: Record<string, Record<string, string>>;
  reverseRelations?: ReverseRelation[];
  effectiveDisplayField?: string;
  savedViews?: import("@/lib/object-filters").SavedView[];
  activeView?: string;
  viewSettings?: import("@/lib/object-filters").ViewTypeSettings;
  totalCount?: number;
  page?: number;
  pageSize?: number;
};

type FileData = {
  content: string;
  type: "markdown" | "yaml" | "code" | "text";
};

type ContentState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "object"; data: ObjectData }
  | { kind: "document"; data: FileData; title: string }
  | { kind: "file"; data: FileData; filename: string }
  | { kind: "code"; data: FileData; filename: string; filePath: string }
  | { kind: "media"; url: string; mediaType: MediaType; filename: string; filePath: string }
  | { kind: "spreadsheet"; url: string; filename: string; filePath: string }
  | { kind: "html"; rawUrl: string; contentUrl: string; filename: string }
  | { kind: "database"; dbPath: string; filename: string }
  | { kind: "report"; reportPath: string; filename: string }
  | { kind: "directory"; node: TreeNode }
  | { kind: "cron-dashboard" }
  | { kind: "skill-store" }
  | { kind: "integrations" }
  | { kind: "cloud" }
  | { kind: "cron-job"; jobId: string; job: CronJob }
  | { kind: "cron-session"; jobId: string; job: CronJob; sessionId: string; run: import("../types/cron").CronRunLogEntry }
  | { kind: "duckdb-missing" }
  | { kind: "richDocument"; html: string; filePath: string; mode: "docx" | "txt" }
  | { kind: "app"; appPath: string; manifest: DenchAppManifest; filename: string }
  | { kind: "crm-inbox" }
  | { kind: "crm-calendar" }
  | { kind: "crm-person"; entryId: string }
  | { kind: "crm-company"; entryId: string };

export type DenchAppManifest = {
  name: string;
  description?: string;
  icon?: string;
  version?: string;
  author?: string;
  entry?: string;
  runtime?: "static" | "esbuild" | "build";
  permissions?: string[];
  display?: "full" | "widget";
  widget?: {
    width?: number;
    height?: number;
    refreshInterval?: number;
  };
  tools?: Array<{
    name: string;
    description: string;
    inputSchema?: unknown;
  }>;
};

type WebSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  filePath?: string;
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

/**
 * Small icon for a content tab in the unified right-panel tab strip. Picks an
 * SVG by inspecting the tab's path/type so file tabs and CRM/page tabs render
 * with a recognisable prefix even though they share the same strip.
 */
function TabIcon({ tab }: { tab: Tab }) {
  const path = tab.path ?? "";
  type IconKind =
    | "people" | "company" | "inbox" | "calendar"
    | "cloud" | "skills" | "integrations" | "cron"
    | "app" | "object" | "folder" | "file";
  const kind: IconKind = (() => {
    // People / Companies render through the standard object pipeline now,
    // so the canonical paths are `people` and `company`. The `~crm/*`
    // checks remain for back-compat with bookmarked legacy URLs.
    if (tab.type === "object" && (path === "people" || path === "~crm/people")) return "people";
    if (
      tab.type === "object" &&
      (path === "company" || path === "companies" || path === "~crm/companies")
    ) {
      return "company";
    }
    if (path === "~crm/inbox") return "inbox";
    if (path === "~crm/calendar") return "calendar";
    if (path.startsWith("~cloud")) return "cloud";
    if (path.startsWith("~skills")) return "skills";
    if (path.startsWith("~integrations")) return "integrations";
    if (path.startsWith("~cron")) return "cron";
    if (tab.type === "app" || path.includes(".dench.app")) return "app";
    if (tab.type === "object") return "object";
    if (tab.type === "file" && (!path || !path.includes("."))) return "folder";
    return "file";
  })();

  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (kind) {
    case "people":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "company":
      return (
        <svg {...common}>
          <path d="M3 21h18" />
          <path d="M5 21V7l8-4v18" />
          <path d="M19 21V11l-6-4" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...common}>
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect width="18" height="18" x="3" y="4" rx="2" />
          <path d="M16 2v4" />
          <path d="M8 2v4" />
          <path d="M3 10h18" />
        </svg>
      );
    case "cloud":
      return (
        <svg {...common}>
          <path d="M17.5 19a4.5 4.5 0 1 0-1.97-8.55A6 6 0 1 0 6 18h11.5Z" />
        </svg>
      );
    case "skills":
      return (
        <svg {...common}>
          <path d="m12 3 1.9 5.84H20l-4.95 3.6L16.95 18 12 14.4 7.05 18l1.9-5.56L4 8.84h6.1Z" />
        </svg>
      );
    case "integrations":
      return (
        <svg {...common}>
          <rect width="7" height="7" x="3" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="14" rx="1" />
          <rect width="7" height="7" x="3" y="14" rx="1" />
        </svg>
      );
    case "cron":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "app":
      return (
        <svg {...common}>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 9h6v6H9z" />
        </svg>
      );
    case "object":
      return (
        <svg {...common}>
          <path d="M3 3h18v4H3z" />
          <path d="M3 11h18v4H3z" />
          <path d="M3 19h18v2H3z" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </svg>
      );
    case "file":
    default:
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
  }
}

/**
 * v3 invariant: at least one chat tab must exist so the center never goes blank.
 * Wrap any setTabState that could remove the last chat tab with this helper.
 */
function ensureChatTabPresent(state: TabState): TabState {
  const hasChat = state.tabs.some(
    (tab) => tab.id !== HOME_TAB_ID && (tab.type === "chat" || tab.type === "gateway-chat"),
  );
  if (hasChat) return state;
  return openTab(state, createBlankChatTab(), { preview: true });
}

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
 * `"company"`, `"vc_lead"`). Walks the raw tree, including nodes that the
 * right-panel file tree hides (CRM_HIDDEN_TREE_PATHS only filters the visible
 * tree, not the underlying data). Returns `null` if no matching node exists.
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
  const out: Array<{ name: string; icon?: string; defaultView?: "table" | "kanban" }> = [];
  function walk(nodes: TreeNode[]) {
    for (const node of nodes) {
      if (node.type === "object") {
        const name = objectNameFromPath(node.path);
        if (!CRM_NAV_EXCLUDED_OBJECT_NAMES.has(name)) {
          out.push({ name, icon: node.icon, defaultView: node.defaultView });
        }
      }
      if (node.children) {walk(node.children);}
    }
  }
  walk(tree);
  return out.toSorted((a, b) => a.name.localeCompare(b.name));
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
        <div className="flex h-screen items-center justify-center" style={{ background: "var(--color-bg)" }}>
          <UnicodeSpinner name="braille" className="text-2xl" style={{ color: "var(--color-text-muted)" }} />
        </div>
      }>
        <WorkspacePageInner />
      </Suspense>
    </ToastProvider>
  );
}


function WorkspacePageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hydrationPhase = useRef<"init" | "hydrated">("init");
  const postHydrationRender = useRef(false);
  const lastPushedQs = useRef<string | null>(null);

  // Visible main chat panel ref for session management
  const chatRef = useRef<ChatPanelHandle>(null);
  // Mounted main chat panels keyed by tab id so inactive tabs can keep streaming.
  const chatPanelRefs = useRef<Record<string, ChatPanelHandle | null>>({});
  // Root layout ref for resize handle position (handle follows cursor)
  const layoutRef = useRef<HTMLDivElement>(null);

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
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState<ContentState>({ kind: "none" });

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

  // v3: independent active tab ids per surface.
  // - activeChatTabId: which chat tab is visible in the center (always a chat or gateway-chat tab).
  // - activeContentTabId: which content tab is visible in the right panel, or null for Files home.
  const [activeChatTabId, setActiveChatTabId] = useState<string | null>(null);
  const [activeContentTabId, setActiveContentTabId] = useState<string | null>(null);

  // Terminal drawer state
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [pendingComposioAction, setPendingComposioAction] = useState<ComposioChatAction | null>(null);

  // Tab state -- always starts with the home tab
  const [tabState, setTabState] = useState<TabState>({ tabs: [HOME_TAB], activeTabId: HOME_TAB_ID });
  // Track which workspace we loaded tabs for, so we reload if the workspace switches
  // and don't save until we've loaded first.
  const tabLoadedForWorkspace = useRef<string | null>(null);
  const tabStateRef = useRef<TabState>({ tabs: [HOME_TAB], activeTabId: HOME_TAB_ID });

  // Load tabs from localStorage once workspace name is known
  useEffect(() => {
    const key = workspaceName || null;
    if (tabLoadedForWorkspace.current === key) return;
    tabLoadedForWorkspace.current = key;
    const loaded = loadTabs(key);
    // v3: ensure restored tab state always has at least one chat tab so the
    // center is never blank — even when localStorage only stored file/CRM tabs.
    setTabState(ensureChatTabPresent(loaded));
    setChatRuntimeSnapshots({});
  }, [workspaceName]);

  // Persist tabs to localStorage on change (only after hydration completes)
  useEffect(() => {
    if (hydrationPhase.current !== "hydrated") return;
    saveTabs(tabState, workspaceName || null);
  }, [tabState, workspaceName]);

  useEffect(() => {
    const validTabIds = new Set(tabState.tabs.map((tab) => tab.id));
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
  }, [tabState.tabs]);

  // Ref for the keyboard shortcut to close the active tab (avoids stale closure over loadContent)
  const tabCloseActiveRef = useRef<(() => void) | null>(null);
  const activeTab = useMemo(
    () => tabState.tabs.find((tab) => tab.id === tabState.activeTabId) ?? HOME_TAB,
    [tabState],
  );
  const mainChatTabs = useMemo(
    () => tabState.tabs.filter((tab) => tab.id !== HOME_TAB_ID && (tab.type === "chat" || tab.type === "gateway-chat")),
    [tabState.tabs],
  );

  useEffect(() => {
    tabStateRef.current = tabState;
  }, [tabState]);

  // v3: chat-switching handlers must NOT touch the right panel's activePath/content.
  // The right panel's state is independent of which chat is shown in the center.
  const openBlankChatTab = useCallback(() => {
    const tab = createBlankChatTab();
    setActiveSessionId(null);
    setActiveSubagentKey(null);
    setTabState((prev) => openTab(prev, tab, { preview: true }));
    return tab;
  }, []);

  const openPermanentBlankChatTab = useCallback(() => {
    const tab = createBlankChatTab();
    setActiveSessionId(null);
    setActiveSubagentKey(null);
    setTabState((prev) => openTab(prev, tab, { preview: false }));
    return tab;
  }, []);

  const openSessionChatTab = useCallback((sessionId: string, title?: string) => {
    setActiveSessionId(sessionId);
    setActiveSubagentKey(null);
    setTabState((prev) => openOrFocusParentChatTab(prev, { sessionId, title }, { preview: true }));
  }, []);

  const openSubagentChatTab = useCallback((params: {
    sessionKey: string;
    parentSessionId: string;
    title?: string;
  }) => {
    setActiveSessionId(params.parentSessionId);
    setActiveSubagentKey(params.sessionKey);
    setTabState((prev) => openOrFocusSubagentChatTab(prev, params, { preview: true }));
  }, []);

  const openGatewayChatTab = useCallback((sessionKey: string, sessionId: string, channel?: string, title?: string) => {
    setActiveSessionId(null);
    setActiveSubagentKey(null);
    setActiveGatewaySessionKey(sessionKey);
    setTabState((prev) => openOrFocusGatewayChatTab(prev, {
      sessionKey,
      sessionId,
      channel: channel ?? "unknown",
      title: title ?? "Channel Chat",
    }, { preview: true }));
  }, []);

  const promoteTabById = useCallback((tabId: string | null | undefined) => {
    if (!tabId || tabId === HOME_TAB_ID) {
      return;
    }
    setTabState((prev) => makeTabPermanent(prev, tabId));
  }, []);

  const promoteTabByPath = useCallback((path: string | null | undefined) => {
    if (!path) {
      return;
    }
    setTabState((prev) => {
      const matchingTab = prev.tabs.find((tab) => tab.path === path);
      return matchingTab ? makeTabPermanent(prev, matchingTab.id) : prev;
    });
  }, []);

  // v3: the center chat is decoupled from tabState.activeTabId so that opening a file / CRM / cloud
  // on the right panel never changes which chat is visible in the center.
  const visibleMainChatTabId = useMemo(() => {
    if (activeChatTabId) {
      const pinned = mainChatTabs.find((tab) => tab.id === activeChatTabId);
      if (pinned) return pinned.id;
    }
    if (activeGatewaySessionKey) {
      const matchingGwTab = mainChatTabs.find((tab) => tab.type === "gateway-chat" && tab.sessionKey === activeGatewaySessionKey);
      if (matchingGwTab) return matchingGwTab.id;
    }
    if (activeSubagentKey) {
      const matchingSubagentTab = mainChatTabs.find((tab) => tab.sessionKey === activeSubagentKey);
      if (matchingSubagentTab) {
        return matchingSubagentTab.id;
      }
    }
    if (activeSessionId) {
      const matchingParentTab = mainChatTabs.find((tab) => tab.sessionId === activeSessionId);
      if (matchingParentTab) {
        return matchingParentTab.id;
      }
    }
    return mainChatTabs[0]?.id ?? null;
  }, [activeChatTabId, activeSessionId, activeSubagentKey, activeGatewaySessionKey, mainChatTabs]);

  useEffect(() => {
    if (activeTab.type !== "chat" && activeTab.type !== "gateway-chat") {
      return;
    }
    const identity = resolveChatIdentityForTab(activeTab);
    setActiveSessionId((prev) => prev === identity.sessionId ? prev : identity.sessionId);
    setActiveSubagentKey((prev) => prev === identity.subagentKey ? prev : identity.subagentKey);
    setActiveGatewaySessionKey((prev) => prev === identity.gatewaySessionKey ? prev : identity.gatewaySessionKey);
  }, [activeTab]);

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
    setTabState((prev) => {
      let next = bindParentSessionToChatTab(prev, tabId, sessionId);
      if (sessionId && prev.activeTabId === HOME_TAB_ID) {
        next = activateTab(next, tabId);
      }
      return next;
    });
    if (tabState.activeTabId === tabId || tabState.activeTabId === HOME_TAB_ID || visibleMainChatTabId === tabId) {
      setActiveSessionId(sessionId);
      setActiveSubagentKey(null);
    }
  }, [tabState.activeTabId, visibleMainChatTabId]);

  const sendMessageInChatTab = useCallback((tabId: string, message: string) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void chatPanelRefs.current[tabId]?.sendNewMessage(message);
      });
    });
  }, []);

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

  const openTabForNode = useCallback((
    node: { path: string; name: string; type: string },
    options?: { preview?: boolean },
  ) => {
    const isObject = node.type === "object";
    const title = isObject
      ? displayObjectName(node.name)
      : inferTabTitle(node.path, node.name);
    const tab: Tab = {
      id: generateTabId(),
      type: isObject ? "object" : inferTabType(node.path),
      title,
      path: node.path,
    };
    setTabState((prev) => openTab(prev, tab, { preview: options?.preview ?? true }));
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
      content.kind === "directory" ||
      isVirtualPath(activePath) ||
      content.kind === "crm-inbox" ||
      content.kind === "crm-calendar";
    return { path: activePath, filename, isDirectory };
  }, [activePath, content.kind]);

  // Update content state when the agent edits the file (live reload)
  const handleFileChanged = useCallback((newContent: string) => {
    setContent((prev) => {
      if (prev.kind === "document") {
        return { ...prev, data: { ...prev.data, content: newContent } };
      }
      if (prev.kind === "file" || prev.kind === "code") {
        return { ...prev, data: { ...prev.data, content: newContent } };
      }
      return prev;
    });
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
        setActivePath,
        setContent,
        setActiveSessionId,
        setActiveSubagentKey,
        resetMainChat: () => {
          chatPanelRefs.current = {};
          setChatRuntimeSnapshots({});
          setChatRunsSnapshot(createChatRunsSnapshot({ parentRuns: [], subagents: [] }));
          setStreamingSessionIds(new Set());
          setSubagents([]);
          setTabState({ tabs: [HOME_TAB], activeTabId: HOME_TAB_ID });
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
        tabState.tabs
          .filter((tab) => tab.type === "chat" && (tab.sessionId === sessionId || tab.parentSessionId === sessionId))
          .map((tab) => tab.id),
      );
      setTabState((prev) => {
        let next = closeChatTabsForSession(prev, sessionId);
        const hasChatTab = next.tabs.some(
          (tab) => tab.id !== HOME_TAB_ID && (tab.type === "chat" || tab.type === "gateway-chat"),
        );
        if (!hasChatTab) {
          next = openTab(next, createBlankChatTab(), { preview: true });
        }
        return next;
      });
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
    [activeSessionId, sessions, fetchSessions, openBlankChatTab, openSessionChatTab, tabState.tabs],
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

  // Load content when path changes
  const loadContent = useCallback(
    async (node: TreeNode) => {
      setActivePath(node.path);
      setContent({ kind: "loading" });
      // Any navigation into a file/object/folder replaces the right-panel
      // view, so a stale entry-detail-panel must not float on top of it.
      setEntryModal(null);

      try {
        if (node.type === "object") {
          const name = objectNameFromPath(node.path);
          const fetchObject = async (): Promise<
            | { status: "ok"; data: ObjectData }
            | { status: "retryable" }
            | { status: "duckdb-missing" }
            | { status: "fatal" }
          > => {
            const res = await fetch(`/api/workspace/objects/${encodeURIComponent(name)}`);
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              if (errData.code === "DUCKDB_NOT_INSTALLED") {
                return { status: "duckdb-missing" };
              }
              if (res.status === 404 || res.status >= 500) {
                return { status: "retryable" };
              }
              return { status: "fatal" };
            }
            return { status: "ok", data: await res.json() };
          };

          let result = await fetchObject();
          if (result.status === "retryable") {
            await new Promise((r) => setTimeout(r, 150));
            result = await fetchObject();
          }
          if (result.status === "duckdb-missing") {
            setContent({ kind: "duckdb-missing" });
            return;
          }
          if (result.status !== "ok") {
            setContent({ kind: "none" });
            return;
          }

          let data = result.data;
          if (data.fields.length === 0 && data.entries.length > 0) {
            await new Promise((r) => setTimeout(r, 200));
            const retry = await fetchObject();
            if (retry.status === "duckdb-missing") {
              setContent({ kind: "duckdb-missing" });
              return;
            }
            if (retry.status === "ok") {
              data = retry.data;
            }
          }
          setContent({ kind: "object", data });
        } else if (node.type === "document") {
          // Use virtual-file API for ~skills/ paths
          const res = await fetch(fileApiUrl(node.path));
          if (!res.ok) {
            setContent({ kind: "none" });
            return;
          }
          const data: FileData = await res.json();
          setContent({
            kind: "document",
            data,
            title: node.name.replace(/\.md$/, ""),
          });
        } else if (node.type === "database") {
          setContent({ kind: "database", dbPath: node.path, filename: node.name });
        } else if (node.type === "report") {
          setContent({ kind: "report", reportPath: node.path, filename: node.name });
        } else if (node.type === "file") {
          if (isSpreadsheetFile(node.name)) {
            const url = rawFileUrl(node.path);
            setContent({ kind: "spreadsheet", url, filename: node.name, filePath: node.path });
            return;
          }

          // DOCX files: fetch binary, convert to HTML with mammoth
          if (isDocxFile(node.name)) {
            try {
              const rawRes = await fetch(rawFileUrl(node.path));
              if (!rawRes.ok) { setContent({ kind: "none" }); return; }
              const arrayBuffer = await rawRes.arrayBuffer();
              const mammoth = await import("mammoth");
              const result = await mammoth.convertToHtml({ arrayBuffer });
              setContent({ kind: "richDocument", html: result.value, filePath: node.path, mode: "docx" });
            } catch {
              setContent({ kind: "none" });
            }
            return;
          }

          // TXT files: fetch text content and open in rich editor
          if (isTxtFile(node.name)) {
            const res = await fetch(fileApiUrl(node.path));
            if (!res.ok) { setContent({ kind: "none" }); return; }
            const data: FileData = await res.json();
            setContent({ kind: "richDocument", html: textToHtml(data.content), filePath: node.path, mode: "txt" });
            return;
          }

          // HTML files get an iframe preview
          const ext = node.name.split(".").pop()?.toLowerCase() ?? "";
          if (ext === "html" || ext === "htm") {
            setContent({ kind: "html", rawUrl: rawFileUrl(node.path), contentUrl: fileApiUrl(node.path), filename: node.name });
            return;
          }

          // Check if this is a media file (image/video/audio/pdf)
          const mediaType = detectMediaType(node.name);
          if (mediaType) {
            const url = rawFileUrl(node.path);
            setContent({ kind: "media", url, mediaType, filename: node.name, filePath: node.path });
            return;
          }

          const res = await fetch(fileApiUrl(node.path));
          if (!res.ok) {
            setContent({ kind: "none" });
            return;
          }
          const data: FileData = await res.json();
          if (isCodeFile(node.name)) {
            setContent({ kind: "code", data, filename: node.name, filePath: node.path });
          } else {
            setContent({ kind: "file", data, filename: node.name });
          }
        } else if (node.type === "app") {
          // Fetch manifest from the tree node or API
          const manifestRes = await fetch(`/api/apps?app=${encodeURIComponent(node.path)}&file=.dench.yaml&meta=1`);
          let manifest: DenchAppManifest = { name: node.name };
          if (manifestRes.ok) {
            try { manifest = await manifestRes.json(); } catch { /* use default */ }
          }
          setContent({ kind: "app", appPath: node.path, manifest, filename: node.name });
        } else if (node.type === "folder") {
          setContent({ kind: "directory", node });
        }
      } catch {
        setContent({ kind: "none" });
      }
    },
    [],
  );

  // Open the right panel and widen it so the chat stays at its min width.
  // Used when the user clicks something that needs the right panel to be visible.
  const ensureRightPanelOpenWide = useCallback(() => {
    if (typeof window === "undefined") {
      setRightPanelCollapsed(false);
      return;
    }
    const CHAT_MIN = 420;
    const ideal = window.innerWidth - leftSidebarWidth - CHAT_MIN;
    const wideTarget = clamp(ideal, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX);
    setRightPanelCollapsed(false);
    setRightPanelWidth((current) => Math.max(current, wideTarget));
  }, [leftSidebarWidth]);

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
        // already open, openTab() switches to it.
        openTabForNode(node, { preview: false });
        void loadContent(node);
        return;
      }

      const config = {
        cloud: { path: "~cloud", name: "Cloud", kind: "cloud" as const },
        integrations: { path: "~integrations", name: "Integrations", kind: "integrations" as const },
        skills: { path: "~skills", name: "Skills", kind: "skill-store" as const },
        cron: { path: "~cron", name: "Cron", kind: "cron-dashboard" as const },
        "crm-inbox": { path: "~crm/inbox", name: "Inbox", kind: "crm-inbox" as const },
        "crm-calendar": { path: "~crm/calendar", name: "Calendar", kind: "crm-calendar" as const },
      }[target];
      openTabForNode({ path: config.path, name: config.name, type: "folder" }, { preview: false });
      setActivePath(config.path);
      setContent({ kind: config.kind });
      setEntryModal(null);
    },
    [openTabForNode, tree, loadContent, ensureRightPanelOpenWide],
  );

  const handleComposioActionFromChat = useCallback((action: ComposioChatAction) => {
    setPendingComposioAction({
      action: action.action,
      toolkitSlug: action.toolkitSlug ?? null,
      toolkitName: action.toolkitName ?? null,
    });
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
            setActivePath(null);
            setContent({ kind: "none" });
            openBlankChatTab();
            return;
          }
        }
        // Clicking a folder in browse mode → navigate into it so the tree
        // is fetched fresh, AND show it in the main panel with the chat sidebar.
        // Children come from the live tree (same data source as the sidebar),
        // not from the stale node snapshot.
        if (node.type === "folder") {
          setBrowseDir(node.path);
          openTabForNode(node);
          setActivePath(node.path);
          setContent({ kind: "directory", node: { name: node.name, path: node.path, type: "folder" } });
          setEntryModal(null);
          return;
        }
      }

      // --- Virtual path handlers (workspace mode) ---
      // Intercept chat folder item clicks
      if (node.path.startsWith("~chats/")) {
        const sessionId = node.path.slice("~chats/".length);
        openSessionChatTab(sessionId);
        return;
      }
      // Clicking the Chats folder itself opens a new chat
      if (node.path === "~chats") {
        openBlankChatTab();
        return;
      }
      // Intercept cron job item clicks
      if (node.path.startsWith("~cron/")) {
        const jobId = node.path.slice("~cron/".length);
        const job = cronJobs.find((j) => j.id === jobId);
        if (job) {
          openTabForNode(node);
          setActivePath(node.path);
          setContent({ kind: "cron-job", jobId, job });
          setEntryModal(null);
          return;
        }
      }
      // Clicking the Cron folder itself opens the dashboard
      if (node.path === "~cron") {
        openTabForNode(node);
        setActivePath(node.path);
        setContent({ kind: "cron-dashboard" });
        setEntryModal(null);
        return;
      }
      if (node.path === "~skills") {
        handleNavigate("skills");
        return;
      }
      if (node.path === "~integrations") {
        handleNavigate("integrations");
        return;
      }
      if (node.path === "~cloud") {
        handleNavigate("cloud");
        return;
      }
      // Workspace-mode folders are expanded/collapsed inline in the sidebar
      // tree — don't open them in the main content panel.
      if (node.type === "folder") {
        return;
      }
      openTabForNode(node);
      void loadContent(node);
    },
    [loadContent, openBlankChatTab, openSessionChatTab, openTabForNode, cronJobs, browseDir, workspaceRoot, openclawDir, setBrowseDir, handleNavigate],
  );

  const applyActivatedTab = useCallback((tab: Tab | undefined) => {
    if (!tab || tab.id === HOME_TAB_ID) {
      return;
    }
    if (tab.type === "chat" || tab.type === "gateway-chat") {
      // v3: don't touch activePath/content — right panel state is independent of chat tabs.
      const identity = resolveChatIdentityForTab(tab);
      setActiveSessionId(identity.sessionId);
      setActiveSubagentKey(identity.subagentKey);
      setActiveGatewaySessionKey(identity.gatewaySessionKey);
      return;
    }
    if (tab.path) {
      const node = resolveNode(tree, tab.path);
      setActivePath(tab.path);
      // Activating a non-chat tab swaps the right-panel view; close any
      // entry-detail panel that was open against the previously-active tab.
      setEntryModal(null);
      if (node) {
        setContent({ kind: "loading" });
        void loadContent(node);
      } else if (tab.path === "~cron") {
        setContent({ kind: "cron-dashboard" });
      } else if (tab.path === "~skills") {
        setContent({ kind: "skill-store" });
      } else if (tab.path === "~integrations") {
        setContent({ kind: "integrations" });
      } else if (tab.path === "~cloud") {
        setContent({ kind: "cloud" });
      } else if (tab.path.startsWith("~cron/")) {
        const jobId = tab.path.slice("~cron/".length);
        const job = cronJobs.find((j) => j.id === jobId);
        if (job) setContent({ kind: "cron-job", jobId, job });
      } else {
        const fileName = tab.title || tab.path.split("/").pop() || tab.path;
        const syntheticNode: TreeNode = {
          name: fileName,
          path: tab.path,
          type: tab.type === "object" ? "object" : inferNodeTypeFromFileName(fileName),
        };
        setContent({ kind: "loading" });
        void loadContent(syntheticNode);
      }
    }
  }, [tree, loadContent, cronJobs]);

  // Tab handler callbacks (defined after loadContent is available)
  const handleTabActivate = useCallback((tabId: string) => {
    const requestedTab = tabStateRef.current.tabs.find((entry) => entry.id === tabId);
    if (tabId === HOME_TAB_ID) {
      setTabState((prev) => {
        let next = activateTab(prev, tabId);
        const chatTabs = next.tabs.filter((t) => t.id !== HOME_TAB_ID && isChatTab(t));
        const hasBlankChat = chatTabs.some((t) => !t.sessionId && !t.sessionKey);
        if (!hasBlankChat) {
          next = {
            ...openTab(next, createBlankChatTab(), { preview: true }),
            activeTabId: HOME_TAB_ID,
          };
        }
        return next;
      });
      setActiveSessionId(null);
      setActiveSubagentKey(null);
      setActiveGatewaySessionKey(null);
      applyActivatedTab(undefined);
      return;
    }
    setTabState((prev) => activateTab(prev, tabId));
    applyActivatedTab(requestedTab);
  }, [applyActivatedTab]);

  const handleTabClose = useCallback((tabId: string) => {
    const prev = tabState;
    let next = closeTab(prev, tabId);
    // v3: a chat tab must always exist so the center never goes blank.
    next = ensureChatTabPresent(next);
    setTabState(next);
    if (next.activeTabId !== prev.activeTabId) {
      const newActive = next.tabs.find((t) => t.id === next.activeTabId);
      if (!newActive || newActive.id === HOME_TAB_ID) {
        const identity = resolveChatIdentityForTab(next.tabs.find((tab) => tab.type === "chat"));
        setActiveSessionId(identity.sessionId);
        setActiveSubagentKey(identity.subagentKey);
        applyActivatedTab(undefined);
      } else {
        applyActivatedTab(newActive);
      }
    }
  }, [applyActivatedTab, tabState]);

  // Keep ref in sync so keyboard shortcut can close active tab
  useEffect(() => {
    tabCloseActiveRef.current = () => {
      if (tabState.activeTabId) {
        handleTabClose(tabState.activeTabId);
      }
    };
  }, [tabState.activeTabId, handleTabClose]);

  const handleTabCloseOthers = useCallback((tabId: string) => {
    const next = ensureChatTabPresent(closeOtherTabs(tabState, tabId));
    setTabState(next);
    applyActivatedTab(next.tabs.find((tab) => tab.id === next.activeTabId));
  }, [applyActivatedTab, tabState]);

  const handleTabCloseToRight = useCallback((tabId: string) => {
    const next = ensureChatTabPresent(closeTabsToRight(tabState, tabId));
    setTabState(next);
    applyActivatedTab(next.tabs.find((tab) => tab.id === next.activeTabId));
  }, [applyActivatedTab, tabState]);

  const handleTabCloseAll = useCallback(() => {
    setTabState((prev) => {
      const closed = closeAllTabs(prev);
      setActivePath(null);
      setContent({ kind: "none" });
      setActiveSessionId(null);
      setActiveSubagentKey(null);
      setEntryModal(null);
      return openTab(closed, createBlankChatTab());
    });
  }, []);

  const handleTabReorder = useCallback((tabId: string, from: number, to: number) => {
    setTabState((prev) => reorderTabs(makeTabPermanent(prev, tabId), from, to));
  }, []);

  const handleTabTogglePin = useCallback((tabId: string) => {
    setTabState((prev) => togglePinTab(prev, tabId));
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

  // Build the enhanced tree: real tree + workspace management virtual folders
  // (Chat sessions live in the right sidebar, not in the tree.)
  // In browse mode, skip virtual folders (they only apply to workspace mode)
  // Hide CRM-bound object tables from the right panel file tree.
  // They're accessible via the left sidebar CRM nav (People / Companies / Inbox / Calendar),
  // so showing them here is redundant and caused a visual flicker when the tree re-fetched.
  const CRM_HIDDEN_TREE_PATHS = useMemo(() => new Set([
    "people",
    "company",
    "companies",
    "email_thread",
    "email_message",
    "calendar_event",
    "interaction",
  ]), []);
  // The file-tree version: hides the hardcoded CRM tables AND any
  // object-typed node (task, deal, ...) because those already get their
  // own entry in the sidebar's CRM nav. Keeping them in the file tree
  // too is duplicate chrome the user has to scroll past.
  const enhancedTree = useMemo(
    () =>
      tree.filter(
        (node) =>
          !CRM_HIDDEN_TREE_PATHS.has(node.path) && node.type !== "object",
      ),
    [tree, CRM_HIDDEN_TREE_PATHS],
  );
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
    setTabState((prev) => {
      let next = activateTab(prev, HOME_TAB_ID);
      const chatTabs = next.tabs.filter((t) => t.id !== HOME_TAB_ID && isChatTab(t));
      const hasBlankChat = chatTabs.some((t) => !t.sessionId && !t.sessionKey);
      if (!hasBlankChat) {
        next = {
          ...openTab(next, createBlankChatTab(), { preview: true }),
          activeTabId: HOME_TAB_ID,
        };
      }
      return next;
    });
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
      if (item.type === "folder") {
        if (browseDir != null) {
          setBrowseDir(item.path);
        }
        openTabForNode(node);
        setActivePath(itemPath);
        setContent({ kind: "directory", node: { name: item.name, path: itemPath, type: "folder" } });
        setEntryModal(null);
      } else {
        if (browseDir != null) {
          const parentOfFile = item.path.split("/").slice(0, -1).join("/") || "/";
          setBrowseDir(parentOfFile);
        }
        openTabForNode(node);
        void loadContent(node);
      }
    },
    [browseDir, workspaceRoot, setBrowseDir, openTabForNode, loadContent],
  );

  // Sync URL bar with active content / chat / browse / subagent / preview state.
  // Uses window.location instead of searchParams in the comparison to
  // avoid a circular dependency (searchParams updates → effect fires →
  // router.replace → searchParams updates → …).
  //
  // Gated by hydrationPhase: skips entirely until hydration is done.
  // On the first render after hydration, skips once (via postHydrationRender)
  // because React state (activePath, etc.) hasn't propagated yet.
  //
  // This effect only manages shell-level params (path, chat, browse, etc.)
  // and preserves object-view params (viewType, filters, search, sort, etc.)
  // that are managed by ObjectView's own URL sync effect.
  useEffect(() => {
    if (hydrationPhase.current !== "hydrated") return;

    if (postHydrationRender.current) {
      postHydrationRender.current = false;
      return;
    }

    const current = new URLSearchParams(window.location.search);
    const params = buildWorkspaceSyncParams({
      activePath,
      activeSessionId,
      activeSubagentKey,
      fileChatSessionId: null,
      entryModal,
      browseDir,
      showHidden,
      previewPath: null,
      terminalOpen,
      cronView,
      cronCalMode,
      cronDate,
      cronRunFilter,
      cronRun,
    }, current);

    const nextQs = params.toString();
    const currentQs = current.toString();

    if (nextQs !== currentQs) {
      lastPushedQs.current = nextQs;
      const url = nextQs ? `/?${nextQs}` : "/";
      router.push(url, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes searchParams to avoid infinite loop; hydrationPhase is a ref gate
  }, [activePath, activeSessionId, activeSubagentKey, entryModal, browseDir, showHidden, router, cronView, cronCalMode, cronDate, cronRunFilter, cronRun]);

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
        const node = resolveCrmObjectNode(tree, "people");
        openTabForNode(node);
        setActivePath(node.path);
        setContent({ kind: "crm-person", entryId });
        setEntryModal(null);
      } else if (isSeedCompany) {
        const node = resolveCrmObjectNode(tree, "company");
        openTabForNode(node);
        setActivePath(node.path);
        setContent({ kind: "crm-company", entryId });
        setEntryModal(null);
      } else {
        setEntryModal({ objectName, entryId });
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set("entry", `${objectName}:${entryId}`);
      router.push(`/?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, openTabForNode, tree],
  );

  // Close entry modal handler
  const handleCloseEntry = useCallback(() => {
    setEntryModal(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("entry");
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }, [searchParams, router]);

  // Hydrate state from URL query params after tree and tabs are ready.
  // Waits for BOTH prerequisites before running:
  //   1. tree loaded (!treeLoading && tree.length > 0)
  //   2. tabs loaded from localStorage (tabLoadedForWorkspace matches)
  // Runs exactly once, then transitions hydrationPhase to 'hydrated'.
  useEffect(() => {
    if (hydrationPhase.current !== "init") return;
    if (treeLoading || tree.length === 0) return;
    if (tabLoadedForWorkspace.current !== (workspaceName || null)) return;

    const urlState = parseUrlState(searchParams);

    if (urlState.path) {
      const node = resolveNode(tree, urlState.path);
      if (node) {
        openTabForNode(node);
        void loadContent(node);
      } else if (urlState.path === "~cron") {
        openTabForNode({ path: "~cron", name: "Cron", type: "folder" });
        setActivePath("~cron");
        setContent({ kind: "cron-dashboard" });
        if (urlState.cronView) setCronView(urlState.cronView);
        if (urlState.cronCalMode) setCronCalMode(urlState.cronCalMode);
        if (urlState.cronDate) setCronDate(urlState.cronDate);
      } else if (urlState.path.startsWith("~cron/")) {
        openTabForNode({ path: urlState.path, name: urlState.path.split("/").pop() || "Cron Job", type: "file" });
        setActivePath(urlState.path);
        setContent({ kind: "cron-dashboard" });
        if (urlState.cronRunFilter) setCronRunFilter(urlState.cronRunFilter);
        if (urlState.cronRun != null) setCronRun(urlState.cronRun);
      } else if (urlState.path === "~skills") {
        openTabForNode({ path: "~skills", name: "Skills", type: "folder" });
        setActivePath("~skills");
        setContent({ kind: "skill-store" });
      } else if (urlState.path === "~integrations") {
        openTabForNode({ path: "~integrations", name: "Integrations", type: "folder" });
        setActivePath("~integrations");
        setContent({ kind: "integrations" });
      } else if (urlState.path === "~cloud") {
        openTabForNode({ path: "~cloud", name: "Cloud", type: "folder" });
        setActivePath("~cloud");
        setContent({ kind: "cloud" });
      } else if (urlState.path.startsWith("~crm/")) {
        const view = urlState.path.slice("~crm/".length).split("/")[0];
        // People / Companies legacy URLs (`?path=~crm/people`) now resolve
        // the underlying workspace object so the standard ObjectView renders.
        if (view === "people" || view === "companies") {
          const node = resolveCrmObjectNode(tree, view === "people" ? "people" : "company");
          openTabForNode(node);
          void loadContent(node);
        } else {
          const map: Record<string, { name: string; kind: "crm-inbox" | "crm-calendar" } | undefined> = {
            inbox: { name: "Inbox", kind: "crm-inbox" },
            calendar: { name: "Calendar", kind: "crm-calendar" },
          };
          const entry = map[view];
          if (entry) {
            openTabForNode({ path: urlState.path, name: entry.name, type: "folder" });
            setActivePath(urlState.path);
            setContent({ kind: entry.kind });
          }
        }
      } else if (isAbsolutePath(urlState.path) || isHomeRelativePath(urlState.path)) {
        const name = urlState.path.split("/").pop() || urlState.path;
        const syntheticNode: TreeNode = { name, path: urlState.path, type: "file" };
        openTabForNode(syntheticNode);
        void loadContent(syntheticNode);
      }
    } else if (urlState.crm) {
      // Top-level CRM view. People / Companies route through the standard
      // ObjectView; Inbox / Calendar keep their dedicated content kinds.
      if (urlState.crm === "people" || urlState.crm === "companies") {
        const node = resolveCrmObjectNode(tree, urlState.crm === "people" ? "people" : "company");
        openTabForNode(node);
        void loadContent(node);
      } else {
        const map = {
          inbox: { path: "~crm/inbox", name: "Inbox", kind: "crm-inbox" as const },
          calendar: { path: "~crm/calendar", name: "Calendar", kind: "crm-calendar" as const },
        }[urlState.crm];
        openTabForNode({ path: map.path, name: map.name, type: "folder" });
        setActivePath(map.path);
        setContent({ kind: map.kind });
      }
    } else if (urlState.chat) {
      if (urlState.subagent) {
        openSubagentChatTab({
          sessionKey: urlState.subagent,
          parentSessionId: urlState.chat,
          title: "Subagent",
        });
      } else {
        openSessionChatTab(urlState.chat);
      }
    } else {
      const restoredTab = tabState.tabs.find((t) => t.id === tabState.activeTabId);
      if (restoredTab && restoredTab.id !== HOME_TAB_ID) {
        applyActivatedTab(restoredTab);
      }
    }

    if (urlState.entry) {
      // People + Company entries get the dedicated profile UI in the main
      // panel (mirrors dench-2025's "base object full screen" pattern).
      // Other objects keep the existing side-panel entry modal flow. The
      // parent tab points at the resolved workspace object so navigating
      // back lands on the unified ObjectView.
      if (urlState.entry.objectName === "people") {
        const node = resolveCrmObjectNode(tree, "people");
        openTabForNode(node);
        setActivePath(node.path);
        setContent({ kind: "crm-person", entryId: urlState.entry.entryId });
      } else if (
        urlState.entry.objectName === "company" ||
        urlState.entry.objectName === "companies"
      ) {
        const node = resolveCrmObjectNode(tree, "company");
        openTabForNode(node);
        setActivePath(node.path);
        setContent({ kind: "crm-company", entryId: urlState.entry.entryId });
      } else {
        setEntryModal(urlState.entry);
      }
    }
    if (urlState.browse) {
      setBrowseDir(urlState.browse);
    }
    if (urlState.hidden) {
      setShowHidden(true);
    }
    if (urlState.terminal) {
      setTerminalOpen(true);
    }

    postHydrationRender.current = true;
    hydrationPhase.current = "hydrated";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrationPhase is a ref gate, runs exactly once
  }, [tree, treeLoading, searchParams, workspaceName, tabState, loadContent, applyActivatedTab, setBrowseDir, setShowHidden]);

  // Handle browser back/forward navigation.
  // When the user clicks Back/Forward, the URL changes but the app doesn't
  // re-render with new state. We listen for popstate and re-apply URL state.
  useEffect(() => {
    const handlePopState = () => {
      const qs = window.location.search.replace(/^\?/, "");
      // Skip if this matches what the app last pushed (not a real back/forward)
      if (qs === lastPushedQs.current) return;

      const urlState = parseUrlState(window.location.search);

      if (urlState.path) {
        const node = resolveNode(tree, urlState.path);
        if (node) {
          openTabForNode(node);
          void loadContent(node);
        } else if (urlState.path === "~cron") {
          openTabForNode({ path: "~cron", name: "Cron", type: "folder" });
          setActivePath("~cron");
          setContent({ kind: "cron-dashboard" });
        } else if (urlState.path.startsWith("~cron/")) {
          openTabForNode({ path: urlState.path, name: urlState.path.split("/").pop() || "Cron Job", type: "file" });
          setActivePath(urlState.path);
          const jobId = urlState.path.slice("~cron/".length);
          const job = cronJobs.find((j) => j.id === jobId);
          if (job) {
            setContent({ kind: "cron-job", jobId, job });
          } else {
            setContent({ kind: "cron-dashboard" });
          }
        } else if (urlState.path === "~skills") {
          openTabForNode({ path: "~skills", name: "Skills", type: "folder" });
          setActivePath("~skills");
          setContent({ kind: "skill-store" });
        } else if (urlState.path === "~integrations") {
          openTabForNode({ path: "~integrations", name: "Integrations", type: "folder" });
          setActivePath("~integrations");
          setContent({ kind: "integrations" });
        } else if (urlState.path === "~cloud") {
          openTabForNode({ path: "~cloud", name: "Cloud", type: "folder" });
          setActivePath("~cloud");
          setContent({ kind: "cloud" });
        } else if (urlState.path.startsWith("~crm/")) {
          const view = urlState.path.slice("~crm/".length).split("/")[0];
          if (view === "people" || view === "companies") {
            const node = resolveCrmObjectNode(tree, view === "people" ? "people" : "company");
            openTabForNode(node);
            void loadContent(node);
          } else {
            const map: Record<string, { name: string; kind: "crm-inbox" | "crm-calendar" } | undefined> = {
              inbox: { name: "Inbox", kind: "crm-inbox" },
              calendar: { name: "Calendar", kind: "crm-calendar" },
            };
            const entry = map[view];
            if (entry) {
              openTabForNode({ path: urlState.path, name: entry.name, type: "folder" });
              setActivePath(urlState.path);
              setContent({ kind: entry.kind });
            }
          }
        } else if (isAbsolutePath(urlState.path) || isHomeRelativePath(urlState.path)) {
          const name = urlState.path.split("/").pop() || urlState.path;
          const synNode: TreeNode = { name, path: urlState.path, type: "file" };
          openTabForNode(synNode);
          void loadContent(synNode);
        }
      } else if (urlState.crm) {
        if (urlState.crm === "people" || urlState.crm === "companies") {
          const node = resolveCrmObjectNode(tree, urlState.crm === "people" ? "people" : "company");
          openTabForNode(node);
          void loadContent(node);
        } else {
          const map = {
            inbox: { path: "~crm/inbox", name: "Inbox", kind: "crm-inbox" as const },
            calendar: { path: "~crm/calendar", name: "Calendar", kind: "crm-calendar" as const },
          }[urlState.crm];
          openTabForNode({ path: map.path, name: map.name, type: "folder" });
          setActivePath(map.path);
          setContent({ kind: map.kind });
        }
      } else if (urlState.chat) {
        if (urlState.subagent) {
          openSubagentChatTab({
            sessionKey: urlState.subagent,
            parentSessionId: urlState.chat,
            title: "Subagent",
          });
        } else {
          openSessionChatTab(urlState.chat);
        }
      } else {
        setActivePath(null);
        setContent({ kind: "none" });
        setActiveSessionId(null);
        setActiveSubagentKey(null);
        setActiveGatewaySessionKey(null);
        setTabState((prev) => {
          let next = activateTab(prev, HOME_TAB_ID);
          const chatTabs = next.tabs.filter((t) => t.id !== HOME_TAB_ID && isChatTab(t));
          const hasBlankChat = chatTabs.some((t) => !t.sessionId && !t.sessionKey);
          if (!hasBlankChat) {
            next = {
              ...openTab(next, createBlankChatTab(), { preview: true }),
              activeTabId: HOME_TAB_ID,
            };
          }
          return next;
        });
      }

      if (urlState.entry) {
        if (urlState.entry.objectName === "people") {
          const node = resolveCrmObjectNode(tree, "people");
          openTabForNode(node);
          setActivePath(node.path);
          setContent({ kind: "crm-person", entryId: urlState.entry.entryId });
          setEntryModal(null);
        } else if (
          urlState.entry.objectName === "company" ||
          urlState.entry.objectName === "companies"
        ) {
          const node = resolveCrmObjectNode(tree, "company");
          openTabForNode(node);
          setActivePath(node.path);
          setContent({ kind: "crm-company", entryId: urlState.entry.entryId });
          setEntryModal(null);
        } else {
          setEntryModal(urlState.entry);
        }
      } else {
        setEntryModal(null);
      }

      if (urlState.browse) {
        setBrowseDir(urlState.browse);
      } else if (!urlState.path || !isAbsolutePath(urlState.path)) {
        setBrowseDir(null);
      }

      if (urlState.hidden) {
        setShowHidden(true);
      } else {
        setShowHidden(false);
      }

      setTerminalOpen(urlState.terminal);

      lastPushedQs.current = qs;
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [tree, cronJobs, loadContent, setBrowseDir, setShowHidden]);

  // Resolve cron job detail once cronJobs load (they arrive after the main hydration).
  useEffect(() => {
    if (!activePath?.startsWith("~cron/") || cronJobs.length === 0) return;
    if (content.kind === "cron-job") return;
    const jobId = activePath.slice("~cron/".length);
    const job = cronJobs.find((j) => j.id === jobId);
    if (job) {
      setContent({ kind: "cron-job", jobId, job });
    }
  }, [activePath, cronJobs, content.kind]);

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
        setActivePath(null);
        setContent({ kind: "none" });
        return;
      }

      // Absolute paths (browse mode): navigate the sidebar directly.
      // Intermediate parent folders aren't in the browse-mode tree, so
      // resolveNode would fail — call setBrowseDir to update the sidebar.
      if (isAbsolutePath(path)) {
        const name = path.split("/").pop() || path;
        setBrowseDir(path);
        setActivePath(path);
        setContent({ kind: "directory", node: { name, path, type: "folder" } });
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

  // Refresh the currently displayed object (e.g. after changing display field)
  const refreshCurrentObject = useCallback(async () => {
    if (content.kind !== "object") {return;}
    const name = content.data.object.name;
    try {
      const res = await fetch(`/api/workspace/objects/${encodeURIComponent(name)}`);
      if (!res.ok) {return;}
      const data: ObjectData = await res.json();
      setContent({ kind: "object", data });
    } catch {
      // ignore
    }
  }, [content]);

  // Auto-refresh the current object view when the workspace tree updates.
  // The SSE watcher triggers tree refreshes on any file change (including
  // .object.yaml edits by the AI agent). We track the tree reference and
  // re-fetch the object data so saved views/filters update live.
  const prevTreeRef = useRef(tree);
  useEffect(() => {
    if (prevTreeRef.current === tree) {return;}
    prevTreeRef.current = tree;
    if (content.kind === "object") {
      void refreshCurrentObject();
    }
  }, [tree, content.kind, refreshCurrentObject]);

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

  // Cron navigation handlers
  const handleSelectCronJob = useCallback((jobId: string) => {
    const job = cronJobs.find((j) => j.id === jobId);
    if (job) {
      setActivePath(`~cron/${jobId}`);
      setContent({ kind: "cron-job", jobId, job });
    }
  }, [cronJobs]);

  const handleBackToCronDashboard = useCallback(() => {
    setActivePath("~cron");
    setContent({ kind: "cron-dashboard" });
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
    setTabState((prev) => {
      let next = syncParentChatTabTitles(prev, sessions);
      next = syncSubagentChatTabTitles(next, subagents);
      if (!activeSessionTitle) {
        return next;
      }
      const active = next.tabs.find((t) => t.id === next.activeTabId);
      if (active?.type === "chat" && active.title !== activeSessionTitle && !active.sessionKey) {
        return updateChatTabTitle(next, active.id, activeSessionTitle);
      }
      return next;
    });
  }, [activeSessionTitle, sessions, subagents]);

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
    const tab = tabState.tabs.find((entry) => entry.id === tabId);
    if (!tab || tab.type !== "chat") {
      return;
    }
    if (tab.sessionKey) {
      void stopSubagentSession(tab.sessionKey);
      return;
    }
    if (tab.sessionId) {
      void stopParentSession(tab.sessionId);
    }
  }, [stopParentSession, stopSubagentSession, tabState.tabs]);

  // v3 three-column layout derived values.
  // - Center always renders the chat panel stack (one session at a time in the center).
  // - Right panel renders content tabs (files, CRM, cloud, etc.) in a single unified
  //   tab strip alongside the always-available Files sidebar. When no content tab is
  //   active the content area shows a placeholder while the file tree (if expanded)
  //   lets the user pick something.
  const contentTabs = useMemo(
    () => tabState.tabs.filter((tab) => tab.id !== HOME_TAB_ID && tab.type !== "chat" && tab.type !== "gateway-chat"),
    [tabState.tabs],
  );

  // Track the last-focused tab per surface so switching between chat and content tabs
  // preserves each surface's selection independently (user requirement: "chat doesn't split").
  useEffect(() => {
    const activeId = tabState.activeTabId;
    if (!activeId) return;
    const t = tabState.tabs.find((x) => x.id === activeId);
    if (!t) return;
    if (t.type === "chat" || t.type === "gateway-chat") {
      setActiveChatTabId(t.id);
    } else if (t.id !== HOME_TAB_ID) {
      setActiveContentTabId(t.id);
    }
  }, [tabState.activeTabId, tabState.tabs]);

  // Clear stale active-content-tab-id if the content tab was closed externally.
  // Also reset activePath/content so the right panel falls back to the placeholder
  // instead of continuing to show the closed tab's content (this mirrors what the
  // old outer "Files" pill click did, which no longer exists in the unified layout).
  //
  // IMPORTANT: when openTab() REPLACES a preview tab with another preview tab
  // (e.g. clicking Integrations while a markdown file preview is active), the old
  // tab id disappears from contentTabs but the new one is already the active tab.
  // We must NOT wipe activePath/content in that case — the trackTab effect above
  // will re-point activeContentTabId to the new tab on the next tick. Only clear
  // when the current activeTabId is NOT itself a content tab (i.e. the user
  // really did close the active content tab and focus moved to home/chat).
  useEffect(() => {
    if (activeContentTabId && !contentTabs.some((t) => t.id === activeContentTabId)) {
      const activeTabIsContent = contentTabs.some((t) => t.id === tabState.activeTabId);
      if (activeTabIsContent) {
        // The new active tab is itself a content tab (e.g. preview-replaced via openTab).
        // The trackTab effect will sync activeContentTabId on the next tick — don't clobber
        // activePath/content that handleNavigate / loadContent / applyActivatedTab just set.
        return;
      }
      setActiveContentTabId(null);
      setActivePath(null);
      setContent({ kind: "none" });
    }
  }, [activeContentTabId, contentTabs, tabState.activeTabId]);



  // v3: the center always shows a chat panel. If no chat tab exists (e.g. after
  // closing the last one, on a fresh refresh, or before tab hydration completes),
  // create a fresh blank one so the hero state ("What can I help with?") renders
  // instead of an empty center.
  useEffect(() => {
    if (mainChatTabs.length > 0) return;
    const tab = createBlankChatTab();
    setTabState((prev) => openTab(prev, tab, { preview: true }));
    setActiveChatTabId(tab.id);
  }, [mainChatTabs.length]);

  // Belt-and-braces: if visibleMainChatTabId loses its target (e.g. tab was
  // closed externally), point activeChatTabId at the first available chat tab so
  // the center never renders blank.
  useEffect(() => {
    if (mainChatTabs.length === 0) return;
    if (activeChatTabId && mainChatTabs.some((t) => t.id === activeChatTabId)) return;
    setActiveChatTabId(mainChatTabs[0].id);
  }, [activeChatTabId, mainChatTabs]);

  // Right-panel content tab handlers.
  const handleContentTabActivate = useCallback(
    (tabId: string) => {
      const tab = tabStateRef.current.tabs.find((t) => t.id === tabId);
      if (!tab) return;
      setActiveContentTabId(tabId);
      setTabState((prev) => activateTab(prev, tabId));
      applyActivatedTab(tab);
    },
    [applyActivatedTab],
  );

  const handleContentTabClose = useCallback((tabId: string) => {
    setTabState((prev) => closeTab(prev, tabId));
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
      content.kind === "crm-person" ||
      (content.kind === "object" && content.data.object.name === "people")
        ? "people" as const
        : content.kind === "crm-company" ||
          (content.kind === "object" &&
            (content.data.object.name === "company" || content.data.object.name === "companies"))
          ? "companies" as const
          : content.kind === "crm-inbox"
            ? "inbox" as const
            : content.kind === "crm-calendar"
              ? "calendar" as const
              : null
    ),
    customCrmObjects,
    activeCrmObjectName: content.kind === "object" ? content.data.object.name : null,
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
    onSelectHistorySubagent: handleSelectSubagent,
    onSelectHistoryGatewaySession: (sessionKey: string, sessionId: string) => {
      const gs = gatewaySessions.find((s) => s.sessionKey === sessionKey);
      openGatewayChatTab(sessionKey, sessionId, gs?.channel, gs?.title);
    },
    onRenameHistorySession: handleRenameSession,
    onDeleteHistorySession: handleDeleteSession,
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      ref={layoutRef}
      className="flex h-screen"
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
      <main className="flex-1 flex flex-col min-w-[420px] overflow-hidden relative" style={{ background: "var(--color-main-bg)" }}>
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
            const isGateway = tab.type === "gateway-chat";
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
          onFallbackToIntegrations={handleComposioFallbackToIntegrations}
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
            width: rightPanelCollapsed ? 0 : rightPanelWidth,
            minWidth: rightPanelCollapsed ? 0 : rightPanelWidth,
            borderColor: "var(--color-border)",
            background: "var(--color-bg)",
            transition: "width 200ms ease, min-width 200ms ease",
          }}
        >
          <div className="flex h-full min-h-0 flex-col relative overflow-hidden" style={{ width: rightPanelWidth, minWidth: rightPanelWidth }}>
            <ResizeHandle
              mode="right"
              containerRef={layoutRef}
              min={RIGHT_PANEL_MIN}
              max={RIGHT_PANEL_MAX}
              onResize={setRightPanelWidth}
            />
            <RightPanel>
              <div className="flex h-full min-h-0 overflow-hidden">
                {/* File tree column — always available, togglable independently of the right panel itself. */}
                {!fileTreeCollapsed && (
                  <div
                    className="flex flex-col min-h-0 shrink-0 border-r overflow-hidden"
                    style={{ width: FILE_TREE_WIDTH, minWidth: FILE_TREE_WIDTH, borderColor: "var(--color-border)" }}
                  >
                    {handleFileSearchSelect && (
                      <div className="px-2 pt-2 pb-1 shrink-0 flex items-center gap-1">
                        <div className="flex-1 min-w-0">
                          <FileSearch onSelect={handleFileSearchSelect} searchFn={searchIndex} />
                        </div>
                        <button
                          type="button"
                          onClick={() => setFileTreeCollapsed(true)}
                          className="p-1 rounded-md cursor-pointer shrink-0"
                          style={{ color: "var(--color-text-muted)" }}
                          title="Hide files (⌘E)"
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    )}
                    {browseDir && (
                      <div
                        className="px-3 py-2 border-b flex items-center gap-2 shrink-0"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        <span className="shrink-0" style={{ color: "var(--color-text-muted)" }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
                          </svg>
                        </span>
                        <span
                          className="text-[12px] font-medium truncate flex-1 min-w-0"
                          style={{ color: "var(--color-text)" }}
                          title={browseDir}
                        >
                          {browseDir.split("/").pop() || browseDir}
                        </span>
                        <button
                          type="button"
                          onClick={handleGoHome}
                          className="p-1 rounded-md shrink-0 transition-colors cursor-pointer"
                          style={{ color: "var(--color-text-muted)" }}
                          title="Return to workspace"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                          </svg>
                        </button>
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto px-1 py-2">
                      <FileManagerTree
                        tree={enhancedTree}
                        activePath={activePath}
                        onSelect={handleNodeSelect}
                        onRefresh={refreshTree}
                        parentDir={effectiveParentDir}
                        onNavigateUp={handleNavigateUp}
                        browseDir={browseDir}
                        workspaceRoot={workspaceRoot}
                        onExternalDrop={handleSidebarExternalDrop}
                      />
                    </div>
                  </div>
                )}

                {/* Content column: unified tab strip + (entry detail | content | placeholder) */}
                <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
                  <div
                    className="flex items-center h-10 shrink-0 border-b min-w-0"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    {/* Tab strip — scrolls horizontally when narrow. Collapse button
                        is rendered as a sibling so it is always visible. */}
                    <div className="no-scrollbar flex-1 flex items-center gap-1 px-2 min-w-0 h-full overflow-x-auto">
                    {fileTreeCollapsed && (
                      <button
                        type="button"
                        onClick={() => setFileTreeCollapsed(false)}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer shrink-0 text-[12px] font-medium"
                        style={{ color: "var(--color-text-muted)" }}
                        title="Show files (⌘E)"
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M4 4h5l2 2h9a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
                        </svg>
                        Files
                      </button>
                    )}
                    {contentTabs.map((tab, tabIdx) => {
                      const isActive = tab.id === activeContentTabId;
                      const hasTabsToRight = tabIdx < contentTabs.length - 1;
                      const hasOtherTabs = contentTabs.length > 1;
                      return (
                        <ContextMenu key={tab.id}>
                          <ContextMenuTrigger asChild>
                            <div
                              className="flex items-center rounded-md shrink-0"
                              style={{ background: isActive ? "var(--color-surface-hover)" : "transparent" }}
                            >
                              <button
                                type="button"
                                onClick={() => handleContentTabActivate(tab.id)}
                                className="flex items-center gap-1.5 pl-2 pr-1 py-1 text-[12px] font-medium transition-colors cursor-pointer"
                                style={{
                                  color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                                  fontStyle: tab.preview ? "italic" : "normal",
                                }}
                                title={tab.title}
                              >
                                <span className="shrink-0" style={{ opacity: isActive ? 1 : 0.8 }}>
                                  <TabIcon tab={tab} />
                                </span>
                                <span>{tab.title.length > 24 ? tab.title.slice(0, 22) + "…" : tab.title}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleContentTabClose(tab.id); }}
                                className="p-0.5 rounded-md mr-0.5 cursor-pointer"
                                style={{ color: "var(--color-text-muted)" }}
                                title="Close tab"
                                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-border)"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                                </svg>
                              </button>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onSelect={() => handleContentTabClose(tab.id)}>
                              Close
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => handleTabCloseOthers(tab.id)}
                              disabled={!hasOtherTabs}
                            >
                              Close other tabs
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => handleTabCloseToRight(tab.id)}
                              disabled={!hasTabsToRight}
                            >
                              Close tabs to the right
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onSelect={handleTabCloseAll}>
                              Close all tabs
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}
                    </div>
                    {/* Always-visible collapse button, outside the scrollable tab strip. */}
                    <button
                      type="button"
                      onClick={() => setRightPanelCollapsed(true)}
                      className="p-1.5 mr-1 rounded-md cursor-pointer shrink-0"
                      style={{ color: "var(--color-text-muted)" }}
                      title="Hide right panel (⌘⇧B)"
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect width="18" height="18" x="3" y="3" rx="2" />
                        <path d="M15 3v18" />
                      </svg>
                    </button>
                  </div>

                  {entryModal ? (
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <EntryDetailPanel
                        objectName={entryModal.objectName}
                        entryId={entryModal.entryId}
                        members={context?.members}
                        tree={tree}
                        searchFn={searchIndex}
                        onClose={handleCloseEntry}
                        onNavigateEntry={(objName, eid, relatedObjectId) =>
                          handleOpenEntry(objName, eid, relatedObjectId)
                        }
                        onNavigateObject={(objName) => {
                          handleCloseEntry();
                          handleNavigateToObject(objName);
                        }}
                        onRefresh={refreshCurrentObject}
                        onNavigate={handleEditorNavigate}
                      />
                    </div>
                  ) : activePath && content.kind !== "none" ? (
                    <>
                      {/* {!activePath.startsWith("~") && (
                        <div
                          className="px-4 border-b flex-shrink-0 flex items-center h-10"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          <Breadcrumbs path={activePath} onNavigate={handleBreadcrumbNavigate} formatSegment={formatBreadcrumbSegment} />
                        </div>
                      )} */}
                      <div className="flex-1 overflow-y-auto">
                        <ContentRenderer
                          content={content}
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
                        />
                      </div>
                    </>
                  ) : (
                    // Empty-state placeholder — centered in the content
                    // column (the visible area to the right of the file tree),
                    // since that's where the user is actually looking when
                    // nothing is open. Centering across the whole right panel
                    // would make the text appear pushed left into the file
                    // tree boundary, which reads as off-center to the user.
                    <div className="flex-1 min-w-0 flex items-center justify-center">
                      <p
                        className="text-sm text-center px-6 max-w-xs"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        Select a file or open a page from the sidebar
                      </p>
                    </div>
                  )}
                </div>
              </div>
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
                <div className="flex h-full min-h-0 overflow-hidden">
                  {/* On mobile the file tree shares horizontal space with content; respect the same toggle. */}
                  {!fileTreeCollapsed && (
                    <div
                      className="flex flex-col min-h-0 shrink-0 border-r overflow-hidden"
                      style={{ width: 200, minWidth: 200, borderColor: "var(--color-border)" }}
                    >
                      <div className="px-2 pt-2 pb-1 shrink-0 flex items-center gap-1">
                        <span className="flex-1 text-[12px] font-medium px-1" style={{ color: "var(--color-text-muted)" }}>
                          Files
                        </span>
                        <button
                          type="button"
                          onClick={() => setFileTreeCollapsed(true)}
                          className="p-1 rounded-md cursor-pointer shrink-0"
                          style={{ color: "var(--color-text-muted)" }}
                          title="Hide files"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto px-1 py-2">
                        <FileManagerTree
                          tree={enhancedTree}
                          activePath={activePath}
                          onSelect={(node) => { handleNodeSelect(node); }}
                          onRefresh={refreshTree}
                          parentDir={effectiveParentDir}
                          onNavigateUp={handleNavigateUp}
                          browseDir={browseDir}
                          workspaceRoot={workspaceRoot}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div
                      className="flex items-center gap-1 px-2 h-10 shrink-0 border-b overflow-x-auto"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      {fileTreeCollapsed && (
                        <button
                          type="button"
                          onClick={() => setFileTreeCollapsed(false)}
                          className="p-1 rounded-md cursor-pointer shrink-0"
                          style={{ color: "var(--color-text-muted)" }}
                          title="Show files"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <polyline points="13 17 18 12 13 7" />
                            <polyline points="6 17 11 12 6 7" />
                          </svg>
                        </button>
                      )}
                      {contentTabs.map((tab) => {
                        const isActive = tab.id === activeContentTabId;
                        return (
                          <div
                            key={tab.id}
                            className="flex items-center rounded-md shrink-0"
                            style={{ background: isActive ? "var(--color-surface-hover)" : "transparent" }}
                          >
                            <button
                              type="button"
                              onClick={() => handleContentTabActivate(tab.id)}
                              className="flex items-center gap-1.5 pl-2 pr-1 py-1 text-[12px] font-medium transition-colors cursor-pointer"
                              style={{
                                color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                                fontStyle: tab.preview ? "italic" : "normal",
                              }}
                              title={tab.title}
                            >
                              <span className="shrink-0" style={{ opacity: isActive ? 1 : 0.8 }}>
                                <TabIcon tab={tab} />
                              </span>
                              <span>{tab.title.length > 20 ? tab.title.slice(0, 18) + "…" : tab.title}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleContentTabClose(tab.id); }}
                              className="p-0.5 rounded-md mr-0.5 cursor-pointer"
                              style={{ color: "var(--color-text-muted)" }}
                              title="Close tab"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() => setMobileRightPanelOpen(false)}
                        className="p-1.5 rounded-md cursor-pointer shrink-0"
                        style={{ color: "var(--color-text-muted)" }}
                        title="Close"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </div>

                    {entryModal ? (
                      <div className="flex-1 min-h-0 overflow-hidden">
                        <EntryDetailPanel
                          objectName={entryModal.objectName}
                          entryId={entryModal.entryId}
                          members={context?.members}
                          tree={tree}
                          searchFn={searchIndex}
                          onClose={handleCloseEntry}
                          onNavigateEntry={(objName, eid, relatedObjectId) =>
                            handleOpenEntry(objName, eid, relatedObjectId)
                          }
                          onNavigateObject={(objName) => {
                            handleCloseEntry();
                            handleNavigateToObject(objName);
                          }}
                          onRefresh={refreshCurrentObject}
                          onNavigate={handleEditorNavigate}
                        />
                      </div>
                    ) : activePath && content.kind !== "none" ? (
                      <>
                        {/* {!activePath.startsWith("~") && (
                          <div
                            className="px-4 border-b flex-shrink-0 flex items-center h-10"
                            style={{ borderColor: "var(--color-border)" }}
                          >
                            <Breadcrumbs path={activePath} onNavigate={handleBreadcrumbNavigate} formatSegment={formatBreadcrumbSegment} />
                          </div>
                        )} */}
                        <div className="flex-1 overflow-y-auto">
                          <ContentRenderer
                            content={content}
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
                          />
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center">
                        <p className="text-sm text-center px-6" style={{ color: "var(--color-text-muted)" }}>
                          Select a file or open a page from the sidebar
                        </p>
                      </div>
                    )}
                  </div>
                </div>
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
          data={content.data}
          members={members}
          onNavigateToObject={onNavigateToObject}
          onRefreshObject={onRefreshObject}
          onRefreshTree={onRefreshTree}
          onOpenEntry={onOpenEntry}
          activeEntryId={activeEntryId}
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
          onOpenPerson={(id) => onOpenEntry("people", id)}
          onOpenCompany={(id) => onOpenEntry("company", id)}
          onBackToList={() => onNavigateToObject("people")}
        />
      );

    case "crm-company":
      return (
        <CompanyProfile
          companyId={content.entryId}
          onOpenPerson={(id) => onOpenEntry("people", id)}
          onOpenCompany={(id) => onOpenEntry("company", id)}
          onBackToList={() => onNavigateToObject("company")}
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

  // Read initial URL state once for this object view.
  const initialUrlState = useMemo(() => parseUrlState(searchParams), []);  // eslint-disable-line react-hooks/exhaustive-deps

  // --- View type state ---
  const [currentViewType, setCurrentViewType] = useState<ViewType>(
    () => initialUrlState.viewType ?? resolveViewType(undefined, undefined, data.object.default_view),
  );
  const [viewSettings, setViewSettings] = useState<ViewTypeSettings>(
    () => data.viewSettings ?? {},
  );

  // --- Filter state ---
  const [filters, setFilters] = useState<FilterGroup>(() => initialUrlState.filters ?? emptyFilterGroup());
  const [savedViews, setSavedViews] = useState<SavedView[]>(data.savedViews ?? []);
  const [activeViewName, setActiveViewName] = useState<string | undefined>(initialUrlState.view ?? data.activeView);

  // --- Server-side pagination state ---
  const [serverPage, setServerPage] = useState(initialUrlState.page ?? data.page ?? 1);
  const [serverPageSize, setServerPageSize] = useState(initialUrlState.pageSize ?? data.pageSize ?? 100);
  const [totalCount, setTotalCount] = useState(data.totalCount ?? data.entries.length);
  const [entries, setEntries] = useState(data.entries);
  const [serverSearch, setServerSearch] = useState(initialUrlState.search ?? "");
  const [sortRules, _setSortRules] = useState<SortRule[] | undefined>(initialUrlState.sort ?? undefined);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasActiveServerQuery =
    filters.rules.length > 0 ||
    ((sortRules?.length ?? 0) > 0) ||
    serverSearch.trim().length > 0;

  // Column visibility: maps field IDs to boolean (false = hidden)
  const [viewColumns, setViewColumns] = useState<string[] | undefined>(initialUrlState.cols ?? undefined);
  // Column widths: maps field name to pixel width (persisted in view_settings / saved views)
  const [columnWidths, setColumnWidths] = useState<Record<string, number> | undefined>(
    () => data.viewSettings?.column_widths,
  );

  // --- Unified toolbar state (lifted up so the controls live above the view) ---
  const [globalFilter, setGlobalFilter] = useState<string>(initialUrlState.search ?? "");
  const [stickyFirstColumn, setStickyFirstColumn] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Sync object view state to URL params (additive — preserves path/entry/browse params).
  // Skip the initial render to avoid overwriting URL params that haven't been
  // read yet or that the shell-level effect is still propagating.
  const objectViewMounted = useRef(false);
  useEffect(() => {
    if (!objectViewMounted.current) {
      objectViewMounted.current = true;
      return;
    }

    const current = new URLSearchParams(window.location.search);
    const next = new URLSearchParams(current);

    for (const k of ["viewType", "view", "filters", "search", "sort", "page", "pageSize", "cols"]) {
      next.delete(k);
    }

    const defaultVt = resolveViewType(undefined, undefined, data.object.default_view);
    if (currentViewType !== defaultVt) next.set("viewType", currentViewType);
    if (activeViewName) next.set("view", activeViewName);
    if (filters.rules.length > 0) next.set("filters", btoa(JSON.stringify(filters)));
    if (serverSearch) next.set("search", serverSearch);
    if (sortRules && sortRules.length > 0) next.set("sort", btoa(JSON.stringify(sortRules)));
    if (serverPage > 1) next.set("page", String(serverPage));
    if (serverPageSize !== 100) next.set("pageSize", String(serverPageSize));
    if (viewColumns && viewColumns.length > 0) next.set("cols", viewColumns.join(","));

    const nextQs = next.toString();
    if (nextQs !== current.toString()) {
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
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {/* Search input — hidden on narrow widths so the rest of the toolbar fits */}
          <div
            className="hidden md:flex items-center gap-1.5 h-7 px-2 rounded-md focus-within:ring-2 focus-within:ring-(--color-accent)/30 transition-shadow"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              width: 180,
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
              onEntryClick={onOpenEntry ? (entryId) => onOpenEntry(data.object.name, entryId) : undefined}
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
            reverseRelations={data.reverseRelations}
            onNavigateToObject={onNavigateToObject}
            onNavigateToEntry={onOpenEntry}
            onEntryClick={onOpenEntry ? (entryId) => onOpenEntry(data.object.name, entryId) : undefined}
            onRefresh={handleRefresh}
            activeEntryId={activeEntryId}
            columnVisibility={columnVisibility}
            onColumnVisibilityChanged={handleColumnVisibilityChanged}
            columnSizing={columnSizing}
            onColumnSizingChanged={handleColumnSizingChanged}
            serverPagination={{
              totalCount,
              page: serverPage,
              pageSize: serverPageSize,
              onPageChange: handlePageChange,
              onPageSizeChange: handlePageSizeChange,
            }}
            onServerSearch={handleServerSearch}
            hideInternalToolbar
            globalFilter={globalFilter}
            onGlobalFilterChange={handleGlobalFilterChange}
            stickyFirstColumnValue={stickyFirstColumn}
            onStickyFirstColumnChange={setStickyFirstColumn}
            onAddRequest={() => setShowAddModal(true)}
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
              onEntryClick={onOpenEntry ? (entryId) => onOpenEntry(data.object.name, entryId) : undefined}
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
              onEntryClick={onOpenEntry ? (entryId) => onOpenEntry(data.object.name, entryId) : undefined}
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
              onEntryClick={onOpenEntry ? (entryId) => onOpenEntry(data.object.name, entryId) : undefined}
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
              onEntryClick={onOpenEntry ? (entryId) => onOpenEntry(data.object.name, entryId) : undefined}
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
