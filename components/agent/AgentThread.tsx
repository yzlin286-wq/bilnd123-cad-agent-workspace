"use client";

import { useState } from "react";
import { ArrowUp, CheckCircle2, Circle, Loader2, TriangleAlert } from "lucide-react";
import { WorkstreamCard } from "@/components/agent/WorkstreamCard";
import { ArtifactCard } from "@/components/artifacts/ArtifactCard";
import type { CADArtifact, ValidationReport, WorkstreamStep } from "@/lib/agent/spec";

export function AgentThread({
  prompt,
  steps,
  artifacts,
  validation,
  error,
  running,
  onSubmit,
}: {
  prompt: string;
  steps: WorkstreamStep[];
  artifacts: CADArtifact[];
  validation?: ValidationReport;
  error?: string;
  running: boolean;
  onSubmit: (prompt: string) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <section className="agent-thread">
      <div className="thread-scroll">
        <article className="chat-message user">
          <span>User</span>
          <p>{prompt}</p>
        </article>
        <article className="chat-message agent">
          <span>Agent</span>
          <div className="agent-card">
            <div className="agent-card-header">
              <div>
                <p className="microcopy">Creating your CAD model</p>
                <h2>{running ? "Workstream in progress" : error ? "Needs connection" : "Revision ready for review"}</h2>
              </div>
              <StatusBadge running={running} validation={validation} error={error} />
            </div>
            <WorkstreamCard steps={steps} />
            {error ? (
              <div className="friendly-error">
                <TriangleAlert size={18} />
                <p>{error}</p>
              </div>
            ) : null}
            {artifacts.length ? (
              <div className="artifact-strip">
                {artifacts
                  .filter((artifact) => ["step", "stl", "drawingSvg", "source", "validation"].includes(artifact.kind))
                  .map((artifact) => (
                    <ArtifactCard artifact={artifact} key={artifact.id} />
                  ))}
              </div>
            ) : null}
            {validation ? (
              <div className={validation.passed ? "approval-card pass" : "approval-card fail"}>
                {validation.passed ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
                <span>{validation.passed ? "Geometry validated. Review the files before approval." : "Validation needs attention."}</span>
              </div>
            ) : null}
          </div>
        </article>
      </div>
      <form
        className="thread-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          onSubmit(draft.trim());
          setDraft("");
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask for a revision, like: make the holes countersunk and set thickness to 6 mm..."
        />
        <button disabled={!draft.trim() || running} aria-label="Send revision request">
          {running ? <Loader2 size={17} className="spin" /> : <ArrowUp size={17} />}
        </button>
      </form>
    </section>
  );
}

function StatusBadge({
  running,
  validation,
  error,
}: {
  running: boolean;
  validation?: ValidationReport;
  error?: string;
}) {
  if (running) {
    return (
      <div className="status-badge running">
        <Loader2 size={15} className="spin" />
        Generating
      </div>
    );
  }
  if (error) {
    return (
      <div className="status-badge fail">
        <TriangleAlert size={15} />
        Attention
      </div>
    );
  }
  if (validation?.passed) {
    return (
      <div className="status-badge pass">
        <CheckCircle2 size={15} />
        Ready
      </div>
    );
  }
  return (
    <div className="status-badge idle">
      <Circle size={15} />
      Waiting
    </div>
  );
}
