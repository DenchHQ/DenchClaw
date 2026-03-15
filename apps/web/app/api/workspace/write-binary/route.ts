import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveFilesystemPath, isProtectedSystemPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/workspace/write-binary
 * Accepts FormData with `file` (Blob) and `path` (string).
 * Writes the binary data to the workspace path.
 */
export async function POST(req: Request) {
	let formData: FormData;
	try {
		formData = await req.formData();
	} catch {
		return Response.json({ error: "Invalid form data" }, { status: 400 });
	}

	const file = formData.get("file");
	const relPath = formData.get("path");

	if (!relPath || typeof relPath !== "string") {
		return Response.json({ error: "Missing 'path' field" }, { status: 400 });
	}
	if (!(file instanceof Blob)) {
		return Response.json({ error: "Missing 'file' field (Blob)" }, { status: 400 });
	}

	const targetPath = resolveFilesystemPath(relPath, { allowMissing: true });
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
		const buffer = Buffer.from(await file.arrayBuffer());
		mkdirSync(dirname(targetPath.absolutePath), { recursive: true });
		writeFileSync(targetPath.absolutePath, buffer);
		return Response.json({ ok: true, path: relPath });
	} catch (err) {
		return Response.json(
			{ error: err instanceof Error ? err.message : "Write failed" },
			{ status: 500 },
		);
	}
}
