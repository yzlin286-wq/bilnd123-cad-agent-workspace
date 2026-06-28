import { CADAgentWorkspace } from "@/components/workspace/CADAgentWorkspace";
import { appRouteAccess, getPageAuthContext } from "@/lib/server/auth";
import { redirect } from "next/navigation";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; template?: string }>;
}) {
  const auth = await getPageAuthContext();
  if (appRouteAccess(auth) === "sign_in") {
    redirect("/sign-in?redirect_url=/app/workspace");
  }
  const params = await searchParams;
  return <CADAgentWorkspace initialProjectId={params.projectId} initialTemplate={params.template} />;
}
