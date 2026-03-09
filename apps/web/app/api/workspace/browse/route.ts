import { getWorkspaceTreeData } from "@/lib/workspace-tree-data";
import { resolveWorkspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
	const url = new URL(req.url);
	let dir = url.searchParams.get("dir");
	const showHidden = url.searchParams.get("showHidden") === "1";
	if (!dir) {
		dir = resolveWorkspaceRoot();
	}
	if (!dir) {
		return Response.json({ entries: [], currentDir: "/", parentDir: null });
	}
	const data = await getWorkspaceTreeData({ browseDir: dir, showHidden });
	return Response.json({
		entries: data.tree,
		currentDir: data.browseDir ?? "/",
		parentDir: data.parentDir,
	});
}
