import { renameSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { resolveFilesystemPath, isProtectedSystemPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/workspace/move
 * Body: { sourcePath: string, destinationDir: string }
 *
 * Moves a file or folder into a different directory.
 * System files are protected from moving.
 */
export async function POST(req: Request) {
  let body: { sourcePath?: string; destinationDir?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sourcePath, destinationDir } = body;
  if (!sourcePath || typeof sourcePath !== "string" || !destinationDir || typeof destinationDir !== "string") {
    return Response.json(
      { error: "Missing 'sourcePath' and 'destinationDir' fields" },
      { status: 400 },
    );
  }

  const sourceTarget = resolveFilesystemPath(sourcePath);
  if (isProtectedSystemPath(sourceTarget)) {
    return Response.json(
      { error: "Cannot move system file" },
      { status: 403 },
    );
  }

  if (!sourceTarget) {
    return Response.json(
      { error: "Source not found or path traversal rejected" },
      { status: 404 },
    );
  }

  const destinationDirTarget = resolveFilesystemPath(destinationDir);
  if (!destinationDirTarget) {
    return Response.json(
      { error: "Destination not found or path traversal rejected" },
      { status: 404 },
    );
  }

  // Destination must be a directory
  if (!statSync(destinationDirTarget.absolutePath).isDirectory()) {
    return Response.json(
      { error: "Destination is not a directory" },
      { status: 400 },
    );
  }

  // Prevent moving a folder into itself or its children
  const srcAbsNorm = `${sourceTarget.absolutePath}/`;
  if (destinationDirTarget.absolutePath.startsWith(srcAbsNorm) || destinationDirTarget.absolutePath === sourceTarget.absolutePath) {
    return Response.json(
      { error: "Cannot move a folder into itself" },
      { status: 400 },
    );
  }

  const itemName = basename(sourceTarget.absolutePath);
  const destAbs = join(destinationDirTarget.absolutePath, itemName);
  const destinationTarget = resolveFilesystemPath(destAbs, { allowMissing: true });

  if (!destinationTarget) {
    return Response.json(
      { error: "Invalid destination path" },
      { status: 400 },
    );
  }

  if (isProtectedSystemPath(destinationTarget)) {
    return Response.json(
      { error: "Cannot move a file to a protected system path" },
      { status: 403 },
    );
  }

  if (existsSync(destAbs)) {
    return Response.json(
      { error: `'${itemName}' already exists in destination` },
      { status: 409 },
    );
  }

  try {
    renameSync(sourceTarget.absolutePath, destinationTarget.absolutePath);
    const newPath = destinationTarget.workspaceRelativePath != null
      ? destinationTarget.workspaceRelativePath
      : destinationTarget.absolutePath;
    return Response.json({ ok: true, oldPath: sourcePath, newPath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Move failed" },
      { status: 500 },
    );
  }
}
