import { CADAgentWorkspace } from "@/components/workspace/CADAgentWorkspace";
import { appRouteAccess, getPageAuthContext, signInRedirectPath } from "@/lib/server/auth";
import { redirect } from "next/navigation";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; template?: string }>;
}) {
  const params = await searchParams;
  const auth = await getPageAuthContext();
  if (appRouteAccess(auth) === "sign_in") {
    redirect(signInRedirectPath(workspaceReturnPath(params)));
  }
  return <CADAgentWorkspace initialProjectId={params.projectId} initialTemplate={params.template} />;
}

function workspaceReturnPath(params: { projectId?: string; template?: string }) {
  const query = new URLSearchParams();
  if (params.projectId) query.set("projectId", params.projectId);
  if (params.template) query.set("template", params.template);
  const search = query.toString();
  return search ? `/app/workspace?${search}` : "/app/workspace";
}
