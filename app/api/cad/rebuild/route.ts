import { randomUUID } from "node:crypto";
import { runCADKernel, CADRunnerNotConfiguredError } from "@/lib/cad/cad-runner-client";
import { enforcePromptLimit, enforceRateLimit, friendlyJSONError } from "@/lib/server/request-guards";
import { operationalErrorCode, userMessageForErrorCode } from "@/lib/server/failure-codes";
import { appendRunHistory } from "@/lib/server/run-history";
import type { EngineeringSpec } from "@/lib/agent/spec";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const runId = randomUUID();
  const startedAt = performance.now();
  const rateLimitResponse = enforceRateLimit(request);
  if (rateLimitResponse) {
    await logRejectedRebuild(runId, startedAt, "RATE_LIMITED");
    return rateLimitResponse;
  }

  let body: { spec?: EngineeringSpec; prompt?: string };
  try {
    body = (await request.json()) as { spec?: EngineeringSpec; prompt?: string };
  } catch {
    await logRejectedRebuild(runId, startedAt, "INVALID_JSON");
    return friendlyJSONError("INVALID_JSON", userMessageForErrorCode("INVALID_JSON"), 400);
  }

  if (!body.spec) {
    await logRejectedRebuild(runId, startedAt, "SPEC_REQUIRED", body.prompt);
    return friendlyJSONError("SPEC_REQUIRED", userMessageForErrorCode("SPEC_REQUIRED"), 400);
  }
  const promptLimitResponse = enforcePromptLimit(body.prompt, "prompt");
  if (promptLimitResponse) {
    await logRejectedRebuild(runId, startedAt, "PROMPT_TOO_LONG", body.prompt);
    return promptLimitResponse;
  }

  try {
    const revision = await runCADKernel({ spec: body.spec, prompt: body.prompt });
    await appendRunHistory({
      route: "/api/cad/rebuild",
      runId,
      prompt: body.prompt,
      status: "success",
      durationMs: performance.now() - startedAt,
      revision,
    });
    return Response.json({ revision });
  } catch (error) {
    if (error instanceof CADRunnerNotConfiguredError) {
      await appendRunHistory({
        route: "/api/cad/rebuild",
        runId,
        prompt: body.prompt,
        status: "failure",
        durationMs: performance.now() - startedAt,
        errorCode: "CAD_ENGINE_NOT_CONNECTED",
      });
      return Response.json(
        {
          error: "CAD_ENGINE_NOT_CONNECTED",
          userMessage: "CAD engine not connected. Connect build123d before rebuilding files.",
        },
        { status: 503 },
      );
    }
    const errorCode = operationalErrorCode(error, "CAD_REBUILD_FAILED");
    await appendRunHistory({
      route: "/api/cad/rebuild",
      runId,
      prompt: body.prompt,
      status: "failure",
      durationMs: performance.now() - startedAt,
      errorCode,
    });
    return Response.json(
      {
        error: errorCode,
        userMessage: userMessageForErrorCode(errorCode, "The CAD engine could not rebuild this revision."),
      },
      { status: 500 },
    );
  }
}

function logRejectedRebuild(runId: string, startedAt: number, errorCode: string, prompt?: string) {
  return appendRunHistory({
    route: "/api/cad/rebuild",
    runId,
    prompt,
    status: "failure",
    durationMs: performance.now() - startedAt,
    errorCode,
  });
}
