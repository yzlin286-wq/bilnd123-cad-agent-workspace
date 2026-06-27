"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { HeroComposer } from "@/components/landing/HeroComposer";
import { AgentThread, type ThreadMessage } from "@/components/agent/AgentThread";
import { CADArtifactCanvas } from "@/components/cad/CADArtifactCanvas";
import {
  WORKSTREAM_TEMPLATE,
  type CADArtifact,
  type CADRevision,
  type EngineeringSpec,
  type ParameterManifestItem,
  type ValidationReport,
  type WorkstreamStep,
} from "@/lib/agent/spec";
import type { AgentEvent } from "@/lib/agent/events";

type WorkspaceState = {
  messages: ThreadMessage[];
  activeAgentId?: string;
  revisionCount: number;
  artifacts: CADArtifact[];
  preview?: CADArtifact;
  drawing?: CADArtifact;
  validation?: ValidationReport;
  revision?: CADRevision;
  spec?: EngineeringSpec;
  parameters: ParameterManifestItem[];
  running: boolean;
};

const emptyWorkspace = (): WorkspaceState => ({
  messages: [],
  revisionCount: 0,
  artifacts: [],
  parameters: [],
  running: false,
});

const REBUILD_WORKSTREAM_TEMPLATE: WorkstreamStep[] = [
  { id: "parameters", label: "Updating parameters", status: "pending" },
  { id: "kernel", label: "Running CAD kernel", status: "pending" },
  { id: "step", label: "Exporting STEP", status: "pending" },
  { id: "validation", label: "Validating geometry", status: "pending" },
  { id: "package", label: "Packaging files", status: "pending" },
];

export function CADAgentWorkspace() {
  const [hasStarted, setHasStarted] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => emptyWorkspace());

  async function runPrompt(prompt: string) {
    setHasStarted(true);
    const userMessage = userThreadMessage(prompt);
    const agentMessage = agentThreadMessage("Rev 001");
    setWorkspace({
      ...emptyWorkspace(),
      messages: [userMessage, agentMessage],
      activeAgentId: agentMessage.id,
      revisionCount: 1,
      running: true,
    });
    await consumeAgentEndpoint("/api/agent/run", { prompt });
  }

  async function revisePrompt(userPrompt: string) {
    if (!workspace.spec || !workspace.revision) {
      await runPrompt(userPrompt);
      return;
    }

    const nextRevisionCount = workspace.revisionCount + 1;
    const userMessage = userThreadMessage(userPrompt);
    const agentMessage = agentThreadMessage(formatRevision(nextRevisionCount));
    setWorkspace((current) => ({
      ...current,
      messages: [...current.messages, userMessage, agentMessage],
      activeAgentId: agentMessage.id,
      revisionCount: nextRevisionCount,
      running: true,
    }));

    await consumeAgentEndpoint("/api/agent/revise", {
      currentSpec: workspace.spec,
      currentRevisionId: workspace.revision.id,
      userPrompt,
    });
  }

  async function consumeAgentEndpoint(endpoint: string, body: unknown) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        setWorkspace((current) =>
          updateActiveAgent(current, {
            running: false,
            error: "The CAD agent could not start. Please try again.",
          }),
        );
        return;
      }

      await readAgentStream(response.body, (event) => {
        setWorkspace((current) => reduceEvent(current, event));
      });
    } catch {
      setWorkspace((current) =>
        updateActiveAgent(current, {
          running: false,
          error: "Connection interrupted while generating your CAD model.",
        }),
      );
    }
  }

  async function rebuildFromParameters(spec: EngineeringSpec) {
    const nextRevisionCount = workspace.revisionCount + 1;
    const userMessage = userThreadMessage("Updated parameters from the panel.");
    const agentMessage = agentThreadMessage(formatRevision(nextRevisionCount), cloneRebuildSteps());
    setWorkspace((current) => ({
      ...current,
      messages: [...current.messages, userMessage, agentMessage],
      activeAgentId: agentMessage.id,
      revisionCount: nextRevisionCount,
      running: true,
    }));
    setWorkspace((current) =>
      updateActiveAgent(current, {
        steps: updateStep(
          updateStep(currentActiveSteps(current), "parameters", "done"),
          "kernel",
          "running",
        ),
      }),
    );

    try {
      const response = await fetch("/api/cad/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, prompt: "parameter rebuild" }),
      });
      const data = (await response.json()) as { revision?: CADRevision; userMessage?: string };
      if (!response.ok || !data.revision) {
        setWorkspace((current) =>
          updateActiveAgent(current, {
            running: false,
            error: data.userMessage ?? "The CAD engine could not rebuild this revision.",
            steps: updateStep(currentActiveSteps(current), "kernel", "failed"),
          }),
        );
        return;
      }
      const revision = data.revision;
      setWorkspace((current) =>
        updateActiveAgent(current, {
          steps: updateStep(
            updateStep(
              updateStep(currentActiveSteps(current), "kernel", "done"),
              "step",
              "done",
            ),
            "validation",
            revision.validation?.passed ? "done" : "failed",
          ),
        }),
      );
      setWorkspace((current) => applyRevision(current, revision));
    } catch {
      setWorkspace((current) =>
        updateActiveAgent(current, {
          running: false,
          error: "The CAD engine connection was interrupted during rebuild.",
          steps: updateStep(currentActiveSteps(current), "kernel", "failed"),
        }),
      );
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
        <AgentThread messages={workspace.messages} running={workspace.running} onSubmit={revisePrompt} />
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
    case "step":
      return updateActiveAgent(current, {
        steps: updateStep(currentActiveSteps(current), event.stepId, event.status, event.detail),
      });
    case "spec":
      return { ...current, spec: event.spec };
    case "artifact": {
      const artifacts = upsertArtifact(current.artifacts, event.artifact);
      return updateActiveAgent(
        {
          ...current,
          artifacts,
          drawing: event.artifact.kind === "drawingSvg" ? event.artifact : current.drawing,
        },
        { artifacts },
      );
    }
    case "preview":
      return { ...updateActiveAgent(current, { preview: event.artifact }), preview: event.artifact };
    case "validation":
      return { ...updateActiveAgent(current, { validation: event.validation }), validation: event.validation };
    case "revision":
      return applyRevision(current, event.revision);
    case "run.completed":
      return applyRevision({ ...current, running: false }, event.revision);
    case "error":
      return updateActiveAgent(current, {
        running: false,
        error: event.userMessage,
      });
    default:
      return current;
  }
}

function applyRevision(current: WorkspaceState, revision: CADRevision): WorkspaceState {
  const preview = revision.artifacts.find((artifact) => artifact.kind === "stl");
  const drawing = revision.artifacts.find((artifact) => artifact.kind === "drawingSvg");
  return updateActiveAgent(
    {
      ...current,
      running: false,
      revision,
      spec: revision.engineeringSpec,
      parameters: revision.parameterManifest,
      artifacts: revision.artifacts,
      preview,
      drawing,
      validation: revision.validation,
    },
    {
      running: false,
      revision,
      artifacts: revision.artifacts,
      preview,
      validation: revision.validation,
      steps: currentActiveSteps(current).map((step) => ({
        ...step,
        status: step.status === "failed" ? "failed" : "done",
      })),
    },
  );
}

function updateActiveAgent(current: WorkspaceState, patch: Partial<Extract<ThreadMessage, { role: "agent" }>>): WorkspaceState {
  return {
    ...current,
    running: patch.running ?? current.running,
    messages: current.messages.map((message) =>
      message.role === "agent" && message.id === current.activeAgentId
        ? {
            ...message,
            ...patch,
          }
        : message,
    ),
  };
}

function currentActiveSteps(current: WorkspaceState) {
  const active = current.messages.find(
    (message): message is Extract<ThreadMessage, { role: "agent" }> =>
      message.role === "agent" && message.id === current.activeAgentId,
  );
  return active?.steps ?? cloneSteps();
}

function updateStep(steps: WorkstreamStep[], stepId: string, status: WorkstreamStep["status"], detail?: string) {
  return steps.map((step) => (step.id === stepId ? { ...step, status, detail: detail ?? step.detail } : step));
}

function upsertArtifact(artifacts: CADArtifact[], artifact: CADArtifact) {
  const existing = artifacts.filter((item) => item.id !== artifact.id);
  return [...existing, artifact];
}

function userThreadMessage(content: string): ThreadMessage {
  return { id: crypto.randomUUID(), role: "user", content };
}

function agentThreadMessage(revisionLabel: string, steps = cloneSteps()): ThreadMessage {
  return {
    id: crypto.randomUUID(),
    role: "agent",
    revisionLabel,
    steps,
    artifacts: [],
    running: true,
  };
}

function cloneSteps() {
  return WORKSTREAM_TEMPLATE.map((step) => ({ ...step }));
}

function cloneRebuildSteps() {
  return REBUILD_WORKSTREAM_TEMPLATE.map((step) => ({ ...step }));
}

function formatRevision(index: number) {
  return `Rev ${String(index).padStart(3, "0")}`;
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
