import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { contentTypeFor, resolveArtifactPath } from "@/lib/cad/artifacts";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
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
