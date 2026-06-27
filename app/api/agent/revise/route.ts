import { randomUUID } from "node:crypto";
import { encodeSSE } from "@/lib/agent/events";
import { runRevisionOrchestration } from "@/lib/agent/orchestrator";
import { enforcePromptLimit, enforceRateLimit, friendlyJSONError } from "@/lib/server/request-guards";
import { userMessageForErrorCode } from "@/lib/server/failure-codes";
import { appendRunHistory } from "@/lib/server/run-history";
import type { EngineeringSpec } from "@/lib/agent/spec";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const guardRunId = randomUUID();
  const startedAt = performance.now();
  const rateLimitResponse = enforceRateLimit(request);
  if (rateLimitResponse) {
    await logRejectedRevision(guardRunId, startedAt, "RATE_LIMITED");
    return rateLimitResponse;
  }

  let body: {
    currentSpec?: EngineeringSpec;
    currentRevisionId?: string;
    userPrompt?: string;
  };
  try {
    body = (await request.json()) as {
      currentSpec?: EngineeringSpec;
      currentRevisionId?: string;
      userPrompt?: string;
    };
  } catch {
    await logRejectedRevision(guardRunId, startedAt, "INVALID_JSON");
    return friendlyJSONError("INVALID_JSON", userMessageForErrorCode("INVALID_JSON"), 400);
  }

  if (!body.currentSpec || !body.currentRevisionId || !body.userPrompt?.trim()) {
    await logRejectedRevision(guardRunId, startedAt, "REVISION_REQUEST_REQUIRED", body.userPrompt);
    return friendlyJSONError("REVISION_REQUEST_REQUIRED", userMessageForErrorCode("REVISION_REQUEST_REQUIRED"), 400);
  }
  const promptLimitResponse = enforcePromptLimit(body.userPrompt, "userPrompt");
  if (promptLimitResponse) {
    await logRejectedRevision(guardRunId, startedAt, "PROMPT_TOO_LONG", body.userPrompt);
    return promptLimitResponse;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Parameters<typeof encodeSSE>[0]) => {
        controller.enqueue(encoder.encode(encodeSSE(event)));
      };

      try {
        await runRevisionOrchestration({
          currentSpec: body.currentSpec as EngineeringSpec,
          currentRevisionId: body.currentRevisionId as string,
          userPrompt: body.userPrompt as string,
          emit,
          route: "/api/agent/revise",
        });
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

function logRejectedRevision(runId: string, startedAt: number, errorCode: string, prompt?: string) {
  return appendRunHistory({
    route: "/api/agent/revise",
    runId,
    prompt,
    status: "failure",
    durationMs: performance.now() - startedAt,
    errorCode,
  });
}
