#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_RETENTION_HOURS = 72;

export function isInsideRoot(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function cleanupCADOutputs({
  root = path.resolve(process.cwd(), "outputs", "cad"),
  retentionHours = positiveNumber(process.env.CAD_OUTPUT_RETENTION_HOURS, DEFAULT_RETENTION_HOURS),
  maxBytes = optionalPositiveNumber(process.env.CAD_OUTPUT_MAX_BYTES),
  dryRun = process.argv.includes("--dry-run"),
} = {}) {
  const resolvedRoot = path.resolve(root);
  await fs.mkdir(resolvedRoot, { recursive: true });
  const entries = await fs.readdir(resolvedRoot, { withFileTypes: true });
  const now = Date.now();
  const runDirs = [];

  for (const entry of entries) {
    const fullPath = path.join(resolvedRoot, entry.name);
    if (!isInsideRoot(resolvedRoot, fullPath) || !entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const stats = await fs.lstat(fullPath);
    const size = await directorySize(fullPath, resolvedRoot);
    runDirs.push({ path: fullPath, mtimeMs: stats.mtimeMs, size });
  }

  const expiredBefore = now - retentionHours * 60 * 60 * 1000;
  const toDelete = new Map();
  for (const dir of runDirs) {
    if (dir.mtimeMs < expiredBefore) {
      toDelete.set(dir.path, dir);
    }
  }

  if (maxBytes) {
    let keptBytes = runDirs.reduce((sum, dir) => sum + dir.size, 0);
    for (const dir of [...runDirs].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (keptBytes <= maxBytes) break;
      toDelete.set(dir.path, dir);
      keptBytes -= dir.size;
    }
  }

  for (const dir of toDelete.values()) {
    await removeRunDir(resolvedRoot, dir.path, dryRun);
  }

  const deleted = [...toDelete.values()];
  return {
    root: resolvedRoot,
    dryRun,
    deletedCount: deleted.length,
    deletedBytes: deleted.reduce((sum, dir) => sum + dir.size, 0),
    deleted: deleted.map((dir) => path.basename(dir.path)),
  };
}

async function removeRunDir(root, dirPath, dryRun) {
  const stats = await fs.lstat(dirPath);
  if (!isInsideRoot(root, dirPath) || path.resolve(root) === path.resolve(dirPath) || !stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Refusing to delete unsafe CAD output path: ${dirPath}`);
  }
  if (!dryRun) {
    await fs.rm(dirPath, { recursive: true, force: true });
  }
}

async function directorySize(dirPath, root) {
  const stats = await fs.lstat(dirPath);
  if (stats.isSymbolicLink()) return 0;
  if (!stats.isDirectory()) return stats.size;
  let total = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(dirPath, entry.name);
    if (!isInsideRoot(root, child) || entry.isSymbolicLink()) continue;
    total += await directorySize(child, root);
  }
  return total;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalPositiveNumber(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("cleanup-cad-outputs.mjs")) {
  cleanupCADOutputs()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
