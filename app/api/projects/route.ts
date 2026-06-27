import { requireRequestAuth } from "@/lib/server/auth";
import { listProjects } from "@/lib/server/project-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authResult = await requireRequestAuth(request);
  if (authResult.response) return authResult.response;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 10);
  const projects = await listProjects({
    auth: authResult.auth,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 25) : 10,
  });
  return Response.json({ projects });
}
