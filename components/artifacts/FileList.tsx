"use client";

import { Download } from "lucide-react";
import type { CADArtifact } from "@/lib/agent/spec";

export function FileList({ artifacts }: { artifacts: CADArtifact[] }) {
  if (!artifacts.length) {
    return <div className="empty-panel">Files will appear after the CAD engine finishes a revision.</div>;
  }

  return (
    <div className="file-list">
      {artifacts.map((artifact) => (
        <a href={artifact.url} target="_blank" rel="noreferrer" key={artifact.id}>
          <span>{labelFor(artifact)}</span>
          <small>{descriptionFor(artifact)}</small>
          <strong>{formatBytes(artifact.bytes)}</strong>
          <Download size={15} />
        </a>
      ))}
    </div>
  );
}

function labelFor(artifact: CADArtifact) {
  if (artifact.kind === "package") return "Download package";
  return artifact.name;
}

function descriptionFor(artifact: CADArtifact) {
  if (artifact.kind === "package") return "STEP, STL, drawing, source, spec, validation";
  return artifact.label;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
