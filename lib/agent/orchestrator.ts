import { randomUUID } from "node:crypto";
import { AgentEvent } from "@/lib/agent/events";
import { EngineeringSpec } from "@/lib/agent/spec";
import { runCADKernel, CADRunnerNotConfiguredError } from "@/lib/cad/cad-runner-client";
import { findArtifact } from "@/lib/cad/artifacts";
import { mergeRevisionSpec, normalizeSpec } from "@/lib/agent/spec-merge";
import { callSpecRevisionPlanner, callWorkstreamPlanner, repairJSONCandidate } from "@/lib/server/openai-compatible";
import { getRuntimeConfig, isLLMConfigured } from "@/lib/server/runtime";

type Emit = (event: AgentEvent) => void | Promise<void>;

export async function runAgentOrchestration(prompt: string, emit: Emit) {
  const runId = randomUUID();
  await emit({ type: "run.started", runId, prompt });
  await emitStep(emit, "understand", "Understanding request", "running");

  if (!isLLMConfigured()) {
    await emitStep(emit, "understand", "Understanding request", "failed", "Connect a real AI model to translate natural language into CAD intent.");
    await emit({
      type: "error",
      code: "AI_ENGINE_NOT_CONNECTED",
      message: "Real LLM runtime is not configured.",
      userMessage: "AI CAD engine not connected. Add your model endpoint before generating from natural language.",
    });
    return;
  }

  try {
    const spec = await createEngineeringSpec(prompt);
    await emitStep(emit, "understand", "Understanding request", "done");
    await emitStep(emit, "spec", "Creating engineering spec", "done", `${spec.length} x ${spec.width} x ${spec.thickness} ${spec.units}`);
    await emit({ type: "spec", spec });

    await emitStep(emit, "source", "Writing build123d model", "running");
    await emitStep(emit, "source", "Writing build123d model", "done");

    await emitStep(emit, "kernel", "Running CAD kernel", "running");
    const revision = await runCADKernel({ spec, prompt });
    await emitStep(emit, "kernel", "Running CAD kernel", "done");

    await emitStep(emit, "step", "Exporting STEP", "done");
    await emitStep(emit, "preview", "Rendering preview mesh", "done");
    await emitStep(emit, "validation", "Validating geometry", revision.validation?.passed ? "done" : "failed");
    await emitStep(emit, "package", "Packaging files", "done");

    for (const artifact of revision.artifacts) {
      await emit({ type: "artifact", artifact });
    }
    const preview = findArtifact(revision.artifacts, "stl");
    if (preview) {
      await emit({ type: "preview", artifact: preview });
    }
    if (revision.validation) {
      await emit({ type: "validation", validation: revision.validation });
    }
    await emit({ type: "revision", revision });
    await emit({ type: "run.completed", revision });
  } catch (error) {
    if (error instanceof CADRunnerNotConfiguredError) {
      await emitStep(emit, "kernel", "Running CAD kernel", "failed", "The CAD engine is not connected.");
      await emit({
        type: "error",
        code: "CAD_ENGINE_NOT_CONNECTED",
        message: error.message,
        userMessage: "CAD engine not connected. Connect build123d before generating files.",
      });
      return;
    }

    await emit({
      type: "error",
      code: "AGENT_RUN_FAILED",
      message: error instanceof Error ? error.message : "Unknown agent failure.",
      userMessage: userFacingRunError(error, "The CAD agent could not finish this revision. Review the prompt or engine connection and try again."),
    });
  }
}

export async function runRevisionOrchestration({
  currentSpec,
  currentRevisionId,
  userPrompt,
  emit,
}: {
  currentSpec: EngineeringSpec;
  currentRevisionId: string;
  userPrompt: string;
  emit: Emit;
}) {
  const runId = randomUUID();
  await emit({ type: "run.started", runId, prompt: userPrompt });
  await emitStep(emit, "understand", "Understanding revision", "running");

  if (!isLLMConfigured()) {
    await emitStep(emit, "understand", "Understanding revision", "failed", "Connect a real AI model to revise the current CAD spec.");
    await emit({
      type: "error",
      code: "AI_ENGINE_NOT_CONNECTED",
      message: "Real LLM runtime is not configured.",
      userMessage: "AI CAD engine not connected. Add your model endpoint before revising this model.",
    });
    return;
  }

  try {
    const spec = await reviseEngineeringSpec({ currentSpec, currentRevisionId, userPrompt });
    await emitStep(emit, "understand", "Understanding revision", "done");
    await emitStep(emit, "spec", "Updating engineering spec", "done", `${spec.length} x ${spec.width} x ${spec.thickness} ${spec.units}`);
    await emit({ type: "spec", spec });

    await emitStep(emit, "source", "Updating build123d model", "running");
    await emitStep(emit, "source", "Updating build123d model", "done");
    await emitStep(emit, "kernel", "Running CAD kernel", "running");
    const revision = await runCADKernel({ spec, prompt: userPrompt });
    await emitStep(emit, "kernel", "Running CAD kernel", "done");
    await emitStep(emit, "step", "Exporting STEP", "done");
    await emitStep(emit, "preview", "Rendering preview mesh", "done");
    await emitStep(emit, "validation", "Validating geometry", revision.validation?.passed ? "done" : "failed");
    await emitStep(emit, "package", "Packaging files", "done");

    for (const artifact of revision.artifacts) {
      await emit({ type: "artifact", artifact });
    }
    const preview = findArtifact(revision.artifacts, "stl");
    if (preview) {
      await emit({ type: "preview", artifact: preview });
    }
    if (revision.validation) {
      await emit({ type: "validation", validation: revision.validation });
    }
    await emit({ type: "revision", revision });
    await emit({ type: "run.completed", revision });
  } catch (error) {
    if (error instanceof CADRunnerNotConfiguredError) {
      await emitStep(emit, "kernel", "Running CAD kernel", "failed", "The CAD engine is not connected.");
      await emit({
        type: "error",
        code: "CAD_ENGINE_NOT_CONNECTED",
        message: error.message,
        userMessage: "CAD engine not connected. Connect build123d before rebuilding this revision.",
      });
      return;
    }

    await emit({
      type: "error",
      code: "REVISION_FAILED",
      message: error instanceof Error ? error.message : "Unknown revision failure.",
      userMessage: userFacingRunError(error, "The CAD agent could not revise this model. Check the instruction and try again."),
    });
  }
}

function userFacingRunError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Unsupported partType")) {
    return message;
  }
  return fallback;
}

async function createEngineeringSpec(prompt: string): Promise<EngineeringSpec> {
  const result = await callWorkstreamPlanner({
    prompt,
    config: getRuntimeConfig(),
  });
  const payload = extractJSON(result.content);
  const raw = payload.engineeringSpec ?? payload.spec ?? payload;
  if (!isRecord(raw)) {
    throw new Error("AI model returned an invalid engineering spec.");
  }
  return normalizeSpec(raw);
}

async function reviseEngineeringSpec({
  currentSpec,
  currentRevisionId,
  userPrompt,
}: {
  currentSpec: EngineeringSpec;
  currentRevisionId: string;
  userPrompt: string;
}) {
  const result = await callSpecRevisionPlanner({
    currentSpec,
    currentRevisionId,
    userPrompt,
    config: getRuntimeConfig(),
  });
  const payload = extractJSON(result.content);
  return mergeRevisionSpec({
    currentSpec,
    specDelta: payload.specDelta,
    engineeringSpec: payload.engineeringSpec,
  });
}

function extractJSON(content: string) {
  const candidate = repairJSONCandidate(content);
  if (!candidate.startsWith("{")) {
    throw new Error("AI model did not return JSON engineering spec.");
  }
  return JSON.parse(candidate) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function emitStep(
  emit: Emit,
  stepId: string,
  label: string,
  status: "pending" | "running" | "done" | "failed",
  detail?: string,
) {
  return emit({ type: "step", stepId, label, status, detail });
}
