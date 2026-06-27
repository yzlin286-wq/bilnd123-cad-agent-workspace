"use client";

import { Archive, Download, FileCode2, FileJson2, FileText, Layers3 } from "lucide-react";
import type { CADArtifact } from "@/lib/agent/spec";

export function ArtifactCard({ artifact }: { artifact: CADArtifact }) {
  return (
    <a className="artifact-link-card" href={artifact.url} target="_blank" rel="noreferrer">
      {iconFor(artifact.kind)}
      <span>{labelFor(artifact)}</span>
      <small>{descriptionFor(artifact) ?? formatBytes(artifact.bytes)}</small>
      <Download size={15} />
    </a>
  );
}

function iconFor(kind: CADArtifact["kind"]) {
  if (kind === "stl") return <Layers3 size={18} />;
  if (kind === "source") return <FileCode2 size={18} />;
  if (kind === "package") return <Archive size={18} />;
  if (kind === "validation" || kind === "spec" || kind === "manifest") return <FileJson2 size={18} />;
  return <FileText size={18} />;
}

function labelFor(artifact: CADArtifact) {
  if (artifact.kind === "step") return "Download STEP";
  if (artifact.kind === "stl") return "Preview mesh";
  if (artifact.kind === "drawingSvg") return "Drawing SVG";
  if (artifact.kind === "source") return "Source code";
  if (artifact.kind === "validation") return "Validation";
  if (artifact.kind === "package") return "Download package";
  return artifact.label;
}

function descriptionFor(artifact: CADArtifact) {
  if (artifact.kind === "package") return "STEP, STL, drawing, source, spec, validation";
  return undefined;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
