import { randomUUID } from "node:crypto";
import { runCADKernel, CADRunnerNotConfiguredError } from "@/lib/cad/cad-runner-client";
import { enforcePromptLimit, enforceRateLimit, friendlyJSONError } from "@/lib/server/request-guards";
import { operationalErrorCode, userMessageForErrorCode } from "@/lib/server/failure-codes";
import { appendRunHistory } from "@/lib/server/run-history";
import { canAccessProject, forbiddenResponse, requireRequestAuth } from "@/lib/server/auth";
import { appendProjectError, appendProjectMessage, appendProjectRevision, getProject } from "@/lib/server/project-store";
import type { EngineeringSpec } from "@/lib/agent/spec";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const runId = randomUUID();
  const startedAt = performance.now();
  const authResult = await requireRequestAuth(request);
  if (authResult.response) {
    await logRejectedRebuild(runId, startedAt, "AUTH_REQUIRED");
    return authResult.response;
  }
  const auth = authResult.auth;
  const rateLimitResponse = enforceRateLimit(request);
  if (rateLimitResponse) {
    await logRejectedRebuild(runId, startedAt, "RATE_LIMITED");
    return rateLimitResponse;
  }

  let body: { spec?: EngineeringSpec; prompt?: string; projectId?: string };
  try {
    body = (await request.json()) as { spec?: EngineeringSpec; prompt?: string; projectId?: string };
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
  const project = body.projectId ? await getProject(body.projectId) : undefined;
  if (project && !canAccessProject(auth, project)) {
    await logRejectedRebuild(runId, startedAt, "FORBIDDEN", body.prompt);
    return forbiddenResponse();
  }
  if (project) {
    await appendProjectMessage({
      projectId: project.id,
      role: "user",
      content: body.prompt || "Updated parameters from the panel.",
      route: "/api/cad/rebuild",
    });
  }

  try {
    const revision = await runCADKernel({ spec: body.spec, prompt: body.prompt });
    await appendProjectRevision({
      projectId: project?.id,
      revision,
      route: "/api/cad/rebuild",
    });
    await appendRunHistory({
      route: "/api/cad/rebuild",
      runId,
      prompt: body.prompt,
      status: "success",
      durationMs: performance.now() - startedAt,
      revision,
      userId: auth.userId,
      organizationId: auth.organizationId,
      projectId: project?.id,
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
        userId: auth.userId,
        organizationId: auth.organizationId,
        projectId: project?.id,
      });
      await appendProjectError({
        projectId: project?.id,
        route: "/api/cad/rebuild",
        errorCode: "CAD_ENGINE_NOT_CONNECTED",
        userMessage: userMessageForErrorCode("CAD_ENGINE_NOT_CONNECTED"),
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
    const userMessage = userMessageForErrorCode(errorCode, "The CAD engine could not rebuild this revision.");
    await appendRunHistory({
      route: "/api/cad/rebuild",
      runId,
      prompt: body.prompt,
      status: "failure",
      durationMs: performance.now() - startedAt,
      errorCode,
      userId: auth.userId,
      organizationId: auth.organizationId,
      projectId: project?.id,
    });
    await appendProjectError({
      projectId: project?.id,
      route: "/api/cad/rebuild",
      errorCode,
      userMessage,
    });
    return Response.json(
      {
        error: errorCode,
        userMessage,
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
