import { callWorkstreamPlanner } from "@/lib/server/openai-compatible";
import { getRuntimeConfig, missingLLMConfig } from "@/lib/server/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = getRuntimeConfig();
  const missing = missingLLMConfig(config);
  if (missing.length) {
    return Response.json(
      {
        error: "Real LLM runtime is not configured",
        detail:
          "This project does not generate CAD agent results through a local code fallback. Configure a real OpenAI-compatible model endpoint and rerun.",
        missing,
        noFallbackPolicy: {
          directCodeGenerationFallback: false,
          allowedFallback: "real LLM model downgrade only",
        },
      },
      { status: 503 },
    );
  }

  let body: { prompt?: string; projectId?: string };
  try {
    body = (await request.json()) as { prompt?: string; projectId?: string };
  } catch {
    return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  if (!body.prompt?.trim()) {
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }

  try {
    const result = await callWorkstreamPlanner({ prompt: body.prompt, config });
    return Response.json({
      projectId: body.projectId,
      model: result.model,
      content: result.content,
      noFallbackPolicy: {
        directCodeGenerationFallback: false,
        allowedFallback: "real LLM model downgrade only",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: "Real LLM workstream planning failed",
        detail: error instanceof Error ? error.message : "Unknown model call failure.",
        noFallbackPolicy: {
          directCodeGenerationFallback: false,
          allowedFallback: "real LLM model downgrade only",
        },
      },
      { status: 502 },
    );
  }
}
