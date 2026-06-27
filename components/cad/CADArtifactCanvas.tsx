"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { FileList } from "@/components/artifacts/FileList";
import { ParameterControls } from "@/components/cad/ParameterControls";
import { RealModelViewer } from "@/components/cad/RealModelViewer";
import type { CADArtifact, CADRevision, EngineeringSpec, ParameterManifestItem, ValidationReport } from "@/lib/agent/spec";

type CanvasTab = "preview" | "drawing" | "parameters" | "files";

export function CADArtifactCanvas({
  revision,
  artifacts,
  preview,
  drawing,
  parameters,
  spec,
  validation,
  running,
  onRebuild,
  onFeedback,
}: {
  revision?: CADRevision;
  artifacts: CADArtifact[];
  preview?: CADArtifact;
  drawing?: CADArtifact;
  parameters: ParameterManifestItem[];
  spec?: EngineeringSpec;
  validation?: ValidationReport;
  running: boolean;
  onRebuild: (spec: EngineeringSpec) => void;
  onFeedback: (feedback: { rating: "up" | "down"; comment: string }) => Promise<void>;
}) {
  const [tab, setTab] = useState<CanvasTab>("preview");
  const tabs: { id: CanvasTab; label: string }[] = [
    { id: "preview", label: "Preview" },
    { id: "drawing", label: "Drawing" },
    { id: "parameters", label: "Parameters" },
    { id: "files", label: "Files" },
  ];

  return (
    <section className="cad-canvas">
      <header className="canvas-top">
        <div>
          <p className="microcopy">CAD artifact canvas</p>
          <h2>{revision ? `Revision ${revision.id}` : "Waiting for model"}</h2>
        </div>
        {validation ? <span className={validation.passed ? "mini-pass" : "mini-fail"}>{validation.passed ? "Validated" : "Needs review"}</span> : null}
      </header>
      <div className="canvas-tabs">
        {tabs.map((item) => (
          <button className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)} key={item.id}>
            {item.label}
          </button>
        ))}
      </div>
      {revision ? <FeedbackPanel key={revision.id} onFeedback={onFeedback} /> : null}
      <div className="canvas-body">
        {tab === "preview" ? <PreviewPanel artifact={preview} loading={running} validation={validation} /> : null}
        {tab === "drawing" ? <DrawingPanel artifact={drawing} loading={running} /> : null}
        {tab === "parameters" ? (
          <ParameterControls
            key={revision?.id ?? "no-revision"}
            manifest={parameters}
            spec={spec}
            disabled={running || !spec}
            onRebuild={onRebuild}
          />
        ) : null}
        {tab === "files" ? <FileList artifacts={artifacts} /> : null}
      </div>
    </section>
  );
}

function PreviewPanel({
  artifact,
  loading,
  validation,
}: {
  artifact?: CADArtifact;
  loading: boolean;
  validation?: ValidationReport;
}) {
  return (
    <div className="preview-panel">
      <RealModelViewer artifact={artifact} loading={loading} />
      {validation ? (
        <div className={validation.passed ? "validation-summary pass" : "validation-summary fail"}>
          <strong>{validation.passed ? "Validation passed" : "Validation needs review"}</strong>
          <span>
            {validation.checks.filter((check) => check.passed).length}/{validation.checks.length} checks passed
          </span>
        </div>
      ) : null}
    </div>
  );
}

function FeedbackPanel({
  onFeedback,
}: {
  onFeedback: (feedback: { rating: "up" | "down"; comment: string }) => Promise<void>;
}) {
  const [rating, setRating] = useState<"up" | "down" | undefined>();
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  async function submit() {
    if (!rating) return;
    setStatus("saving");
    try {
      await onFeedback({ rating, comment });
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="feedback-panel">
      <div className="feedback-buttons" aria-label="Revision feedback">
        <button className={rating === "up" ? "active" : ""} onClick={() => setRating("up")} type="button">
          Thumbs up
        </button>
        <button className={rating === "down" ? "active" : ""} onClick={() => setRating("down")} type="button">
          Thumbs down
        </button>
      </div>
      <input
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Optional feedback for this revision"
        maxLength={500}
      />
      <button className="feedback-submit" disabled={!rating || status === "saving"} onClick={submit} type="button">
        {status === "saving" ? "Saving" : "Send"}
      </button>
      {status === "saved" ? <span className="feedback-status">Saved</span> : null}
      {status === "failed" ? <span className="feedback-status fail">Not saved</span> : null}
    </div>
  );
}

function DrawingPanel({ artifact, loading }: { artifact?: CADArtifact; loading: boolean }) {
  if (loading && !artifact) {
    return <div className="preview-skeleton">Generating drawing...</div>;
  }
  if (!artifact) {
    return <div className="empty-panel">The generated engineering drawing will appear here.</div>;
  }
  return (
    <div className="drawing-panel">
      <a className="drawing-download" href={artifact.url} target="_blank" rel="noreferrer">
        <Download size={15} />
        Download drawing SVG
      </a>
      <iframe
        className="drawing-frame"
        src={artifact.url}
        title="Engineering drawing"
      />
    </div>
  );
}
