import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("failed agent runs can record model and unsupported partType without a revision", async () => {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runs-history-"));
  try {
    process.chdir(tempDir);
    const moduleUrl = `${pathToFileURL(path.join(originalCwd, "lib", "server", "run-history.ts")).href}?case=${Date.now()}`;
    const { appendRunHistory } = await import(moduleUrl);

    await appendRunHistory({
      route: "/api/agent/run",
      runId: "run_unsupported_observable",
      prompt: "make a helical spring",
      model: "glm-5.1",
      partType: "helical_spring",
      status: "failure",
      durationMs: 1234.4,
      errorCode: "UNSUPPORTED_PART_TYPE",
    });

    const text = await fs.readFile(path.join(tempDir, "logs", "runs.jsonl"), "utf8");
    const record = JSON.parse(text.trim());
    assert.equal(record.model, "glm-5.1");
    assert.equal(record.partType, "helical_spring");
    assert.equal(record.errorCode, "UNSUPPORTED_PART_TYPE");
    assert.equal(record.status, "failure");
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
