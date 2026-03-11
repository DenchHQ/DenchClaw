import type { Dirent } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  resolveWorkspaceRoot,
  resolveOpenClawStateDir,
  getActiveWorkspaceName,
  parseSimpleYaml,
  duckdbQueryAllAsync,
  isDatabaseFile,
} from "./workspace";
import type { DenchAppManifest, WorkspaceTreeNode } from "./workspace-shell-types";

type DbObject = {
  name: string;
  icon?: string;
  default_view?: string;
};

export type WorkspaceTreeDataResult = {
  tree: WorkspaceTreeNode[];
  exists: boolean;
  workspaceRoot: string | null;
  openclawDir: string | null;
  workspace: string | null;
  browseDir: string | null;
  parentDir: string | null;
};

type BrowseNode = WorkspaceTreeNode;

const BROWSE_SKIP_DIRS = new Set(["node_modules", ".git", ".Trash", "__pycache__", ".cache"]);

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a dirent's effective type, following symlinks to their target. */
async function resolveEntryType(
  entry: Dirent,
  absPath: string,
): Promise<"directory" | "file" | null> {
  if (entry.isDirectory()) {return "directory";}
  if (entry.isFile()) {return "file";}
  if (entry.isSymbolicLink()) {
    try {
      const st = await stat(absPath);
      if (st.isDirectory()) {return "directory";}
      if (st.isFile()) {return "file";}
    } catch {
      // Broken symlink -- skip
    }
  }
  return null;
}

async function readObjectMeta(
  dirPath: string,
): Promise<{ icon?: string; defaultView?: string } | null> {
  const yamlPath = join(dirPath, ".object.yaml");
  if (!await pathExists(yamlPath)) {return null;}

  try {
    const content = await readFile(yamlPath, "utf-8");
    const parsed = parseSimpleYaml(content);
    return {
      icon: parsed.icon as string | undefined,
      defaultView: parsed.default_view as string | undefined,
    };
  } catch {
    return null;
  }
}

export async function readAppManifest(
  dirPath: string,
): Promise<DenchAppManifest | null> {
  const yamlPath = join(dirPath, ".dench.yaml");
  if (!await pathExists(yamlPath)) {return null;}

  try {
    const content = await readFile(yamlPath, "utf-8");
    const parsed = parseSimpleYaml(content);
    return {
      name: (parsed.name as string) || dirPath.split("/").pop()?.replace(/\.dench\.app$/, "") || "App",
      description: parsed.description as string | undefined,
      icon: parsed.icon as string | undefined,
      version: parsed.version as string | undefined,
      author: parsed.author as string | undefined,
      entry: (parsed.entry as string) || "index.html",
      runtime: ((parsed.runtime as string) || "static") as DenchAppManifest["runtime"],
      permissions: Array.isArray(parsed.permissions) ? parsed.permissions as string[] : undefined,
    };
  } catch {
    return null;
  }
}

async function loadDbObjects(): Promise<Map<string, DbObject>> {
  const map = new Map<string, DbObject>();
  const rows = await duckdbQueryAllAsync<DbObject & { name: string }>(
    "SELECT name, icon, default_view FROM objects",
    "name",
  );
  for (const row of rows) {
    map.set(row.name, row);
  }
  return map;
}

async function buildWorkspaceTree(
  absDir: string,
  relativeBase: string,
  dbObjects: Map<string, DbObject>,
  showHidden = false,
): Promise<WorkspaceTreeNode[]> {
  const nodes: WorkspaceTreeNode[] = [];

  let entries: Dirent[];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return nodes;
  }

  const filtered = entries.filter((e) => {
    if (e.name === ".object.yaml") {return true;}
    if (e.name.startsWith(".")) {return showHidden;}
    return true;
  });

  const typedEntries = await Promise.all(filtered.map(async (entry) => {
    const absPath = join(absDir, entry.name);
    const effectiveType = await resolveEntryType(entry, absPath);
    return { entry, absPath, effectiveType };
  }));

  const sorted = typedEntries.toSorted((a, b) => {
    const dirA = a.effectiveType === "directory";
    const dirB = b.effectiveType === "directory";
    if (dirA && !dirB) {return -1;}
    if (!dirA && dirB) {return 1;}
    return a.entry.name.localeCompare(b.entry.name);
  });

  for (const { entry, absPath, effectiveType } of sorted) {
    if (entry.name === ".object.yaml" && !showHidden) {continue;}
    const relPath = relativeBase
      ? `${relativeBase}/${entry.name}`
      : entry.name;

    const isSymlink = entry.isSymbolicLink();

    if (effectiveType === "directory") {
      if (entry.name.endsWith(".dench.app")) {
        const manifest = await readAppManifest(absPath);
        const displayName = manifest?.name || entry.name.replace(/\.dench\.app$/, "");
        nodes.push({
          name: displayName,
          path: relPath,
          type: "app",
          icon: manifest?.icon,
          appManifest: manifest ?? { name: displayName, entry: "index.html", runtime: "static" },
          ...(isSymlink && { symlink: true }),
        });
        continue;
      }

      const objectMeta = await readObjectMeta(absPath);
      const dbObject = dbObjects.get(entry.name);
      const children = await buildWorkspaceTree(absPath, relPath, dbObjects, showHidden);

      if (objectMeta || dbObject) {
        nodes.push({
          name: entry.name,
          path: relPath,
          type: "object",
          icon: objectMeta?.icon ?? dbObject?.icon,
          defaultView:
            ((objectMeta?.defaultView ?? dbObject?.default_view) as
              | "table"
              | "kanban") ?? "table",
          children: children.length > 0 ? children : undefined,
          ...(isSymlink && { symlink: true }),
        });
      } else {
        nodes.push({
          name: entry.name,
          path: relPath,
          type: "folder",
          children: children.length > 0 ? children : undefined,
          ...(isSymlink && { symlink: true }),
        });
      }
    } else if (effectiveType === "file") {
      const ext = entry.name.split(".").pop()?.toLowerCase();
      const isReport = entry.name.endsWith(".report.json");
      const isDocument = ext === "md" || ext === "mdx";
      const isDatabase = isDatabaseFile(entry.name);

      nodes.push({
        name: entry.name,
        path: relPath,
        type: isReport ? "report" : isDatabase ? "database" : isDocument ? "document" : "file",
        ...(isSymlink && { symlink: true }),
      });
    }
  }

  return nodes;
}

function parseSkillFrontmatter(content: string): { name?: string; emoji?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {return {};}
  const yaml = match[1];
  const result: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)/);
    if (kv) {result[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();}
  }
  return { name: result.name, emoji: result.emoji };
}

async function buildSkillsVirtualFolder(workspaceRoot: string | null): Promise<WorkspaceTreeNode | null> {
  if (!workspaceRoot) {
    return null;
  }
  const dirs = [join(workspaceRoot, "skills")];

  const children: WorkspaceTreeNode[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (!await pathExists(dir)) {continue;}
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || seen.has(entry.name)) {continue;}
        if (entry.name === "crm" || entry.name === "browser") {continue;}
        const skillMdPath = join(dir, entry.name, "SKILL.md");
        if (!await pathExists(skillMdPath)) {continue;}

        seen.add(entry.name);
        let displayName = entry.name;
        try {
          const content = await readFile(skillMdPath, "utf-8");
          const meta = parseSkillFrontmatter(content);
          if (meta.name) {displayName = meta.name;}
          if (meta.emoji) {displayName = `${meta.emoji} ${displayName}`;}
        } catch {
          // skip
        }

        children.push({
          name: displayName,
          path: `~skills/${entry.name}/SKILL.md`,
          type: "document",
          virtual: true,
        });
      }
    } catch {
      // dir unreadable
    }
  }

  if (children.length === 0) {return null;}
  children.sort((a, b) => a.name.localeCompare(b.name));

  return {
    name: "Skills",
    path: "~skills",
    type: "folder",
    virtual: true,
    children,
  };
}

function expandBrowseDir(input: string): string {
  return input.startsWith("~")
    ? join(homedir(), input.slice(1))
    : input;
}

async function buildBrowseTree(
  absDir: string,
  maxDepth: number,
  currentDepth = 0,
  showHidden = false,
): Promise<BrowseNode[]> {
  if (currentDepth >= maxDepth) {return [];}

  let entries: Dirent[];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const typedEntries = await Promise.all(entries.map(async (entry) => {
    const absPath = join(absDir, entry.name);
    const effectiveType = await resolveEntryType(entry, absPath);
    return { entry, absPath, effectiveType };
  }));

  const filtered = typedEntries
    .filter(({ entry }) => showHidden || !entry.name.startsWith("."))
    .filter(({ entry, effectiveType }) => !(effectiveType === "directory" && BROWSE_SKIP_DIRS.has(entry.name)));

  const sorted = filtered.toSorted((a, b) => {
    const dirA = a.effectiveType === "directory";
    const dirB = b.effectiveType === "directory";
    if (dirA && !dirB) {return -1;}
    if (!dirA && dirB) {return 1;}
    return a.entry.name.localeCompare(b.entry.name);
  });

  const nodes: BrowseNode[] = [];

  for (const { entry, absPath, effectiveType } of sorted) {
    const isSymlink = entry.isSymbolicLink();

    if (effectiveType === "directory") {
      const children = await buildBrowseTree(absPath, maxDepth, currentDepth + 1, showHidden);
      nodes.push({
        name: entry.name,
        path: absPath,
        type: "folder",
        children: children.length > 0 ? children : undefined,
        ...(isSymlink && { symlink: true }),
      });
    } else if (effectiveType === "file") {
      const ext = entry.name.split(".").pop()?.toLowerCase();
      const isDocument = ext === "md" || ext === "mdx";
      const isDatabase = ext === "duckdb" || ext === "sqlite" || ext === "sqlite3" || ext === "db";

      nodes.push({
        name: entry.name,
        path: absPath,
        type: isDatabase ? "database" : isDocument ? "document" : "file",
        ...(isSymlink && { symlink: true }),
      });
    }
  }

  return nodes;
}

export async function getWorkspaceTreeData(
  options?: { showHidden?: boolean; browseDir?: string | null },
): Promise<WorkspaceTreeDataResult> {
  const showHidden = options?.showHidden ?? false;
  const browseDir = options?.browseDir ?? null;
  const openclawDir = resolveOpenClawStateDir();
  const workspace = getActiveWorkspaceName();
  const workspaceRoot = resolveWorkspaceRoot();

  if (browseDir) {
    const currentDir = resolve(expandBrowseDir(browseDir));
    const tree = await buildBrowseTree(currentDir, 3, 0, showHidden);
    const parentDir = currentDir === "/" ? null : dirname(currentDir);
    return {
      tree,
      exists: true,
      workspaceRoot,
      openclawDir,
      workspace,
      browseDir: currentDir,
      parentDir,
    };
  }

  if (!workspaceRoot) {
    const tree: WorkspaceTreeNode[] = [];
    const skillsFolder = await buildSkillsVirtualFolder(workspaceRoot);
    if (skillsFolder) {tree.push(skillsFolder);}
    return {
      tree,
      exists: false,
      workspaceRoot: null,
      openclawDir,
      workspace,
      browseDir: null,
      parentDir: null,
    };
  }

  const dbObjects = await loadDbObjects();
  const tree = await buildWorkspaceTree(workspaceRoot, "", dbObjects, showHidden);
  const skillsFolder = await buildSkillsVirtualFolder(workspaceRoot);
  if (skillsFolder) {tree.push(skillsFolder);}

  return {
    tree,
    exists: true,
    workspaceRoot,
    openclawDir,
    workspace,
    browseDir: null,
    parentDir: workspaceRoot === "/" ? null : dirname(workspaceRoot),
  };
}

export function objectNameFromPath(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1];
}

export function findTreeNode(
  tree: WorkspaceTreeNode[],
  path: string,
): WorkspaceTreeNode | null {
  for (const node of tree) {
    if (node.path === path) {return node;}
    if (node.children) {
      const found = findTreeNode(node.children, path);
      if (found) {return found;}
    }
  }
  return null;
}

export function resolveWorkspaceNode(
  tree: WorkspaceTreeNode[],
  path: string,
): WorkspaceTreeNode | null {
  let node = findTreeNode(tree, path);
  if (node) {return node;}

  if (!path.startsWith("knowledge/")) {
    node = findTreeNode(tree, `knowledge/${path}`);
    if (node) {return node;}
  }

  if (path.startsWith("knowledge/")) {
    node = findTreeNode(tree, path.slice("knowledge/".length));
    if (node) {return node;}
  }

  const lastSegment = path.split("/").pop();
  if (lastSegment) {
    function findByName(nodes: WorkspaceTreeNode[]): WorkspaceTreeNode | null {
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
