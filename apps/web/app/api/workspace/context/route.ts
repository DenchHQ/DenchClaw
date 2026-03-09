import { getWorkspaceContextData } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(getWorkspaceContextData());
}
