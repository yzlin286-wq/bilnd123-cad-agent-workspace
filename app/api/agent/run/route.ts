import { randomUUID } from "node:crypto";
import { encodeSSE } from "@/lib/agent/events";
import { runAgentOrchestration } from "@/lib/agent/orchestrator";
import { enforcePromptLimit, enforceRateLimit, friendlyJSONError } from "@/lib/server/request-guards";
import { userMessageForErrorCode } from "@/lib/server/failure-codes";
import { appendRunHistory } from "@/lib/server/run-history";
import {
  appendProjectError,
  appendProjectMessage,
  appendProjectRevision,
  createProject,
  getProject,
  projectSummary,
} from "@/lib/server/project-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const guardRunId = randomUUID();
  const startedAt = performance.now();
  const rateLimitResponse = enforceRateLimit(request);
  if (rateLimitResponse) {
    await logRejectedRun(guardRunId, startedAt, "RATE_LIMITED");
    return rateLimitResponse;
  }

  let body: { prompt?: string; projectId?: string };
  try {
    body = (await request.json()) as { prompt?: string; projectId?: string };
  } catch {
    await logRejectedRun(guardRunId, startedAt, "INVALID_JSON");
    return friendlyJSONError("INVALID_JSON", userMessageForErrorCode("INVALID_JSON"), 400);
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    await logRejectedRun(guardRunId, startedAt, "PROMPT_REQUIRED");
    return friendlyJSONError("PROMPT_REQUIRED", userMessageForErrorCode("PROMPT_REQUIRED"), 400);
  }
  const promptLimitResponse = enforcePromptLimit(prompt);
  if (promptLimitResponse) {
    await logRejectedRun(guardRunId, startedAt, "PROMPT_TOO_LONG", prompt);
    return promptLimitResponse;
  }

  const project = (body.projectId ? await getProject(body.projectId) : undefined) ?? (await createProject({ prompt }));
  await appendProjectMessage({
    projectId: project.id,
    role: "user",
    content: prompt,
    route: "/api/agent/run",
  });
  const initialProject = projectSummary(project);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = async (event: Parameters<typeof encodeSSE>[0]) => {
        controller.enqueue(encoder.encode(encodeSSE(event)));
        if (event.type === "revision") {
          await appendProjectRevision({
            projectId: project.id,
            revision: event.revision,
            route: "/api/agent/run",
          });
        }
        if (event.type === "error") {
          await appendProjectError({
            projectId: project.id,
            route: "/api/agent/run",
            errorCode: event.code,
            userMessage: event.userMessage,
          });
        }
      };

      try {
        await emit({ type: "project", project: initialProject });
        await runAgentOrchestration(prompt, emit, "/api/agent/run");
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function logRejectedRun(runId: string, startedAt: number, errorCode: string, prompt?: string) {
  return appendRunHistory({
    route: "/api/agent/run",
    runId,
    prompt,
    status: "failure",
    durationMs: performance.now() - startedAt,
    errorCode,
  });
}
