import { runCADKernel, CADRunnerNotConfiguredError } from "@/lib/cad/cad-runner-client";
import type { EngineeringSpec } from "@/lib/agent/spec";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { spec?: EngineeringSpec; prompt?: string };
  try {
    body = (await request.json()) as { spec?: EngineeringSpec; prompt?: string };
  } catch {
    return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  if (!body.spec) {
    return Response.json({ error: "spec is required" }, { status: 400 });
  }

  try {
    const revision = await runCADKernel({ spec: body.spec, prompt: body.prompt });
    return Response.json({ revision });
  } catch (error) {
    if (error instanceof CADRunnerNotConfiguredError) {
      return Response.json(
        {
          error: "CAD_ENGINE_NOT_CONNECTED",
          userMessage: "CAD engine not connected. Connect build123d before rebuilding files.",
        },
        { status: 503 },
      );
    }
    return Response.json(
      {
        error: "CAD_REBUILD_FAILED",
        userMessage: userFacingCADRebuildError(error),
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}

function userFacingCADRebuildError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Unsupported partType")) {
    return message;
  }
  return "The CAD engine could not rebuild this revision.";
}
