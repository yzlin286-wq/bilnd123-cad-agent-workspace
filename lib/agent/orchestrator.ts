import { randomUUID } from "node:crypto";
import { AgentEvent } from "@/lib/agent/events";
import { EngineeringSpec } from "@/lib/agent/spec";
import { runCADKernel, CADRunnerNotConfiguredError } from "@/lib/cad/cad-runner-client";
import { findArtifact } from "@/lib/cad/artifacts";
import { mergeRevisionSpec, normalizeSpec } from "@/lib/agent/spec-merge";
import { callCustomBuild123dPlanner, callSpecRevisionPlanner, callWorkstreamPlanner, repairJSONCandidate } from "@/lib/server/openai-compatible";
import { operationalErrorCode, userMessageForErrorCode } from "@/lib/server/failure-codes";
import { getRuntimeConfig, isLLMConfigured } from "@/lib/server/runtime";
import { appendRunHistory, type RunHistoryRoute } from "@/lib/server/run-history";
import { SUPPORTED_TEMPLATE_ID_SET, SUPPORTED_TEMPLATE_TEXT } from "@/lib/cad/templates";

type Emit = (event: AgentEvent) => void | Promise<void>;
type RunContext = {
  userId?: string;
  organizationId?: string;
  projectId?: string;
};

type PlanningContextError = Error & {
  model?: string;
  partType?: string;
};

export async function runAgentOrchestration(prompt: string, emit: Emit, route: RunHistoryRoute = "/api/agent/run", context: RunContext = {}) {
  const runId = randomUUID();
  const startedAt = performance.now();
  let model: string | undefined;
  let plannedPartType: string | undefined;
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
    await appendRunHistory({
      route,
      runId,
      prompt,
      status: "failure",
      durationMs: performance.now() - startedAt,
      errorCode: "AI_ENGINE_NOT_CONNECTED",
      ...context,
    });
    return;
  }

  try {
    const created = await createEngineeringSpec(prompt);
    const spec = created.spec;
    model = created.model;
    plannedPartType = spec.partType;
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
    await appendRunHistory({
      route,
      runId,
      prompt,
      model,
      status: "success",
      durationMs: performance.now() - startedAt,
      revision,
      ...context,
    });
  } catch (error) {
    if (error instanceof CADRunnerNotConfiguredError) {
      await emitStep(emit, "kernel", "Running CAD kernel", "failed", "The CAD engine is not connected.");
      await emit({
        type: "error",
        code: "CAD_ENGINE_NOT_CONNECTED",
        message: userMessageForErrorCode("CAD_ENGINE_NOT_CONNECTED"),
        userMessage: "CAD engine not connected. Connect build123d before generating files.",
      });
      await appendRunHistory({
        route,
        runId,
        prompt,
        model,
        status: "failure",
        durationMs: performance.now() - startedAt,
        errorCode: "CAD_ENGINE_NOT_CONNECTED",
        ...context,
      });
      return;
    }

    model = model ?? modelFromError(error);
    const partType = partTypeFromError(error) ?? plannedPartType;
    const errorCode = operationalErrorCode(error, "AGENT_RUN_FAILED");
    const userMessage = userMessageForErrorCode(
      errorCode,
      "The CAD agent could not finish this revision. Review the prompt or engine connection and try again.",
    );
    await emit({
      type: "error",
      code: errorCode,
      message: userMessage,
      userMessage,
    });
    await appendRunHistory({
      route,
      runId,
      prompt,
      model,
      partType,
      status: "failure",
      durationMs: performance.now() - startedAt,
      errorCode,
      ...context,
    });
  }
}

export async function runRevisionOrchestration({
  currentSpec,
  currentRevisionId,
  userPrompt,
  emit,
  route = "/api/agent/revise",
  context = {},
}: {
  currentSpec: EngineeringSpec;
  currentRevisionId: string;
  userPrompt: string;
  emit: Emit;
  route?: RunHistoryRoute;
  context?: RunContext;
}) {
  const runId = randomUUID();
  const startedAt = performance.now();
  let model: string | undefined;
  let plannedPartType: string | undefined;
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
    await appendRunHistory({
      route,
      runId,
      prompt: userPrompt,
      status: "failure",
      durationMs: performance.now() - startedAt,
      errorCode: "AI_ENGINE_NOT_CONNECTED",
      ...context,
    });
    return;
  }

  try {
    const revised = await reviseEngineeringSpec({ currentSpec, currentRevisionId, userPrompt });
    const spec = revised.spec;
    model = revised.model;
    plannedPartType = spec.partType;
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
    await appendRunHistory({
      route,
      runId,
      prompt: userPrompt,
      model,
      status: "success",
      durationMs: performance.now() - startedAt,
      revision,
      ...context,
    });
  } catch (error) {
    if (error instanceof CADRunnerNotConfiguredError) {
      await emitStep(emit, "kernel", "Running CAD kernel", "failed", "The CAD engine is not connected.");
      await emit({
        type: "error",
        code: "CAD_ENGINE_NOT_CONNECTED",
        message: userMessageForErrorCode("CAD_ENGINE_NOT_CONNECTED"),
        userMessage: "CAD engine not connected. Connect build123d before rebuilding this revision.",
      });
      await appendRunHistory({
        route,
        runId,
        prompt: userPrompt,
        model,
        status: "failure",
        durationMs: performance.now() - startedAt,
        errorCode: "CAD_ENGINE_NOT_CONNECTED",
        ...context,
      });
      return;
    }

    model = model ?? modelFromError(error);
    const partType = partTypeFromError(error) ?? plannedPartType;
    const errorCode = operationalErrorCode(error, "REVISION_FAILED");
    const userMessage = userMessageForErrorCode(
      errorCode,
      "The CAD agent could not revise this model. Check the instruction and try again.",
    );
    await emit({
      type: "error",
      code: errorCode,
      message: userMessage,
      userMessage,
    });
    await appendRunHistory({
      route,
      runId,
      prompt: userPrompt,
      model,
      partType,
      status: "failure",
      durationMs: performance.now() - startedAt,
      errorCode,
      ...context,
    });
  }
}

async function createEngineeringSpec(prompt: string): Promise<{ spec: EngineeringSpec; model: string }> {
  const result = await callWorkstreamPlanner({
    prompt,
    config: getRuntimeConfig(),
  });
  try {
    const payload = extractJSON(result.content);
    const raw = payload.engineeringSpec ?? payload.spec ?? payload;
    if (!isRecord(raw)) {
      throw new Error("AI model returned an invalid engineering spec.");
    }
    rejectUnsupportedPartType(raw);
    return { spec: normalizeSpec(raw), model: result.model };
  } catch (error) {
    const raw = safeExtractRaw(result.content);
    if (process.env.CAD_ENABLE_CUSTOM_CODEGEN === "1" && raw && shouldTryCustomBuild123d(raw)) {
      return createCustomBuild123dSpec(prompt);
    }
    throw withPlanningContext(error, {
      model: result.model,
      partType: raw ? partTypeFromRecord(raw) : undefined,
    });
  }
}

async function createCustomBuild123dSpec(prompt: string): Promise<{ spec: EngineeringSpec; model: string }> {
  const result = await callCustomBuild123dPlanner({
    prompt,
    config: getRuntimeConfig(),
  });
  const payload = extractJSON(result.content);
  const raw = payload.engineeringSpec ?? payload.spec ?? payload;
  if (!isRecord(raw)) {
    throw withPlanningContext(new Error("AI model returned an invalid custom build123d spec."), {
      model: result.model,
      partType: "custom_build123d",
    });
  }
  return {
    spec: normalizeSpec({ ...raw, partType: "custom_build123d" }),
    model: result.model,
  };
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
  return {
    spec: mergeRevisionSpec({
      currentSpec,
      specDelta: payload.specDelta,
      engineeringSpec: payload.engineeringSpec,
    }),
    model: result.model,
  };
}

function extractJSON(content: string) {
  const candidate = repairJSONCandidate(content);
  if (!candidate.startsWith("{")) {
    throw new Error("AI model did not return JSON engineering spec.");
  }
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    throw new Error("AI model returned invalid JSON engineering spec.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnsupportedPartType(raw: Record<string, unknown>) {
  const partType = partTypeFromRecord(raw);
  if (partType === "custom_build123d" && process.env.CAD_ENABLE_CUSTOM_CODEGEN !== "1") {
    const error = new Error("CUSTOM_CODEGEN_DISABLED: Custom build123d code generation is disabled for this staging environment.") as PlanningContextError;
    error.partType = partType;
    throw error;
  }
  if (!SUPPORTED_TEMPLATE_ID_SET.has(partType)) {
    const error = new Error(`Unsupported partType '${partType}'. Supported partType values: ${SUPPORTED_TEMPLATE_TEXT}.`) as PlanningContextError;
    error.partType = partType;
    throw error;
  }
}

function shouldTryCustomBuild123d(raw: Record<string, unknown>) {
  const partType = partTypeFromRecord(raw);
  return partType !== "custom_build123d" && !SUPPORTED_TEMPLATE_ID_SET.has(partType);
}

function partTypeFromRecord(raw: Record<string, unknown>) {
  const value = raw.partType ?? raw.part_type;
  return typeof value === "string" && value.trim() ? value : "unknown";
}

function modelFromError(error: unknown) {
  return isPlanningContextError(error) ? error.model : undefined;
}

function partTypeFromError(error: unknown) {
  return isPlanningContextError(error) ? error.partType : undefined;
}

function isPlanningContextError(error: unknown): error is PlanningContextError {
  return Boolean(error && typeof error === "object" && ("model" in error || "partType" in error));
}

function withPlanningContext(error: unknown, context: { model?: string; partType?: string }) {
  const enriched = (error instanceof Error ? error : new Error(String(error || "Unknown planning error."))) as PlanningContextError;
  enriched.model = enriched.model ?? context.model;
  enriched.partType = enriched.partType ?? context.partType;
  return enriched;
}

function safeExtractRaw(content: string) {
  try {
    const payload = extractJSON(content);
    const raw = payload.engineeringSpec ?? payload.spec ?? payload;
    return isRecord(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
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
