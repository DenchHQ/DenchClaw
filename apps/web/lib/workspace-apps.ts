import { access } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { resolveWorkspaceRoot } from "./workspace";
import { parseSimpleYaml } from "./workspace";
import { readFile } from "node:fs/promises";
import type { DenchAppManifest } from "./workspace-shell-types";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function resolveWorkspaceAppPath(appPath: string): { workspaceRoot: string; appAbsPath: string } | null {
  const workspaceRoot = resolveWorkspaceRoot();
  if (!workspaceRoot) {
    return null;
  }

  const appAbsPath = resolve(join(workspaceRoot, appPath));
  const relToWorkspace = relative(workspaceRoot, appAbsPath);
  if (relToWorkspace.startsWith("..") || relToWorkspace.startsWith("/")) {
    return null;
  }

  return { workspaceRoot, appAbsPath };
}

export async function loadWorkspaceAppManifest(appPath: string): Promise<DenchAppManifest | null> {
  const resolved = resolveWorkspaceAppPath(appPath);
  if (!resolved) {
    return null;
  }

  const manifestPath = join(resolved.appAbsPath, ".dench.yaml");
  if (!await pathExists(manifestPath)) {
    return {
      name: appPath.split("/").pop()?.replace(/\.dench\.app$/, "") || "App",
      entry: "index.html",
      runtime: "static",
    };
  }

  try {
    const content = await readFile(manifestPath, "utf-8");
    const parsed = parseSimpleYaml(content);
    return {
      name: parsed.name as string || appPath.split("/").pop()?.replace(/\.dench\.app$/, "") || "App",
      description: parsed.description as string | undefined,
      icon: parsed.icon as string | undefined,
      version: parsed.version as string | undefined,
      author: parsed.author as string | undefined,
      entry: parsed.entry as string || "index.html",
      runtime: ((parsed.runtime as string) || "static") as DenchAppManifest["runtime"],
      permissions: Array.isArray(parsed.permissions) ? parsed.permissions as string[] : undefined,
    };
  } catch {
    return {
      name: appPath.split("/").pop()?.replace(/\.dench\.app$/, "") || "App",
      entry: "index.html",
      runtime: "static",
    };
  }
}
