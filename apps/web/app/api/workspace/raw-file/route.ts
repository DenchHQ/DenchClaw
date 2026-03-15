import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  resolveFilesystemPath,
  resolveWorkspaceRoot,
  isProtectedSystemPath,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME_MAP: Record<string, string> = {
	// Images
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	bmp: "image/bmp",
	tiff: "image/tiff",
	tif: "image/tiff",
	avif: "image/avif",
	heic: "image/heic",
	heif: "image/heif",
	// Video
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	avi: "video/x-msvideo",
	mkv: "video/x-matroska",
	// Audio
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	m4a: "audio/mp4",
	// Documents
	pdf: "application/pdf",
	html: "text/html",
	htm: "text/html",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	doc: "application/msword",
	txt: "text/plain",
};

/**
 * Resolve a file path, trying multiple strategies:
 * 1. Absolute path — the agent may read files from anywhere on the local machine
 *    (Photos library, Downloads, etc.), so we serve any readable absolute path.
 * 2. Workspace-relative via safeResolvePath
 * 3. Bare filename — search common workspace subdirectories
 *
 * Security note: this is a local-only dev server; it never runs in production.
 */
function resolveFile(path: string): string | null {
	const resolvedPath = resolveFilesystemPath(path);
	if (resolvedPath) {return resolvedPath.absolutePath;}

	// 2. Try common subdirectories in case the path is a bare filename
	const root = resolveWorkspaceRoot();
	if (!root) {return null;}
	const rootAbs = resolve(root);
	const basename = path.split("/").pop() ?? path;
	if (basename === path) {
		const subdirs = [
			"assets",
			"knowledge",
			"manufacturing",
			"uploads",
			"files",
			"images",
			"media",
			"reports",
			"exports",
		];
		for (const sub of subdirs) {
			const candidate = resolve(root, sub, basename);
			if (
				candidate.startsWith(rootAbs) &&
				existsSync(candidate)
			) {
				return candidate;
			}
		}
	}

	return null;
}

/**
 * GET /api/workspace/raw-file?path=...
 * Serves a workspace file with the correct Content-Type for inline display.
 * Used by the chain-of-thought component to render images, videos, and PDFs.
 */
export async function GET(req: Request) {
	const url = new URL(req.url);
	const path = url.searchParams.get("path");

	if (!path) {
		return new Response("Missing path", { status: 400 });
	}

	const absolute = resolveFile(path);
	if (!absolute) {
		return new Response("Not found", { status: 404 });
	}

	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	const contentType = MIME_MAP[ext] ?? "application/octet-stream";

	try {
		const buffer = readFileSync(absolute);
		return new Response(buffer, {
			headers: {
				"Content-Type": contentType,
				"Cache-Control": "public, max-age=3600",
			},
		});
	} catch {
		return new Response("Read error", { status: 500 });
	}
}

/**
 * POST /api/workspace/raw-file?path=...
 * Saves binary data to a workspace file. Used by the spreadsheet editor
 * to write XLSX and other binary formats back to disk.
 */
export async function POST(req: Request) {
	const url = new URL(req.url);
	const path = url.searchParams.get("path");

	if (!path || typeof path !== "string") {
		return new Response("Missing path", { status: 400 });
	}

	const targetPath = resolveFilesystemPath(path, { allowMissing: true });
	if (isProtectedSystemPath(targetPath)) {
		return Response.json({ error: "Cannot modify system file" }, { status: 403 });
	}

	if (!targetPath) {
		return Response.json(
			{ error: "Invalid path or path traversal rejected" },
			{ status: 400 },
		);
	}

	try {
		const buffer = Buffer.from(await req.arrayBuffer());
		mkdirSync(dirname(targetPath.absolutePath), { recursive: true });
		writeFileSync(targetPath.absolutePath, buffer);
		return Response.json({ ok: true, path });
	} catch (err) {
		return Response.json(
			{ error: err instanceof Error ? err.message : "Write failed" },
			{ status: 500 },
		);
	}
}
