import { renameSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { resolveFilesystemPath, isProtectedSystemPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/workspace/rename
 * Body: { path: string, newName: string }
 *
 * Renames a file or folder within the same directory.
 * System files are protected from renaming.
 */
export async function POST(req: Request) {
  let body: { path?: string; newName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { path: relPath, newName } = body;
  if (!relPath || typeof relPath !== "string" || !newName || typeof newName !== "string") {
    return Response.json(
      { error: "Missing 'path' and 'newName' fields" },
      { status: 400 },
    );
  }

  const sourcePath = resolveFilesystemPath(relPath);
  if (isProtectedSystemPath(sourcePath)) {
    return Response.json(
      { error: "Cannot rename system file" },
      { status: 403 },
    );
  }

  // Validate newName: no slashes, no empty, no traversal
  if (newName.includes("/") || newName.includes("\\") || newName.trim() === "") {
    return Response.json(
      { error: "Invalid file name" },
      { status: 400 },
    );
  }

  if (!sourcePath) {
    return Response.json(
      { error: "Source not found or path traversal rejected" },
      { status: 404 },
    );
  }

  const parentDir = dirname(sourcePath.absolutePath);
  const newAbsPath = join(parentDir, newName);
  const destinationPath = resolveFilesystemPath(newAbsPath, { allowMissing: true });

  if (!destinationPath) {
    return Response.json(
      { error: "Invalid destination path" },
      { status: 400 },
    );
  }

  if (isProtectedSystemPath(destinationPath)) {
    return Response.json(
      { error: "Cannot rename to a protected system file" },
      { status: 403 },
    );
  }

  if (existsSync(newAbsPath)) {
    return Response.json(
      { error: `A file named '${newName}' already exists` },
      { status: 409 },
    );
  }

  try {
    renameSync(sourcePath.absolutePath, destinationPath.absolutePath);
    const newPath = destinationPath.workspaceRelativePath != null
      ? destinationPath.workspaceRelativePath
      : destinationPath.absolutePath;
    return Response.json({ ok: true, oldPath: relPath, newPath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Rename failed" },
      { status: 500 },
    );
  }
}
