import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { contentTypeFor, resolveArtifactPath } from "@/lib/cad/artifacts";
import { forbiddenResponse, getRequestAuthContext, unauthorizedResponse } from "@/lib/server/auth";
import { findArtifactOwnership, getProject } from "@/lib/server/project-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await getRequestAuthContext(request);
  if (!auth.isAuthenticated) return unauthorizedResponse();
  const ownership = await findArtifactOwnership(id);
  if (!ownership) {
    return Response.json({ error: "Artifact not found" }, { status: 404 });
  }
  const project = await getProject(ownership.projectId);
  if (!project) {
    return Response.json({ error: "Artifact not found" }, { status: 404 });
  }
  const allowed =
    auth.isAdmin ||
    (auth.userId && ownership.ownerUserId === auth.userId) ||
    (auth.organizationId && ownership.organizationId === auth.organizationId);
  if (!allowed) return forbiddenResponse();

  try {
    const filePath = resolveArtifactPath(id);
    const stats = await stat(filePath);
    const stream = createReadStream(filePath);
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": contentTypeFor(filePath),
        "Content-Length": String(stats.size),
        "Content-Disposition": `inline; filename="${encodeURIComponent(filePath.split(/[\\/]/).at(-1) ?? "artifact")}"`,
      },
    });
  } catch {
    return Response.json({ error: "Artifact not found" }, { status: 404 });
  }
}
