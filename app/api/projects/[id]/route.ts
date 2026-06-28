import { canAccessProject, forbiddenResponse, requireSaasRequestAuth } from "@/lib/server/auth";
import { getProject } from "@/lib/server/project-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const authResult = await requireSaasRequestAuth(request);
  if (authResult.response) return authResult.response;
  const { id } = await context.params;
  const project = await getProject(id);
  if (!project) {
    return Response.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  if (!canAccessProject(authResult.auth, project)) {
    return forbiddenResponse();
  }
  return Response.json({ project });
}
