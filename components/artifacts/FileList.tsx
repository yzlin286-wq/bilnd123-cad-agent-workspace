"use client";

import { useState } from "react";
import { Check, Clipboard, Download } from "lucide-react";
import type { CADArtifact } from "@/lib/agent/spec";

export function FileList({ artifacts }: { artifacts: CADArtifact[] }) {
  const [copiedSourceId, setCopiedSourceId] = useState<string>();

  if (!artifacts.length) {
    return <div className="empty-panel">Files will appear after the CAD engine finishes a revision.</div>;
  }
  const primaryPackage = packageArtifact(artifacts);

  async function copySource(artifact: CADArtifact) {
    const response = await fetch(artifact.url);
    if (!response.ok) return;
    await navigator.clipboard.writeText(await response.text());
    setCopiedSourceId(artifact.id);
    window.setTimeout(() => setCopiedSourceId(undefined), 2200);
  }

  return (
    <div className="file-list">
      {primaryPackage ? (
        <a className="package-primary" href={primaryPackage.url} target="_blank" rel="noreferrer">
          <Download size={18} />
          <div>
            <strong>Download package.zip</strong>
            <span>STEP, STL, drawing, source, spec, validation</span>
          </div>
        </a>
      ) : null}
      {prioritizePackage(artifacts).map((artifact) => (
        <div className={artifact.kind === "package" ? "file-row package" : "file-row"} key={artifact.id}>
          <a href={artifact.url} target="_blank" rel="noreferrer">
            <span>{labelFor(artifact)}</span>
            <small>{descriptionFor(artifact)}</small>
            <strong>{formatBytes(artifact.bytes)}</strong>
            <Download size={15} />
          </a>
          {artifact.kind === "source" ? (
            <button className="copy-source-button" onClick={() => copySource(artifact)} type="button">
              {copiedSourceId === artifact.id ? <Check size={15} /> : <Clipboard size={15} />}
              {copiedSourceId === artifact.id ? "Copied" : "Copy source"}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function packageArtifact(artifacts: CADArtifact[]) {
  return artifacts.find((artifact) => artifact.kind === "package");
}

function prioritizePackage(artifacts: CADArtifact[]) {
  return [...artifacts].sort((a, b) => Number(b.kind === "package") - Number(a.kind === "package"));
}

function labelFor(artifact: CADArtifact) {
  if (artifact.kind === "package") return "Download package";
  if (artifact.kind === "step") return "Download STEP";
  if (artifact.kind === "stl") return "Download preview STL";
  if (artifact.kind === "drawingSvg") return "Download drawing SVG";
  if (artifact.kind === "source") return "Download source.py";
  if (artifact.kind === "spec") return "Download spec.json";
  if (artifact.kind === "validation") return "Download validation.json";
  if (artifact.kind === "manifest") return "Download manifest.json";
  return artifact.name;
}

function descriptionFor(artifact: CADArtifact) {
  if (artifact.kind === "package") return "STEP, STL, drawing, source, spec, validation";
  if (artifact.kind === "step") return "Neutral CAD exchange file";
  if (artifact.kind === "stl") return "Preview mesh for inspection";
  if (artifact.kind === "drawingSvg") return "2D generated drawing";
  if (artifact.kind === "source") return "Editable build123d script";
  return artifact.label;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
