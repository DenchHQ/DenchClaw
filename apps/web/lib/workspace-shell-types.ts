import type { Tab, TabState } from "./tab-state";
import type { WorkspaceUrlState } from "./workspace-links";
import type { CronJob, CronRunLogEntry } from "../app/types/cron";

export type MediaType = "image" | "video" | "audio" | "pdf";

export type DenchAppManifest = {
  name: string;
  description?: string;
  icon?: string;
  version?: string;
  author?: string;
  entry?: string;
  runtime?: "static" | "esbuild" | "build";
  permissions?: string[];
};

export type WorkspaceTreeNode = {
  name: string;
  path: string;
  type: "object" | "document" | "folder" | "file" | "database" | "report" | "app";
  icon?: string;
  defaultView?: "table" | "kanban";
  children?: WorkspaceTreeNode[];
  virtual?: boolean;
  symlink?: boolean;
  appManifest?: DenchAppManifest;
};

export type WorkspaceContext = {
  exists: boolean;
  organization?: {
    id?: string;
    name?: string;
    slug?: string;
  };
  members?: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>;
  defaults?: {
    default_view?: string;
    date_format?: string;
    naming_convention?: string;
  };
};

export type ReverseRelation = {
  fieldName: string;
  sourceObjectName: string;
  sourceObjectId: string;
  displayField: string;
  entries: Record<string, Array<{ id: string; label: string }>>;
};

export type WorkspaceObjectData = {
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
  savedViews?: import("./object-filters").SavedView[];
  activeView?: string;
  viewSettings?: import("./object-filters").ViewTypeSettings;
  totalCount?: number;
  page?: number;
  pageSize?: number;
};

export type WorkspaceFileData = {
  content: string;
  type: "markdown" | "yaml" | "code" | "text";
};

export type WorkspaceContentState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "object"; data: WorkspaceObjectData }
  | { kind: "document"; data: WorkspaceFileData; title: string }
  | { kind: "file"; data: WorkspaceFileData; filename: string }
  | { kind: "code"; data: WorkspaceFileData; filename: string; filePath: string }
  | { kind: "media"; url: string; mediaType: MediaType; filename: string; filePath: string }
  | { kind: "spreadsheet"; url: string; filename: string; filePath: string }
  | { kind: "html"; rawUrl: string; contentUrl: string; filename: string }
  | { kind: "database"; dbPath: string; filename: string }
  | { kind: "report"; reportPath: string; filename: string }
  | { kind: "directory"; node: WorkspaceTreeNode }
  | { kind: "cron-dashboard" }
  | { kind: "cron-job"; jobId: string; job: CronJob }
  | { kind: "cron-session"; jobId: string; job: CronJob; sessionId: string; run: CronRunLogEntry }
  | { kind: "duckdb-missing" }
  | { kind: "richDocument"; html: string; filePath: string; mode: "docx" | "txt" }
  | { kind: "app"; appPath: string; manifest: DenchAppManifest; filename: string };

export type SidebarPreviewContent =
  | { kind: "document"; data: WorkspaceFileData; title: string }
  | { kind: "file"; data: WorkspaceFileData; filename: string }
  | { kind: "code"; data: WorkspaceFileData; filename: string; filePath: string }
  | { kind: "media"; url: string; mediaType: MediaType; filename: string; filePath: string }
  | { kind: "spreadsheet"; url: string; filename: string; filePath: string }
  | { kind: "database"; dbPath: string; filename: string }
  | { kind: "directory"; path: string; name: string }
  | { kind: "richDocument"; html: string; filePath: string; mode: "docx" | "txt" };

export type ChatSidebarPreviewState =
  | { status: "loading"; path: string; filename: string }
  | { status: "error"; path: string; filename: string; message: string }
  | { status: "ready"; path: string; filename: string; content: SidebarPreviewContent };

export type WorkspaceInitialSnapshot = {
  urlState: WorkspaceUrlState;
  tree: WorkspaceTreeNode[];
  exists: boolean;
  workspaceRoot: string | null;
  openclawDir: string | null;
  activeWorkspace: string | null;
  browseDir: string | null;
  parentDir: string | null;
  showHidden: boolean;
  context: WorkspaceContext | null;
  activePath: string | null;
  content: WorkspaceContentState;
  activeSessionId: string | null;
  activeSubagentKey: string | null;
  fileChatSessionId: string | null;
  entryModal: { objectName: string; entryId: string } | null;
  chatSidebarPreview: ChatSidebarPreviewState | null;
  terminalOpen: boolean;
  initialTabState: TabState;
  activeTab: Tab | null;
  deferredNode: WorkspaceTreeNode | null;
};
