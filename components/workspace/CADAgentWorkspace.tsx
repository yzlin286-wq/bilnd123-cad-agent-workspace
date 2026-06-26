"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { HeroComposer } from "@/components/landing/HeroComposer";
import { AgentThread } from "@/components/agent/AgentThread";
import { CADArtifactCanvas } from "@/components/cad/CADArtifactCanvas";
import { WORKSTREAM_TEMPLATE, type CADArtifact, type CADRevision, type EngineeringSpec, type ParameterManifestItem, type ValidationReport, type WorkstreamStep } from "@/lib/agent/spec";
import type { AgentEvent } from "@/lib/agent/events";

type WorkspaceState = {
  prompt: string;
  steps: WorkstreamStep[];
  artifacts: CADArtifact[];
  preview?: CADArtifact;
  drawing?: CADArtifact;
  validation?: ValidationReport;
  revision?: CADRevision;
  spec?: EngineeringSpec;
  parameters: ParameterManifestItem[];
  error?: string;
  running: boolean;
};

const emptyWorkspace = (prompt = ""): WorkspaceState => ({
  prompt,
  steps: WORKSTREAM_TEMPLATE,
  artifacts: [],
  parameters: [],
  running: false,
});

export function CADAgentWorkspace() {
  const [hasStarted, setHasStarted] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => emptyWorkspace());

  const visiblePrompt = useMemo(
    () => workspace.prompt || "Describe the CAD part you want to create.",
    [workspace.prompt],
  );

  async function runPrompt(prompt: string) {
    setHasStarted(true);
    setWorkspace({ ...emptyWorkspace(prompt), running: true });

    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok || !response.body) {
        setWorkspace((current) => ({
          ...current,
          running: false,
          error: "The CAD agent could not start. Please try again.",
        }));
        return;
      }

      await readAgentStream(response.body, (event) => {
        setWorkspace((current) => reduceEvent(current, event));
      });
    } catch {
      setWorkspace((current) => ({
        ...current,
        running: false,
        error: "Connection interrupted while generating your CAD model.",
      }));
    }
  }

  async function rebuildFromParameters(spec: EngineeringSpec) {
    setWorkspace((current) => ({
      ...current,
      running: true,
      error: undefined,
      steps: updateStep(current.steps, "kernel", "running", "Rebuilding with updated parameters."),
    }));
    try {
      const response = await fetch("/api/cad/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, prompt: workspace.prompt }),
      });
      const data = (await response.json()) as { revision?: CADRevision; userMessage?: string };
      if (!response.ok || !data.revision) {
        setWorkspace((current) => ({
          ...current,
          running: false,
          error: data.userMessage ?? "The CAD engine could not rebuild this revision.",
          steps: updateStep(current.steps, "kernel", "failed"),
        }));
        return;
      }
      const revision = data.revision;
      setWorkspace((current) => applyRevision(current, revision));
    } catch {
      setWorkspace((current) => ({
        ...current,
        running: false,
        error: "The CAD engine connection was interrupted during rebuild.",
        steps: updateStep(current.steps, "kernel", "failed"),
      }));
    }
  }

  if (!hasStarted) {
    return <HeroComposer onGenerate={runPrompt} />;
  }

  return (
    <main className="product-shell">
      <aside className="rail">
        <div className="brand-pill">
          <Sparkles size={17} />
        </div>
        <button onClick={() => setHasStarted(false)}>New CAD</button>
        <button>Recent</button>
        <button>Templates</button>
      </aside>
      <section className="workspace-stage">
        <AgentThread
          prompt={visiblePrompt}
          steps={workspace.steps}
          artifacts={workspace.artifacts}
          validation={workspace.validation}
          error={workspace.error}
          running={workspace.running}
          onSubmit={runPrompt}
        />
        <CADArtifactCanvas
          revision={workspace.revision}
          artifacts={workspace.artifacts}
          preview={workspace.preview}
          drawing={workspace.drawing}
          parameters={workspace.parameters}
          spec={workspace.spec}
          validation={workspace.validation}
          running={workspace.running}
          onRebuild={rebuildFromParameters}
        />
      </section>
    </main>
  );
}

function reduceEvent(current: WorkspaceState, event: AgentEvent): WorkspaceState {
  switch (event.type) {
    case "run.started":
      return { ...current, prompt: event.prompt, error: undefined };
    case "step":
      return {
        ...current,
        steps: updateStep(current.steps, event.stepId, event.status, event.detail),
      };
    case "spec":
      return { ...current, spec: event.spec };
    case "artifact": {
      const artifacts = upsertArtifact(current.artifacts, event.artifact);
      return {
        ...current,
        artifacts,
        drawing: event.artifact.kind === "drawingSvg" ? event.artifact : current.drawing,
      };
    }
    case "preview":
      return { ...current, preview: event.artifact };
    case "validation":
      return { ...current, validation: event.validation };
    case "revision":
      return applyRevision(current, event.revision);
    case "run.completed":
      return applyRevision({ ...current, running: false }, event.revision);
    case "error":
      return {
        ...current,
        running: false,
        error: event.userMessage,
      };
    default:
      return current;
  }
}

function applyRevision(current: WorkspaceState, revision: CADRevision): WorkspaceState {
  const preview = revision.artifacts.find((artifact) => artifact.kind === "stl");
  const drawing = revision.artifacts.find((artifact) => artifact.kind === "drawingSvg");
  return {
    ...current,
    running: false,
    revision,
    spec: revision.engineeringSpec,
    parameters: revision.parameterManifest,
    artifacts: revision.artifacts,
    preview,
    drawing,
    validation: revision.validation,
    steps: current.steps.map((step) => ({ ...step, status: step.status === "failed" ? "failed" : "done" })),
  };
}

function updateStep(steps: WorkstreamStep[], stepId: string, status: WorkstreamStep["status"], detail?: string) {
  return steps.map((step) => (step.id === stepId ? { ...step, status, detail: detail ?? step.detail } : step));
}

function upsertArtifact(artifacts: CADArtifact[], artifact: CADArtifact) {
  const existing = artifacts.filter((item) => item.id !== artifact.id);
  return [...existing, artifact];
}

async function readAgentStream(stream: ReadableStream<Uint8Array>, onEvent: (event: AgentEvent) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const dataLine = chunk
        .split("\n")
        .find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      onEvent(JSON.parse(dataLine.slice(5).trim()) as AgentEvent);
    }
  }
}
