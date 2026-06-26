import { getRuntimeConfig, isCADRunnerConfigured, isLLMConfigured } from "@/lib/server/runtime";

export const runtime = "nodejs";

export async function GET() {
  const config = getRuntimeConfig();
  return Response.json({
    llmConfigured: isLLMConfigured(config),
    cadRunnerConfigured: isCADRunnerConfigured(config),
    primaryModel: config.primaryModel,
    downgradeModel: config.downgradeModel,
    noFallbackPolicy: {
      directCodeGenerationFallback: false,
      allowedFallback: "real LLM model downgrade only",
    },
  });
}
