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

async function loadClassifyModule() {
  const moduleUrl = pathToFileURL(path.resolve("scripts", "classify-runs.mjs")).href;
  return (await import(moduleUrl)) as {
    classifyRuns: (runs: Record<string, unknown>[]) => Record<string, unknown>;
  };
}

async function loadReportModule() {
  const moduleUrl = pathToFileURL(path.resolve("scripts", "staging-report.mjs")).href;
  return (await import(moduleUrl)) as {
    generateStagingReport: (options: {
      logPath: string;
      smokePath: string;
      protocolPath?: string;
      outputPath: string;
      since?: string;
    }) => Promise<{ outputPath: string; smokePresent: boolean }>;
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

test("classifyRuns separates expected and unexpected failures", async () => {
  const { classifyRuns } = await loadClassifyModule();

  const classification = classifyRuns([
    { status: "failure", statusCode: 401, route: "/api/health" },
    { status: "failure", errorCode: "RATE_LIMITED", route: "/api/agent/run" },
    { status: "failure", errorCode: "UNSUPPORTED_PART_TYPE", route: "/api/agent/run" },
    { status: "failure", errorCode: "PARAMETER_CONFLICT", route: "/api/cad/rebuild" },
    { status: "failure", errorCode: "LLM_JSON_ERROR", route: "/api/agent/run", prompt: "bad json" },
    { status: "success", validationPassed: false, route: "/api/cad/rebuild", revisionId: "rev-bad" },
  ]);

  assert.equal(classification.expectedFailureCount, 4);
  assert.equal(classification.unexpectedFailureCount, 2);
  assert.deepEqual(classification.expectedByReason, {
    AUTH_REQUIRED: 1,
    RATE_LIMITED: 1,
    UNSUPPORTED_PART_TYPE: 1,
    PARAMETER_CONFLICT: 1,
  });
  assert.deepEqual(classification.unexpectedByReason, {
    LLM_JSON_ERROR: 1,
    VALIDATION_FAILED: 1,
  });
  assert.equal(Array.isArray(classification.recentUnexpectedFailures), true);
});

test("staging report writes sanitized markdown without prompts", async () => {
  const { generateStagingReport } = await loadReportModule();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "staging-report-"));
  const logPath = path.join(tempRoot, "runs.jsonl");
  const smokePath = path.join(tempRoot, "latest.json");
  const protocolPath = path.join(tempRoot, "protocol.json");
  const outputPath = path.join(tempRoot, "staging-report.md");

  await fs.writeFile(
    logPath,
    [
      JSON.stringify({
        timestamp: "2026-06-27T00:00:00.000Z",
        route: "/api/agent/run",
        status: "failure",
        errorCode: "LLM_JSON_ERROR",
        durationMs: 123,
        prompt: "do not include this full prompt",
      }),
      JSON.stringify({
        timestamp: "2026-06-27T00:00:01.000Z",
        route: "/api/agent/run",
        status: "success",
        durationMs: 456,
        validationPassed: true,
        partType: "mounting_plate",
      }),
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    smokePath,
    JSON.stringify({
      ok: true,
      startedAt: "2026-06-27T00:00:01.000Z",
      durationMs: 999,
      health: { httpsConfigured: false, warning: "Staging is running without HTTPS domain; restrict access." },
      rev001: { id: "rev001", validationPassed: true },
      rev002: { id: "rev002", validationPassed: true },
      artifactDownloads: [{ kind: "package" }],
    }),
    "utf8",
  );
  await fs.writeFile(
    protocolPath,
    JSON.stringify({
      executed: true,
      startedAt: "2026-06-27T00:00:02.000Z",
      generatedAt: "2026-06-27T00:00:03.000Z",
      protocol: [{ id: 1 }],
      results: [{ id: 1, category: "mounting_plate success", ok: true, expectedResult: "validation passes", status: "success" }],
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        expectedFailureCasesPassed: 0,
        expectedFailures: 0,
        unexpectedFailures: 0,
      },
    }),
    "utf8",
  );

  const result = await generateStagingReport({ logPath, smokePath, protocolPath, outputPath, since: "2026-06-27T00:00:00.000Z" });
  const markdown = await fs.readFile(result.outputPath, "utf8");

  assert.equal(result.smokePresent, true);
  assert.match(markdown, /Staging Observation Report/);
  assert.match(markdown, /Unexpected failures: 1/);
  assert.match(markdown, /Rev002: rev002/);
  assert.match(markdown, /Protocol total: 1/);
  assert.match(markdown, /Protocol passed: 1/);
  assert.match(markdown, /New unexpected failures: 1/);
  assert.equal(markdown.includes("do not include this full prompt"), false);

  await fs.rm(tempRoot, { recursive: true, force: true });
});
