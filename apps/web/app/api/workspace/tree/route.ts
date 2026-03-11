import { getWorkspaceTreeData } from "@/lib/workspace-tree-data";
export type { WorkspaceTreeNode as TreeNode } from "@/lib/workspace-shell-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const url = new URL(req.url);
  const showHidden = url.searchParams.get("showHidden") === "1";
  const data = await getWorkspaceTreeData({ showHidden });
  return Response.json({
    tree: data.tree,
    exists: data.exists,
    workspaceRoot: data.workspaceRoot,
    openclawDir: data.openclawDir,
    workspace: data.workspace,
  });
}
