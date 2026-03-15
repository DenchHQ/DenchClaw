export type WorkspacePathKind =
  | "virtual"
  | "workspaceRelative"
  | "homeRelative"
  | "absolute";

export function isHomeRelativePath(path: string): boolean {
  return path.startsWith("~/");
}

export function isVirtualPath(path: string): boolean {
  return path.startsWith("~") && !isHomeRelativePath(path);
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

export function classifyWorkspacePath(path: string): WorkspacePathKind {
  if (isVirtualPath(path)) {return "virtual";}
  if (isHomeRelativePath(path)) {return "homeRelative";}
  if (isAbsolutePath(path)) {return "absolute";}
  return "workspaceRelative";
}

export function isBrowsePath(path: string): boolean {
  const kind = classifyWorkspacePath(path);
  return kind === "absolute" || kind === "homeRelative";
}

export function fileReadUrl(path: string): string {
  const kind = classifyWorkspacePath(path);
  if (kind === "virtual") {
    return `/api/workspace/virtual-file?path=${encodeURIComponent(path)}`;
  }
  if (kind === "absolute" || kind === "homeRelative") {
    return `/api/workspace/browse-file?path=${encodeURIComponent(path)}`;
  }
  return `/api/workspace/file?path=${encodeURIComponent(path)}`;
}

export function rawFileReadUrl(path: string): string {
  if (isBrowsePath(path)) {
    return `/api/workspace/browse-file?path=${encodeURIComponent(path)}&raw=true`;
  }
  return `/api/workspace/raw-file?path=${encodeURIComponent(path)}`;
}

export function fileWriteUrl(path: string): string {
  return classifyWorkspacePath(path) === "virtual"
    ? "/api/workspace/virtual-file"
    : "/api/workspace/file";
}
