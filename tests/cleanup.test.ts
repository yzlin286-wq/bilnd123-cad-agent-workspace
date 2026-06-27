import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function loadCleanupModule() {
  const moduleUrl = pathToFileURL(path.resolve("scripts", "cleanup-cad-outputs.mjs")).href;
  return (await import(moduleUrl)) as {
    cleanupCADOutputs: (options: {
      root: string;
      retentionHours?: number;
      maxBytes?: number;
      dryRun?: boolean;
    }) => Promise<{ deletedCount: number; deleted: string[] }>;
    isInsideRoot: (root: string, candidate: string) => boolean;
  };
}

test("cleanup safety check rejects paths outside the CAD output root", async () => {
  const { isInsideRoot } = await loadCleanupModule();
  const root = path.join(os.tmpdir(), "cad-cleanup-root");

  assert.equal(isInsideRoot(root, path.join(root, "run-001")), true);
  assert.equal(isInsideRoot(root, path.resolve(root, "..", "outside")), false);
});

test("cleanup removes expired run directories without following symlinks", async () => {
  const { cleanupCADOutputs } = await loadCleanupModule();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cad-cleanup-"));
  const cadRoot = path.join(tempRoot, "outputs", "cad");
  const oldRun = path.join(cadRoot, "old-run");
  const newRun = path.join(cadRoot, "new-run");
  const outside = path.join(tempRoot, "outside.txt");

  await fs.mkdir(oldRun, { recursive: true });
  await fs.mkdir(newRun, { recursive: true });
  await fs.writeFile(path.join(oldRun, "model.step"), "old", "utf8");
  await fs.writeFile(path.join(newRun, "model.step"), "new", "utf8");
  await fs.writeFile(outside, "keep", "utf8");

  try {
    await fs.symlink(outside, path.join(oldRun, "outside-link"));
  } catch {
    // Symlink creation may require extra permissions on Windows; the deletion
    // behavior is still covered by the root-path guard above.
  }

  const oldTime = new Date(Date.now() - 5 * 60 * 60 * 1000);
  await fs.utimes(oldRun, oldTime, oldTime);

  const result = await cleanupCADOutputs({ root: cadRoot, retentionHours: 1, dryRun: false });

  assert.equal(result.deletedCount, 1);
  assert.deepEqual(result.deleted, ["old-run"]);
  await assert.rejects(() => fs.stat(oldRun));
  assert.equal(await fs.readFile(path.join(newRun, "model.step"), "utf8"), "new");
  assert.equal(await fs.readFile(outside, "utf8"), "keep");
  await fs.rm(tempRoot, { recursive: true, force: true });
});
