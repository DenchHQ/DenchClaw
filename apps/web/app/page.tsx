import { WorkspaceShell } from "./workspace/workspace-content";
import { buildInitialWorkspaceSnapshot } from "@/lib/workspace-bootstrap";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export default async function Home({ searchParams }: PageProps) {
  const initialSnapshot = await buildInitialWorkspaceSnapshot(await searchParams);
  return <WorkspaceShell initialSnapshot={initialSnapshot} />;
}
