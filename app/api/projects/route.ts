import { listProjects } from "@/lib/server/project-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 10);
  const projects = await listProjects({ limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 25) : 10 });
  return Response.json({ projects });
}
