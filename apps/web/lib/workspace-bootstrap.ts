import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import mammoth from "mammoth";
import { HOME_TAB, HOME_TAB_ID, openTab, type Tab, type TabState } from "./tab-state";
import { parseUrlState, type WorkspaceUrlState } from "./workspace-links";
import { isCodeFile } from "./report-utils";
import {
  readWorkspaceFile,
  safeResolvePath,
  resolveWorkspaceRoot,
} from "./workspace";
import { getWorkspaceContextData } from "./workspace-context";
import {
  getWorkspaceTreeData,
  objectNameFromPath,
  resolveWorkspaceNode,
} from "./workspace-tree-data";
import { getWorkspaceObjectData } from "./workspace-object-data";
import { loadWorkspaceAppManifest } from "./workspace-apps";
import type {
  ChatSidebarPreviewState,
  MediaType,
  WorkspaceContentState,
  WorkspaceFileData,
  WorkspaceInitialSnapshot,
  WorkspaceTreeNode,
} from "./workspace-shell-types";

type SearchParamsLike =
  | URLSearchParams
  | string
  | Record<string, string | string[] | undefined>;

function searchParamsToUrlSearchParams(input: SearchParamsLike): URLSearchParams {
  if (typeof input === "string") {
    return new URLSearchParams(input);
  }
  if (input instanceof URLSearchParams) {
    return input;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }
  return params;
}

function isVirtualPath(path: string): boolean {
  return path.startsWith("~") && !path.startsWith("~/");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

function isHomeRelativePath(path: string): boolean {
  return path.startsWith("~/");
}

function fileApiUrl(path: string): string {
  if (isVirtualPath(path)) {
    return `/api/workspace/virtual-file?path=${encodeURIComponent(path)}`;
  }
  if (isAbsolutePath(path) || isHomeRelativePath(path)) {
    return `/api/workspace/browse-file?path=${encodeURIComponent(path)}`;
  }
  return `/api/workspace/file?path=${encodeURIComponent(path)}`;
}

function rawFileUrl(path: string): string {
  if (isAbsolutePath(path) || isHomeRelativePath(path)) {
    return `/api/workspace/browse-file?path=${encodeURIComponent(path)}&raw=true`;
  }
  return `/api/workspace/raw-file?path=${encodeURIComponent(path)}`;
}

function isSpreadsheetFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["xlsx", "xls", "csv", "tsv", "ods"].includes(ext);
}

function isDocxFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "docx" || ext === "doc";
}

function isTxtFile(name: string): boolean {
  return name.split(".").pop()?.toLowerCase() === "txt";
}

function textToHtml(text: string): string {
  if (!text.trim()) {return "<p></p>";}
  return text
    .split("\n")
    .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "<br>"}</p>`)
    .join("");
}

function detectMediaType(filename: string): MediaType | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "heic", "avif"].includes(ext)) {return "image";}
  if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) {return "video";}
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext)) {return "audio";}
  if (ext === "pdf") {return "pdf";}
  return null;
}

function resolveVirtualPath(virtualPath: string): string | null {
  const workspaceRoot = requireWorkspaceRoot();

  if (virtualPath.startsWith("~skills/")) {
    const rest = virtualPath.slice("~skills/".length);
    const parts = rest.split("/");
    if (parts.length !== 2 || parts[1] !== "SKILL.md" || !parts[0]) {
      return null;
    }
    const skillName = parts[0];
    if (skillName.includes("..") || skillName.includes("/")) {
      return null;
    }
    return join(workspaceRoot, "skills", skillName, "SKILL.md");
  }

  if (virtualPath.startsWith("~memories/")) {
    const rest = virtualPath.slice("~memories/".length);
    if (rest.includes("..") || rest.includes("/")) {
      return null;
    }
    if (rest === "MEMORY.md") {
      for (const filename of ["MEMORY.md", "memory.md"]) {
        const candidate = join(workspaceRoot, filename);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
      return join(workspaceRoot, "MEMORY.md");
    }
    if (!rest.endsWith(".md")) {
      return null;
    }
    return join(workspaceRoot, "memory", rest);
  }

  if (virtualPath.startsWith("~workspace/")) {
    const rest = virtualPath.slice("~workspace/".length);
    if (!rest || rest.includes("..") || rest.includes("/")) {
      return null;
    }
    return join(workspaceRoot, rest);
  }

  return null;
}

function requireWorkspaceRoot(): string {
  const treeRoot = resolveWorkspaceRoot();
  if (!treeRoot) {
    throw new Error("Workspace root is not available");
  }
  return treeRoot;
}

function readAbsoluteOrHomeFile(path: string): WorkspaceFileData | null {
  const absolute = isHomeRelativePath(path)
    ? join(homedir(), path.slice(1))
    : path;
  if (!existsSync(absolute)) {
    return null;
  }
  try {
    const content = readFileSync(absolute, "utf-8");
    const ext = absolute.split(".").pop()?.toLowerCase();
    let type: WorkspaceFileData["type"] = "text";
    if (ext === "md" || ext === "mdx") {type = "markdown";}
    else if (ext === "yaml" || ext === "yml") {type = "yaml";}
    else if (isCodeFile(absolute)) {type = "code";}
    return { content, type };
  } catch {
    return null;
  }
}

function readVirtualFile(path: string): WorkspaceFileData | null {
  const absolute = resolveVirtualPath(path);
  if (!absolute || !existsSync(absolute)) {
    return null;
  }

  try {
    const content = readFileSync(absolute, "utf-8");
    const ext = absolute.split(".").pop()?.toLowerCase();
    let type: WorkspaceFileData["type"] = "text";
    if (ext === "md" || ext === "mdx") {type = "markdown";}
    else if (ext === "yaml" || ext === "yml") {type = "yaml";}
    else if (isCodeFile(absolute)) {type = "code";}
    return { content, type };
  } catch {
    return null;
  }
}

function readTextFileForPath(path: string): WorkspaceFileData | null {
  if (isVirtualPath(path)) {
    return readVirtualFile(path);
  }
  if (isAbsolutePath(path) || isHomeRelativePath(path)) {
    return readAbsoluteOrHomeFile(path);
  }
  const file = readWorkspaceFile(path);
  if (!file) {return null;}
  if (isCodeFile(path)) {
    return { content: file.content, type: "code" };
  }
  return file;
}

function buildRouteTab(node: WorkspaceTreeNode | null, urlState: WorkspaceUrlState): Tab | null {
  if (!node && !urlState.path) {
    return null;
  }
  if (urlState.chat) {
    return HOME_TAB;
  }
  const path = node?.path ?? urlState.path ?? urlState.browse;
  if (!path) {
    return HOME_TAB;
  }
  return {
    id: `boot:${path}`,
    type: (node?.type === "object" ? "object" : path.includes(".dench.app") ? "app" : path.startsWith("~cron") ? "cron" : "file") as Tab["type"],
    title: node?.name ?? path.split("/").pop() ?? path,
    path,
    icon: node?.type === "app" ? node.appManifest?.icon ?? node.icon : undefined,
  };
}

async function buildInitialContentForNode(
  node: WorkspaceTreeNode,
  urlState: WorkspaceUrlState,
  rawSearchParams: URLSearchParams,
): Promise<{ content: WorkspaceContentState; deferredNode: WorkspaceTreeNode | null }> {
  if (node.type === "object") {
    const result = await getWorkspaceObjectData(objectNameFromPath(node.path), rawSearchParams);
    if (!result.ok) {
      if (result.code === "DUCKDB_NOT_INSTALLED") {
        return { content: { kind: "duckdb-missing" }, deferredNode: null };
      }
      return { content: { kind: "none" }, deferredNode: null };
    }
    return { content: { kind: "object", data: result.data }, deferredNode: null };
  }

  if (node.type === "document") {
    const data = readTextFileForPath(node.path);
    if (!data) {return { content: { kind: "loading" }, deferredNode: node };}
    return {
      content: { kind: "document", data, title: node.name.replace(/\.mdx?$/, "") },
      deferredNode: null,
    };
  }

  if (node.type === "database") {
    return {
      content: { kind: "database", dbPath: node.path, filename: node.name },
      deferredNode: null,
    };
  }

  if (node.type === "report") {
    return {
      content: { kind: "report", reportPath: node.path, filename: node.name },
      deferredNode: null,
    };
  }

  if (node.type === "app") {
    const manifest = node.appManifest ?? await loadWorkspaceAppManifest(node.path) ?? { name: node.name };
    return {
      content: { kind: "app", appPath: node.path, manifest, filename: node.name },
      deferredNode: null,
    };
  }

  if (node.type === "folder") {
    return {
      content: { kind: "directory", node },
      deferredNode: null,
    };
  }

  if (node.type === "file") {
    if (isSpreadsheetFile(node.name)) {
      return {
        content: { kind: "spreadsheet", url: rawFileUrl(node.path), filename: node.name, filePath: node.path },
        deferredNode: null,
      };
    }

    if (isDocxFile(node.name)) {
      try {
        const absolute = isAbsolutePath(node.path) || isHomeRelativePath(node.path)
          ? (isHomeRelativePath(node.path) ? join(homedir(), node.path.slice(1)) : node.path)
          : safeResolvePath(node.path);
        if (absolute && existsSync(absolute)) {
          const arrayBuffer = readFileSync(absolute);
          const result = await mammoth.convertToHtml({ buffer: arrayBuffer });
          return {
            content: { kind: "richDocument", html: result.value, filePath: node.path, mode: "docx" },
            deferredNode: null,
          };
        }
      } catch {
        // fall through
      }
      return { content: { kind: "loading" }, deferredNode: node };
    }

    if (isTxtFile(node.name)) {
      const data = readTextFileForPath(node.path);
      if (!data) {return { content: { kind: "loading" }, deferredNode: node };}
      return {
        content: { kind: "richDocument", html: textToHtml(data.content), filePath: node.path, mode: "txt" },
        deferredNode: null,
      };
    }

    const ext = node.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "html" || ext === "htm") {
      return {
        content: { kind: "html", rawUrl: rawFileUrl(node.path), contentUrl: fileApiUrl(node.path), filename: node.name },
        deferredNode: null,
      };
    }

    const mediaType = detectMediaType(node.name);
    if (mediaType) {
      return {
        content: { kind: "media", url: rawFileUrl(node.path), mediaType, filename: node.name, filePath: node.path },
        deferredNode: null,
      };
    }

    const data = readTextFileForPath(node.path);
    if (!data) {return { content: { kind: "loading" }, deferredNode: node };}
    if (isCodeFile(node.name)) {
      return {
        content: { kind: "code", data, filename: node.name, filePath: node.path },
        deferredNode: null,
      };
    }
    return {
      content: { kind: "file", data, filename: node.name },
      deferredNode: null,
    };
  }

  return { content: { kind: "none" }, deferredNode: null };
}

async function buildInitialPreview(
  previewPath: string,
  workspaceTree: WorkspaceTreeNode[],
): Promise<ChatSidebarPreviewState | null> {
  const node = resolveWorkspaceNode(workspaceTree, previewPath) ?? {
    name: previewPath.split("/").pop() || previewPath,
    path: previewPath,
    type: isAbsolutePath(previewPath) ? "file" : "file",
  };

  const { content } = await buildInitialContentForNode(node, parseUrlState(""), new URLSearchParams());
  switch (content.kind) {
    case "document":
      return { status: "ready", path: previewPath, filename: node.name, content };
    case "file":
      return { status: "ready", path: previewPath, filename: node.name, content };
    case "code":
      return { status: "ready", path: previewPath, filename: node.name, content };
    case "media":
      return { status: "ready", path: previewPath, filename: node.name, content };
    case "spreadsheet":
      return { status: "ready", path: previewPath, filename: node.name, content };
    case "database":
      return { status: "ready", path: previewPath, filename: node.name, content };
    case "richDocument":
      return { status: "ready", path: previewPath, filename: node.name, content };
    case "directory":
      return {
        status: "ready",
        path: previewPath,
        filename: node.name,
        content: { kind: "directory", path: previewPath, name: node.name },
      };
    default:
      return null;
  }
}

export async function buildInitialWorkspaceSnapshot(
  input: SearchParamsLike,
): Promise<WorkspaceInitialSnapshot> {
  const searchParams = searchParamsToUrlSearchParams(input);
  const urlState = parseUrlState(searchParams);

  const treeData = await getWorkspaceTreeData({
    showHidden: urlState.hidden,
    browseDir: urlState.browse,
  });
  const context = getWorkspaceContextData(treeData.workspaceRoot);

  let activePath: string | null = null;
  let content: WorkspaceContentState = { kind: "none" };
  let activeSessionId: string | null = null;
  let activeSubagentKey: string | null = null;
  let deferredNode: WorkspaceTreeNode | null = null;
  let activeTab = null as ReturnType<typeof buildRouteTab>;

  if (urlState.path) {
    const node = resolveWorkspaceNode(treeData.tree, urlState.path)
      ?? (isAbsolutePath(urlState.path) || isHomeRelativePath(urlState.path)
        ? {
            name: urlState.path.split("/").pop() || urlState.path,
            path: urlState.path,
            type: "file" as const,
          }
        : null);

    if (node) {
      activePath = node.path;
      const resolved = await buildInitialContentForNode(node, urlState, searchParams);
      content = resolved.content;
      deferredNode = resolved.deferredNode;
      activeTab = buildRouteTab(node, urlState);
    } else if (urlState.path === "~cron") {
      activePath = "~cron";
      content = { kind: "cron-dashboard" };
      activeTab = buildRouteTab({ name: "Cron", path: "~cron", type: "folder" }, urlState);
    } else if (urlState.path.startsWith("~cron/")) {
      activePath = urlState.path;
      content = { kind: "cron-dashboard" };
      activeTab = buildRouteTab({
        name: urlState.path.split("/").pop() || "Cron Job",
        path: urlState.path,
        type: "file",
      }, urlState);
    }
  } else if (urlState.browse) {
    activePath = treeData.browseDir;
    if (treeData.browseDir) {
      content = {
        kind: "directory",
        node: {
          name: treeData.browseDir.split("/").pop() || treeData.browseDir,
          path: treeData.browseDir,
          type: "folder",
        },
      };
      activeTab = buildRouteTab(content.node, urlState);
    }
  } else if (urlState.chat) {
    activeSessionId = urlState.chat;
    activeSubagentKey = urlState.subagent;
    activeTab = HOME_TAB;
  } else {
    activeTab = HOME_TAB;
  }

  let initialTabState: TabState = { tabs: [HOME_TAB], activeTabId: HOME_TAB_ID };
  if (activeTab && activeTab.id !== HOME_TAB_ID) {
    initialTabState = openTab(initialTabState, activeTab);
  }

  const chatSidebarPreview = urlState.preview
    ? await buildInitialPreview(urlState.preview, treeData.tree)
    : null;

  return {
    urlState,
    tree: treeData.tree,
    exists: treeData.exists,
    workspaceRoot: treeData.workspaceRoot,
    openclawDir: treeData.openclawDir,
    activeWorkspace: treeData.workspace,
    browseDir: treeData.browseDir,
    parentDir: treeData.parentDir,
    showHidden: urlState.hidden,
    context,
    activePath,
    content,
    activeSessionId,
    activeSubagentKey,
    fileChatSessionId: urlState.fileChat,
    entryModal: urlState.entry,
    chatSidebarPreview,
    terminalOpen: urlState.terminal,
    initialTabState,
    activeTab,
    deferredNode,
  };
}
