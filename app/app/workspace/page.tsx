import { CADAgentWorkspace } from "@/components/workspace/CADAgentWorkspace";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; template?: string }>;
}) {
  const params = await searchParams;
  return <CADAgentWorkspace initialProjectId={params.projectId} initialTemplate={params.template} />;
}
