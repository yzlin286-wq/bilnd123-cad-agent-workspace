import { getProject } from "@/lib/server/project-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await getProject(id);
  if (!project) {
    return Response.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  return Response.json({ project });
}
