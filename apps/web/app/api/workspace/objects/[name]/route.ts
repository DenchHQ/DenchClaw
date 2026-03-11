import { getWorkspaceObjectData } from "@/lib/workspace-object-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const url = new URL(req.url);
  const result = await getWorkspaceObjectData(name, url.searchParams);
  if (!result.ok) {
    return Response.json(
      result.code ? { error: result.error, code: result.code } : { error: result.error },
      { status: result.status },
    );
  }
  return Response.json(result.data);
}
