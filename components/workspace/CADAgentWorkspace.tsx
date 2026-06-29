"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { HeroComposer } from "@/components/landing/HeroComposer";
import { AgentThread, type ThreadMessage } from "@/components/agent/AgentThread";
import { CADArtifactCanvas } from "@/components/cad/CADArtifactCanvas";
import { createClientId } from "@/lib/client/ids";
import { templateById } from "@/lib/cad/templates";
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
import type { StoredProject, StoredProjectSummary } from "@/lib/project/types";

type WorkspaceState = {
  projectId?: string;
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

export function CADAgentWorkspace({
  initialProjectId,
  initialTemplate,
}: {
  initialProjectId?: string;
  initialTemplate?: string;
}) {
  const [hasStarted, setHasStarted] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => emptyWorkspace());
  const [recentProjects, setRecentProjects] = useState<StoredProjectSummary[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadLatestProject() {
      try {
        const projects = await fetchProjectSummaries();
        if (cancelled) return;
        setRecentProjects(projects);
        const latest = initialProjectId ? projects.find((project) => project.id === initialProjectId) : projects[0];
        if (latest?.latestRevisionId) {
          const project = await fetchProject(latest.id);
          if (!cancelled && project) {
            setWorkspace(workspaceFromProject(project));
            setHasStarted(true);
          }
        }
      } finally {
        if (!cancelled) setLoadingRecent(false);
      }
    }
    void loadLatestProject();
    return () => {
      cancelled = true;
    };
  }, [initialProjectId]);

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
    await refreshRecentProjects();
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
      projectId: workspace.projectId,
      currentSpec: workspace.spec,
      currentRevisionId: workspace.revision.id,
      userPrompt,
    });
    await refreshRecentProjects();
  }

  async function consumeAgentEndpoint(endpoint: string, body: unknown) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        const data = await safeResponseJSON(response);
        setWorkspace((current) =>
          updateActiveAgent(current, {
            running: false,
            errorCode: data?.error,
            error: data?.userMessage ?? "The CAD agent could not start. Please try again.",
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
          errorCode: "SSE_ABORT",
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
        body: JSON.stringify({ projectId: workspace.projectId, spec, prompt: "parameter rebuild" }),
      });
      const data = (await response.json()) as { revision?: CADRevision; userMessage?: string; error?: string };
      if (!response.ok || !data.revision) {
        setWorkspace((current) =>
          updateActiveAgent(current, {
            running: false,
            errorCode: data.error,
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
              updateStep(
                updateStep(currentActiveSteps(current), "kernel", "done"),
                "step",
                "done",
              ),
              "validation",
              revision.validation?.passed ? "done" : "failed",
            ),
            "package",
            "done",
          ),
        }),
      );
      setWorkspace((current) => applyRevision(current, revision));
      await refreshRecentProjects();
    } catch {
      setWorkspace((current) =>
        updateActiveAgent(current, {
          running: false,
          errorCode: "CAD_RUNNER_CRASH",
          error: "The CAD engine connection was interrupted during rebuild.",
          steps: updateStep(currentActiveSteps(current), "kernel", "failed"),
        }),
      );
    }
  }

  async function submitFeedback({
    rating,
    comment,
  }: {
    rating: "up" | "down";
    comment: string;
  }) {
    const revisionId = workspace.revision?.id;
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating,
        comment,
        revisionId,
        route: workspace.revisionCount > 1 ? "/api/agent/revise" : "/api/agent/run",
      }),
    });
    if (!response.ok) {
      throw new Error("Feedback could not be saved.");
    }
  }

  async function refreshRecentProjects() {
    const projects = await fetchProjectSummaries();
    setRecentProjects(projects);
  }

  async function loadProject(projectId: string) {
    const project = await fetchProject(projectId);
    if (!project) return;
    setWorkspace(workspaceFromProject(project));
    setHasStarted(true);
  }

  function startNewProject() {
    setWorkspace(emptyWorkspace());
    setHasStarted(false);
  }

  if (!hasStarted) {
    return <HeroComposer initialPrompt={promptForTemplate(initialTemplate)} onGenerate={runPrompt} />;
  }

  return (
    <main className="product-shell">
      <aside className="rail">
        <div className="brand-pill">
          <Sparkles size={17} />
        </div>
        <button onClick={startNewProject}>New CAD</button>
        <div className="revision-timeline">
          <span>Revisions</span>
          {workspace.messages
            .filter((message): message is Extract<ThreadMessage, { role: "agent" }> => message.role === "agent")
            .map((message) => (
              <button className={message.id === workspace.activeAgentId ? "active" : ""} key={message.id}>
                <strong>{message.revisionLabel}</strong>
                <small>{message.revision?.validation?.passed ? "Validated" : message.error ? "Attention" : "Ready"}</small>
              </button>
            ))}
        </div>
        <div className="recent-rail">
          <span>Recent</span>
          {loadingRecent ? <small>Loading...</small> : null}
          {!loadingRecent && !recentProjects.length ? <small>No saved projects</small> : null}
          {recentProjects.map((project) => (
            <button
              className={project.id === workspace.projectId ? "active" : ""}
              onClick={() => loadProject(project.id)}
              key={project.id}
            >
              <strong>{project.title}</strong>
              <small>
                {project.revisionCount} rev{project.revisionCount === 1 ? "" : "s"}
              </small>
            </button>
          ))}
        </div>
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
          onFeedback={submitFeedback}
        />
      </section>
    </main>
  );
}

async function fetchProjectSummaries() {
  const response = await fetch("/api/projects?limit=8", { cache: "no-store" });
  if (!response.ok) return [];
  const data = (await response.json()) as { projects?: StoredProjectSummary[] };
  return data.projects ?? [];
}

async function fetchProject(projectId: string) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
  if (!response.ok) return undefined;
  const data = (await response.json()) as { project?: StoredProject };
  return data.project;
}

function reduceEvent(current: WorkspaceState, event: AgentEvent): WorkspaceState {
  switch (event.type) {
    case "project":
      return { ...current, projectId: event.project.id };
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
        errorCode: event.code,
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

function workspaceFromProject(project: StoredProject): WorkspaceState {
  const latestRevision =
    project.revisions.find((revision) => revision.id === project.latestRevisionId) ?? project.revisions.at(-1);
  const preview = latestRevision?.artifacts.find((artifact) => artifact.kind === "stl");
  const drawing = latestRevision?.artifacts.find((artifact) => artifact.kind === "drawingSvg");
  const revisionsById = new Map(project.revisions.map((revision) => [revision.id, revision]));
  const revisionLabels = new Map(project.revisions.map((revision, index) => [revision.id, formatRevision(index + 1)]));
  const messages: ThreadMessage[] = project.messages.length
    ? project.messages.map((message) => {
        if (message.role === "user") {
          return { id: message.id, role: "user", content: message.content };
        }
        const revision = message.revisionId ? revisionsById.get(message.revisionId) : undefined;
        return agentThreadMessageFromStore({
          id: message.id,
          revisionLabel: (message.revisionId && revisionLabels.get(message.revisionId)) || "Revision",
          revision,
          error: message.errorCode ? message.content : undefined,
          errorCode: message.errorCode,
        });
      })
    : project.revisions.map((revision, index) =>
        agentThreadMessageFromStore({
          id: revision.id,
          revisionLabel: formatRevision(index + 1),
          revision,
        }),
      );
  const lastAgent = [...messages].reverse().find((message) => message.role === "agent");

  return {
    projectId: project.id,
    messages,
    activeAgentId: lastAgent?.id,
    revisionCount: project.revisions.length,
    artifacts: latestRevision?.artifacts ?? [],
    preview,
    drawing,
    validation: latestRevision?.validation,
    revision: latestRevision,
    spec: latestRevision?.engineeringSpec,
    parameters: latestRevision?.parameterManifest ?? [],
    running: false,
  };
}

function agentThreadMessageFromStore({
  id,
  revisionLabel,
  revision,
  error,
  errorCode,
}: {
  id: string;
  revisionLabel: string;
  revision?: CADRevision;
  error?: string;
  errorCode?: string;
}): Extract<ThreadMessage, { role: "agent" }> {
  return {
    id,
    role: "agent",
    revisionLabel,
    steps: revision ? doneSteps() : cloneSteps(),
    artifacts: revision?.artifacts ?? [],
    preview: revision?.artifacts.find((artifact) => artifact.kind === "stl"),
    validation: revision?.validation,
    revision,
    error,
    errorCode,
    running: false,
  };
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
  return { id: createClientId("user-message"), role: "user", content };
}

function agentThreadMessage(revisionLabel: string, steps = cloneSteps()): ThreadMessage {
  return {
    id: createClientId("agent-message"),
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

function doneSteps() {
  return WORKSTREAM_TEMPLATE.map((step) => ({ ...step, status: "done" as const }));
}

function cloneRebuildSteps() {
  return REBUILD_WORKSTREAM_TEMPLATE.map((step) => ({ ...step }));
}

function formatRevision(index: number) {
  return `Rev ${String(index).padStart(3, "0")}`;
}

function promptForTemplate(template: string | undefined) {
  return templateById(template)?.examplePrompt;
}

async function safeResponseJSON(response: Response) {
  try {
    return (await response.json()) as { error?: string; userMessage?: string };
  } catch {
    return undefined;
  }
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
