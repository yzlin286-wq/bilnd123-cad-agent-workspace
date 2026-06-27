import { randomUUID } from "node:crypto";
import { encodeSSE } from "@/lib/agent/events";
import { runAgentOrchestration } from "@/lib/agent/orchestrator";
import { enforcePromptLimit, enforceRateLimit } from "@/lib/server/request-guards";
import { appendRunHistory } from "@/lib/server/run-history";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const guardRunId = randomUUID();
  const startedAt = performance.now();
  const rateLimitResponse = enforceRateLimit(request);
  if (rateLimitResponse) {
    await logRejectedRun(guardRunId, startedAt, "RATE_LIMITED");
    return rateLimitResponse;
  }

  let body: { prompt?: string };
  try {
    body = (await request.json()) as { prompt?: string };
  } catch {
    await logRejectedRun(guardRunId, startedAt, "INVALID_JSON");
    return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    await logRejectedRun(guardRunId, startedAt, "PROMPT_REQUIRED");
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }
  const promptLimitResponse = enforcePromptLimit(prompt);
  if (promptLimitResponse) {
    await logRejectedRun(guardRunId, startedAt, "PROMPT_TOO_LONG", prompt);
    return promptLimitResponse;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Parameters<typeof encodeSSE>[0]) => {
        controller.enqueue(encoder.encode(encodeSSE(event)));
      };

      try {
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
