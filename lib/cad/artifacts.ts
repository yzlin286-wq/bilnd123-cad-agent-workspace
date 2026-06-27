import { promises as fs } from "node:fs";
import path from "node:path";
import type { CADArtifact, CADArtifactKind, CADRevision, EngineeringSpec, ParameterManifestItem, ValidationReport } from "@/lib/agent/spec";

export const CAD_OUTPUT_ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "outputs", "cad");

type RunnerManifestArtifact = {
  kind: CADArtifactKind;
  label: string;
  name: string;
  path: string;
  bytes: number;
};

type RunnerManifest = {
  revisionId: string;
  createdAt: string;
  engineeringSpec: EngineeringSpec;
  parameterManifest: ParameterManifestItem[];
  artifacts: RunnerManifestArtifact[];
};

const MIME_BY_EXT: Record<string, string> = {
  ".step": "model/step",
  ".stp": "model/step",
  ".stl": "model/stl",
  ".svg": "image/svg+xml",
  ".py": "text/x-python; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
};

export function artifactIdFromPath(filePath: string) {
  const absolute = ensureInsideOutputRoot(path.resolve(filePath));
  const relative = path.relative(CAD_OUTPUT_ROOT, absolute).replaceAll(path.sep, "/");
  return Buffer.from(relative, "utf8").toString("base64url");
}

export function resolveArtifactPath(id: string) {
  const relative = Buffer.from(id, "base64url").toString("utf8");
  const absolute = path.resolve(CAD_OUTPUT_ROOT, relative);
  return ensureInsideOutputRoot(absolute);
}

export function artifactUrl(id: string) {
  return `/api/artifacts/${encodeURIComponent(id)}`;
}

export async function fileToArtifact(kind: CADArtifactKind, label: string, filePath: string): Promise<CADArtifact> {
  const stats = await fs.stat(filePath);
  const id = artifactIdFromPath(filePath);
  return {
    id,
    kind,
    label,
    name: path.basename(filePath),
    url: artifactUrl(id),
    bytes: stats.size,
    contentType: contentTypeFor(filePath),
  };
}

export function contentTypeFor(filePath: string) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export async function revisionFromManifest(manifestPath: string, prompt?: string): Promise<CADRevision> {
  const safeManifestPath = ensureInsideOutputRoot(path.resolve(manifestPath));
  const manifest = JSON.parse(await fs.readFile(safeManifestPath, "utf8")) as RunnerManifest;
  const safeArtifactPaths = manifest.artifacts.map((item) => ({
    ...item,
    path: ensureInsideOutputRoot(path.resolve(item.path)),
  }));
  const validationArtifact = safeArtifactPaths.find((item) => item.kind === "validation");
  const validation = validationArtifact
    ? ((JSON.parse(await fs.readFile(validationArtifact.path, "utf8")) as ValidationReport) ?? undefined)
    : undefined;
  const artifacts = await Promise.all(
    safeArtifactPaths.map((item) => fileToArtifact(item.kind, item.label, item.path)),
  );
  artifacts.push(await fileToArtifact("manifest", "Run manifest", safeManifestPath));

  return {
    id: manifest.revisionId,
    prompt,
    createdAt: manifest.createdAt,
    engineeringSpec: manifest.engineeringSpec,
    parameterManifest: manifest.parameterManifest,
    artifacts,
    validation,
  };
}

export function findArtifact(artifacts: CADArtifact[], kind: CADArtifactKind) {
  return artifacts.find((artifact) => artifact.kind === kind);
}

export function ensureInsideOutputRoot(absolutePath: string) {
  const relative = path.relative(CAD_OUTPUT_ROOT, absolutePath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return absolutePath;
  }
  throw new Error("Artifact path escapes output root.");
}
