import { cpSync, existsSync, statSync } from "node:fs";
import { dirname, basename, extname } from "node:path";
import { resolveFilesystemPath, isProtectedSystemPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/workspace/copy
 * Body: { path: string, destinationPath?: string }
 *
 * Duplicates a file or folder. If no destinationPath is provided,
 * creates a copy next to the original with " copy" appended.
 */
export async function POST(req: Request) {
  let body: { path?: string; destinationPath?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { path: relPath, destinationPath } = body;
  if (!relPath || typeof relPath !== "string") {
    return Response.json(
      { error: "Missing 'path' field" },
      { status: 400 },
    );
  }

  const sourceTarget = resolveFilesystemPath(relPath);
  if (isProtectedSystemPath(sourceTarget)) {
    return Response.json(
      { error: "Cannot duplicate system file" },
      { status: 403 },
    );
  }

  if (!sourceTarget) {
    return Response.json(
      { error: "Source not found or path traversal rejected" },
      { status: 404 },
    );
  }

  let destinationInputPath: string;
  if (destinationPath && typeof destinationPath === "string") {
    destinationInputPath = destinationPath;
  } else {
    // Auto-generate "name copy.ext" or "name copy" for folders
    const name = basename(sourceTarget.absolutePath);
    const dir = dirname(sourceTarget.absolutePath);
    const ext = extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    const copyName = ext ? `${stem} copy${ext}` : `${stem} copy`;
    destinationInputPath = dir === "." ? copyName : `${dir}/${copyName}`;
  }

  const destinationTarget = resolveFilesystemPath(destinationInputPath, { allowMissing: true });
  if (!destinationTarget) {
    return Response.json(
      { error: "Invalid destination path" },
      { status: 400 },
    );
  }

  if (isProtectedSystemPath(destinationTarget)) {
    return Response.json(
      { error: "Cannot duplicate to a protected system path" },
      { status: 403 },
    );
  }

  if (existsSync(destinationTarget.absolutePath)) {
    return Response.json(
      { error: "Destination already exists" },
      { status: 409 },
    );
  }

  try {
    const isDir = statSync(sourceTarget.absolutePath).isDirectory();
    cpSync(sourceTarget.absolutePath, destinationTarget.absolutePath, { recursive: isDir });
    const newPath = destinationTarget.workspaceRelativePath != null
      ? destinationTarget.workspaceRelativePath
      : destinationTarget.absolutePath;
    return Response.json({ ok: true, sourcePath: relPath, newPath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Copy failed" },
      { status: 500 },
    );
  }
}
