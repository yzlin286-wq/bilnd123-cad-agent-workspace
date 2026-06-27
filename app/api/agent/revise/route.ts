import { encodeSSE } from "@/lib/agent/events";
import { runRevisionOrchestration } from "@/lib/agent/orchestrator";
import type { EngineeringSpec } from "@/lib/agent/spec";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
    return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  if (!body.currentSpec || !body.currentRevisionId || !body.userPrompt?.trim()) {
    return Response.json(
      {
        error: "currentSpec, currentRevisionId, and userPrompt are required",
      },
      { status: 400 },
    );
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
