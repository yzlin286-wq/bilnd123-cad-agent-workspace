"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  FileUp,
  GitBranch,
  History,
  Layers3,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Share2,
  SlidersHorizontal,
} from "lucide-react";
import {
  artifactStatusLabel,
  artifacts,
  eventExamples,
  logText,
  parameters,
  projects,
  revisions,
  RuntimeReadiness,
  sourceCode,
  statusIcon,
  validationChecks,
  validationJson,
  workstreamSteps,
} from "@/lib/workspace-data";
import { ThreeViewer } from "@/components/workspace/ThreeViewer";
import { WorkstreamFlow } from "@/components/workspace/WorkstreamFlow";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="code-loading">Loading editor...</div>,
});

type CanvasTab = "preview" | "drawing" | "measure" | "parameters" | "flow";
type DrawerTab = "source" | "validation" | "log" | "files";

type AgentError = {
  title: string;
  detail: string;
  missing?: string[];
};

export function CADAgentWorkspace() {
  const [canvasTab, setCanvasTab] = useState<CanvasTab>("preview");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("source");
  const [prompt, setPrompt] = useState(
    "Make a 120 x 80 x 4 mm aluminum mounting plate with four M4 holes, 10 mm edge offset, and 1 mm chamfer.",
  );
  const [isRunning, setIsRunning] = useState(false);
  const [agentError, setAgentError] = useState<AgentError | null>(null);
  const [runtime, setRuntime] = useState<RuntimeReadiness | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch("/api/runtime")
      .then((response) => response.json())
      .then((data: RuntimeReadiness) => {
        if (!ignore) setRuntime(data);
      })
      .catch(() => {
        if (!ignore) {
          setRuntime({ llmConfigured: false, cadRunnerConfigured: false });
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  const runtimeSummary = useMemo(() => {
    if (!runtime) return "Checking runtime";
    if (runtime.llmConfigured && runtime.cadRunnerConfigured) return "Runtime ready";
    if (runtime.llmConfigured) return "LLM ready, CAD runner missing";
    return "Real LLM not configured";
  }, [runtime]);

  async function runAgent() {
    setIsRunning(true);
    setAgentError(null);
    try {
      const response = await fetch("/api/agent/workstream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, projectId: "aluminum-mounting-plate" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setAgentError({
          title: data.error ?? "Agent run could not start",
          detail: data.detail ?? "The real model endpoint rejected the request.",
          missing: data.missing,
        });
      }
    } catch (error) {
      setAgentError({
        title: "Agent run failed",
        detail: error instanceof Error ? error.message : "Unknown network error.",
      });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="workspace">
      <TopBar runtimeSummary={runtimeSummary} />
      <section className="workspace-grid">
        <ProjectSidebar />
        <AgentThread
          prompt={prompt}
          setPrompt={setPrompt}
          runAgent={runAgent}
          isRunning={isRunning}
          agentError={agentError}
          runtime={runtime}
        />
        <CADCanvas activeTab={canvasTab} setActiveTab={setCanvasTab} />
      </section>
      <ArtifactDrawer activeTab={drawerTab} setActiveTab={setDrawerTab} />
    </main>
  );
}

function TopBar({ runtimeSummary }: { runtimeSummary: string }) {
  return (
    <header className="top-bar">
      <div className="top-title">
        <div className="product-mark">
          <Layers3 size={18} />
        </div>
        <div>
          <p className="eyebrow">CAD Agent Workspace</p>
          <h1>Aluminum Mounting Plate</h1>
        </div>
      </div>
      <div className="top-meta">
        <span>Rev 003</span>
        <span>mm</span>
        <span>{runtimeSummary}</span>
      </div>
      <div className="top-actions">
        <IconButton label="Download bundle" icon={Download} />
        <IconButton label="Share" icon={Share2} />
        <IconButton label="Settings" icon={Settings} />
      </div>
    </header>
  );
}

function ProjectSidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-section sidebar-header">
        <button className="primary-compact">
          <Plus size={15} />
          New Project
        </button>
      </div>

      <div className="sidebar-section">
        <div className="section-title">
          <span>Projects</span>
          <History size={14} />
        </div>
        <div className="nav-list">
          {projects.map((project) => (
            <button className={project.active ? "nav-item active" : "nav-item"} key={project.name}>
              <span>{project.name}</span>
              <small>{project.kind}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-title">
          <span>Revisions</span>
          <GitBranch size={14} />
        </div>
        <div className="revision-list">
          {revisions.map((revision) => (
            <button className={revision.active ? "revision active" : "revision"} key={revision.id}>
              <span>{revision.label}</span>
              <small>{revision.status}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-title">
          <span>Artifacts</span>
          <ArrowDownToLine size={14} />
        </div>
        <div className="artifact-mini-list">
          {artifacts.slice(0, 5).map((artifact) => {
            const Icon = artifact.icon;
            return (
              <button className="artifact-mini" key={artifact.name}>
                <Icon size={15} />
                <span>{artifact.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function AgentThread({
  prompt,
  setPrompt,
  runAgent,
  isRunning,
  agentError,
  runtime,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  runAgent: () => void;
  isRunning: boolean;
  agentError: AgentError | null;
  runtime: RuntimeReadiness | null;
}) {
  return (
    <section className="thread-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Chat / Agent Workstream</p>
          <h2>Natural language to inspectable CAD artifacts</h2>
        </div>
        <button className="ghost-button">
          <PanelRightOpen size={16} />
          Review Mode
        </button>
      </div>

      <div className="messages">
        <article className="message user-message">
          <div className="avatar user-avatar">U</div>
          <div className="message-body">
            <p>{prompt}</p>
          </div>
        </article>

        <article className="message agent-message">
          <div className="avatar agent-avatar">
            <Bot size={17} />
          </div>
          <div className="message-body">
            <div className="agent-summary">
              <div>
                <p className="eyebrow">Parsed engineering spec</p>
                <h3>Mounting plate, CNC ready</h3>
              </div>
              <span className="status-pill good">
                <Check size={14} />
                Validation passed
              </span>
            </div>
            <SpecGrid />
            <WorkstreamTimeline />
            <EventStreamStrip />
            <ArtifactCards />
            {agentError ? <RuntimeErrorCard error={agentError} /> : null}
            <RuntimePolicy runtime={runtime} />
          </div>
        </article>
      </div>

      <div className="composer">
        <div className="composer-tools">
          <button title="Attach image or sketch" className="icon-only">
            <FileUp size={17} />
          </button>
          <button className="tool-chip">
            CNC
            <ChevronDown size={14} />
          </button>
          <button className="tool-chip">
            mm
            <ChevronDown size={14} />
          </button>
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          aria-label="CAD agent prompt"
        />
        <button className="send-button" onClick={runAgent} disabled={isRunning}>
          {isRunning ? <RefreshCw size={17} className="spin" /> : <Send size={17} />}
          {isRunning ? "Running" : "Run real agent"}
        </button>
      </div>
    </section>
  );
}

function SpecGrid() {
  return (
    <div className="spec-grid">
      <div>
        <span>Size</span>
        <strong>120 x 80 x 4 mm</strong>
      </div>
      <div>
        <span>Holes</span>
        <strong>4 x M4 through</strong>
      </div>
      <div>
        <span>Edge offset</span>
        <strong>10 mm</strong>
      </div>
      <div>
        <span>Outputs</span>
        <strong>STEP, GLB, SVG, source</strong>
      </div>
    </div>
  );
}

function WorkstreamTimeline() {
  return (
    <div className="timeline">
      {workstreamSteps.map((step) => {
        const Icon = statusIcon[step.status];
        return (
          <div className={`timeline-row ${step.status}`} key={step.key}>
            <div className="timeline-icon">
              <Icon size={16} />
            </div>
            <div>
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventStreamStrip() {
  return (
    <div className="event-strip">
      {eventExamples.map((event) => {
        const Icon = event.icon;
        return (
          <div className="event-item" key={event.label}>
            <Icon size={15} />
            <span>{event.label}</span>
            <small>{event.value}</small>
          </div>
        );
      })}
    </div>
  );
}

function ArtifactCards() {
  return (
    <div className="artifact-grid">
      {artifacts.slice(0, 4).map((artifact) => {
        const Icon = artifact.icon;
        return (
          <button className="artifact-card" key={artifact.name}>
            <Icon size={18} />
            <span>{artifact.name}</span>
            <small>{artifactStatusLabel[artifact.status]}</small>
          </button>
        );
      })}
    </div>
  );
}

function RuntimeErrorCard({ error }: { error: AgentError }) {
  return (
    <div className="error-card">
      <CircleAlert size={18} />
      <div>
        <strong>{error.title}</strong>
        <p>{error.detail}</p>
        {error.missing?.length ? <small>Missing: {error.missing.join(", ")}</small> : null}
      </div>
    </div>
  );
}

function RuntimePolicy({ runtime }: { runtime: RuntimeReadiness | null }) {
  const llmReady = runtime?.llmConfigured;
  const cadReady = runtime?.cadRunnerConfigured;
  return (
    <div className="policy-strip">
      <div className={llmReady ? "policy-item ready" : "policy-item blocked"}>
        <Clock3 size={15} />
        <span>{llmReady ? "Real LLM configured" : "Real LLM required"}</span>
      </div>
      <div className={cadReady ? "policy-item ready" : "policy-item blocked"}>
        <SlidersHorizontal size={15} />
        <span>{cadReady ? "CAD runner configured" : "CAD runner required"}</span>
      </div>
      <div className="policy-item ready">
        <Check size={15} />
        <span>No direct code fallback</span>
      </div>
    </div>
  );
}

function CADCanvas({
  activeTab,
  setActiveTab,
}: {
  activeTab: CanvasTab;
  setActiveTab: (tab: CanvasTab) => void;
}) {
  const tabs: { id: CanvasTab; label: string }[] = [
    { id: "preview", label: "3D Preview" },
    { id: "drawing", label: "Drawing" },
    { id: "measure", label: "Measure" },
    { id: "parameters", label: "Parameters" },
    { id: "flow", label: "Flow" },
  ];

  return (
    <section className="canvas-panel">
      <div className="panel-heading canvas-heading">
        <div>
          <p className="eyebrow">CAD Canvas</p>
          <h2>Inspect model, drawing, and parameters</h2>
        </div>
      </div>
      <div className="tabs">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab.id ? "tab active" : "tab"}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="canvas-content">
        {activeTab === "preview" ? <ThreeViewer /> : null}
        {activeTab === "drawing" ? <DrawingPreview /> : null}
        {activeTab === "measure" ? <MeasurementPanel /> : null}
        {activeTab === "parameters" ? <ParameterPanel /> : null}
        {activeTab === "flow" ? <WorkstreamFlow /> : null}
      </div>
    </section>
  );
}

function DrawingPreview() {
  return (
    <div className="drawing-sheet">
      <svg viewBox="0 0 520 340" role="img" aria-label="Engineering drawing preview">
        <rect x="20" y="20" width="480" height="300" fill="#f8fafc" stroke="#1f2937" strokeWidth="2" />
        <rect x="120" y="92" width="280" height="150" rx="8" fill="none" stroke="#0f172a" strokeWidth="3" />
        {[150, 370].map((x) =>
          [122, 212].map((y) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="15" fill="none" stroke="#0f172a" strokeWidth="3" />
          )),
        )}
        <line x1="120" y1="270" x2="400" y2="270" stroke="#2563eb" strokeWidth="2" />
        <line x1="120" y1="260" x2="120" y2="282" stroke="#2563eb" strokeWidth="2" />
        <line x1="400" y1="260" x2="400" y2="282" stroke="#2563eb" strokeWidth="2" />
        <text x="244" y="294" fill="#0f172a" fontSize="16">
          120 mm
        </text>
        <line x1="84" y1="92" x2="84" y2="242" stroke="#2563eb" strokeWidth="2" />
        <line x1="72" y1="92" x2="96" y2="92" stroke="#2563eb" strokeWidth="2" />
        <line x1="72" y1="242" x2="96" y2="242" stroke="#2563eb" strokeWidth="2" />
        <text x="42" y="174" fill="#0f172a" fontSize="16" transform="rotate(-90 42 174)">
          80 mm
        </text>
        <rect x="335" y="276" width="145" height="28" fill="#e2e8f0" stroke="#1f2937" />
        <text x="346" y="295" fill="#0f172a" fontSize="13">
          Rev 003 | mm | CNC
        </text>
      </svg>
    </div>
  );
}

function MeasurementPanel() {
  return (
    <div className="measurement-panel">
      {validationChecks.map((check) => (
        <div className="measurement-row" key={check.name}>
          <span>{check.name}</span>
          <strong>{check.actual}</strong>
          <small>{check.passed ? "pass" : "fail"}</small>
        </div>
      ))}
    </div>
  );
}

function ParameterPanel() {
  return (
    <div className="parameter-panel">
      {parameters.map((parameter) => (
        <label className="parameter-row" key={parameter.label}>
          <span>{parameter.label}</span>
          {typeof parameter.value === "number" ? (
            <>
              <input
                type="range"
                min={parameter.min}
                max={parameter.max}
                value={parameter.value}
                readOnly
              />
              <strong>
                {parameter.value} {parameter.unit}
              </strong>
            </>
          ) : (
            <strong>{parameter.value}</strong>
          )}
        </label>
      ))}
    </div>
  );
}

function ArtifactDrawer({
  activeTab,
  setActiveTab,
}: {
  activeTab: DrawerTab;
  setActiveTab: (tab: DrawerTab) => void;
}) {
  const tabs: { id: DrawerTab; label: string }[] = [
    { id: "source", label: "source.py" },
    { id: "validation", label: "validation.json" },
    { id: "log", label: "run.log" },
    { id: "files", label: "files" },
  ];

  return (
    <section className="artifact-drawer">
      <div className="drawer-tabs">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab.id ? "drawer-tab active" : "drawer-tab"}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="drawer-content">
        {activeTab === "source" ? (
          <MonacoEditor
            height="188px"
            language="python"
            value={sourceCode}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              readOnly: true,
              scrollBeyondLastLine: false,
              wordWrap: "on",
            }}
          />
        ) : null}
        {activeTab === "validation" ? <pre>{validationJson}</pre> : null}
        {activeTab === "log" ? <pre>{logText}</pre> : null}
        {activeTab === "files" ? <FileTable /> : null}
      </div>
    </section>
  );
}

function FileTable() {
  return (
    <div className="file-table">
      {artifacts.map((artifact) => {
        const Icon = artifact.icon;
        return (
          <div className="file-row" key={artifact.name}>
            <Icon size={16} />
            <span>{artifact.name}</span>
            <small>{artifact.kind}</small>
            <strong>{artifact.size}</strong>
            <button className="icon-only" title={`Download ${artifact.name}`}>
              <Download size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function IconButton({
  label,
  icon: Icon,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}) {
  return (
    <button className="icon-only" title={label} aria-label={label}>
      <Icon size={17} />
    </button>
  );
}
