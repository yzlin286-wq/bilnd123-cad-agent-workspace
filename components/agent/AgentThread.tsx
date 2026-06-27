"use client";

import { useState } from "react";
import { ArrowUp, CheckCircle2, Circle, Loader2, TriangleAlert } from "lucide-react";
import { WorkstreamCard } from "@/components/agent/WorkstreamCard";
import { ArtifactCard } from "@/components/artifacts/ArtifactCard";
import type { CADArtifact, CADRevision, ValidationReport, WorkstreamStep } from "@/lib/agent/spec";

export type ThreadMessage =
  | {
      id: string;
      role: "user";
      content: string;
    }
  | {
      id: string;
      role: "agent";
      revisionLabel: string;
      steps: WorkstreamStep[];
      artifacts: CADArtifact[];
      preview?: CADArtifact;
      validation?: ValidationReport;
      revision?: CADRevision;
      error?: string;
      running: boolean;
    };

export function AgentThread({
  messages,
  running,
  onSubmit,
}: {
  messages: ThreadMessage[];
  running: boolean;
  onSubmit: (prompt: string) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <section className="agent-thread">
      <div className="thread-scroll">
        {messages.map((message) =>
          message.role === "user" ? (
            <article className="chat-message user" key={message.id}>
              <span>User</span>
              <p>{message.content}</p>
            </article>
          ) : (
            <AgentMessage message={message} key={message.id} />
          ),
        )}
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
          placeholder="Ask for a revision, like: change thickness to 6 mm..."
        />
        <button disabled={!draft.trim() || running} aria-label="Send revision request">
          {running ? <Loader2 size={17} className="spin" /> : <ArrowUp size={17} />}
        </button>
      </form>
    </section>
  );
}

function AgentMessage({ message }: { message: Extract<ThreadMessage, { role: "agent" }> }) {
  return (
    <article className="chat-message agent">
      <span>Agent</span>
      <div className="agent-card">
        <div className="agent-card-header">
          <div>
            <p className="microcopy">Creating your CAD model</p>
            <h2>
              {message.error
                ? "Needs connection"
                : message.running
                  ? `${message.revisionLabel} in progress`
                  : `${message.revisionLabel} ready for review`}
            </h2>
          </div>
          <StatusBadge running={message.running} validation={message.validation} error={message.error} />
        </div>
        <WorkstreamCard steps={message.steps} />
        {message.error ? (
          <div className="friendly-error">
            <TriangleAlert size={18} />
            <p>{message.error}</p>
          </div>
        ) : null}
        {message.artifacts.length ? (
          <div className="artifact-strip">
            {message.artifacts
              .filter((artifact) => ["step", "stl", "drawingSvg", "source", "validation"].includes(artifact.kind))
              .map((artifact) => (
                <ArtifactCard artifact={artifact} key={artifact.id} />
              ))}
          </div>
        ) : null}
        {message.validation ? (
          <div className={message.validation.passed ? "approval-card pass" : "approval-card fail"}>
            {message.validation.passed ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
            <span>
              {message.validation.passed
                ? `${message.revisionLabel} validated. Review the files before approval.`
                : `${message.revisionLabel} needs validation attention.`}
            </span>
          </div>
        ) : null}
      </div>
    </article>
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
