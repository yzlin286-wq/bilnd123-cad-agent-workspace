import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function loadSummaryModule() {
  const moduleUrl = pathToFileURL(path.resolve("scripts", "summarize-runs.mjs")).href;
  return (await import(moduleUrl)) as {
    summarizeRuns: (runs: Record<string, unknown>[]) => Record<string, unknown>;
  };
}

async function loadExportModule() {
  const moduleUrl = pathToFileURL(path.resolve("scripts", "export-failures.mjs")).href;
  return (await import(moduleUrl)) as {
    exportFailures: (options: {
      logPath: string;
      outputPath: string;
      maxPromptChars?: number;
    }) => Promise<{ count: number; failures: Array<Record<string, unknown>> }>;
    sanitizePrompt: (prompt: string, maxPromptChars?: number) => string | undefined;
  };
}

test("summarizeRuns reports counts, duration, routes, part types, and failures", async () => {
  const { summarizeRuns } = await loadSummaryModule();

  const summary = summarizeRuns([
    {
      route: "/api/agent/run",
      status: "success",
      durationMs: 100,
      validationPassed: true,
      partType: "mounting_plate",
    },
    {
      route: "/api/agent/revise",
      status: "success",
      durationMs: 300,
      validationPassed: false,
      partType: "mounting_plate",
    },
    {
      route: "/api/cad/rebuild",
      status: "failure",
      durationMs: 200,
      errorCode: "CAD_REBUILD_FAILED",
      partType: "l_bracket",
    },
  ]);

  assert.equal(summary.totalRuns, 3);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.failureCount, 1);
  assert.equal(summary.validationPassRate, 0.5);
  assert.equal(summary.averageDurationMs, 200);
  assert.equal(summary.p95DurationMs, 300);
  assert.deepEqual(summary.failuresByErrorCode, { CAD_REBUILD_FAILED: 1 });
  assert.deepEqual(summary.runsByRoute, {
    "/api/agent/run": 1,
    "/api/agent/revise": 1,
    "/api/cad/rebuild": 1,
  });
  assert.deepEqual(summary.runsByPartType, { mounting_plate: 2, l_bracket: 1 });
});

test("exportFailures writes sanitized failure corpus without full prompts", async () => {
  const { exportFailures, sanitizePrompt } = await loadExportModule();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "run-history-"));
  const logPath = path.join(tempRoot, "runs.jsonl");
  const outputPath = path.join(tempRoot, "failures.json");

  await fs.writeFile(
    logPath,
    [
      JSON.stringify({
        timestamp: "2026-06-27T00:00:00.000Z",
        route: "/api/agent/run",
        status: "failure",
        durationMs: 123,
        errorCode: "AGENT_RUN_FAILED",
        partType: "mounting_plate",
        prompt: "make plate api_key=secret-value with a very long trailing prompt",
      }),
      JSON.stringify({
        timestamp: "2026-06-27T00:00:01.000Z",
        route: "/api/agent/run",
        status: "success",
        durationMs: 456,
        prompt: "do not export",
      }),
    ].join("\n"),
    "utf8",
  );

  const payload = await exportFailures({ logPath, outputPath, maxPromptChars: 36 });
  const written = JSON.parse(await fs.readFile(outputPath, "utf8")) as typeof payload;

  assert.equal(payload.count, 1);
  assert.equal(written.failures.length, 1);
  assert.equal(written.failures[0].route, "/api/agent/run");
  assert.equal(written.failures[0].errorCode, "AGENT_RUN_FAILED");
  assert.match(String(written.failures[0].prompt), /\[redacted\]/);
  assert.equal(String(written.failures[0].prompt).includes("very long trailing prompt"), false);
  assert.equal(sanitizePrompt("Bearer abc.def", 80), "Bearer [redacted]");

  await fs.rm(tempRoot, { recursive: true, force: true });
});
