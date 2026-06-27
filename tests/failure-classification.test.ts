import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function loadClassifyModule() {
  const moduleUrl = pathToFileURL(path.resolve("scripts", "classify-runs.mjs")).href;
  return (await import(moduleUrl)) as {
    classifyFailure: (run: Record<string, unknown>) => { classification: string; reason: string };
    classifyRuns: (runs: Record<string, unknown>[], options?: { since?: string }) => { totalRuns: number; unexpectedFailureCount: number };
    filterRunsSince: (runs: Record<string, unknown>[], since?: string) => Record<string, unknown>[];
  };
}

test("unsupported partType is an expected failure", async () => {
  const { classifyFailure } = await loadClassifyModule();
  const result = classifyFailure({ status: "failure", errorCode: "UNSUPPORTED_PART_TYPE" });

  assert.equal(result.classification, "expected_failure");
  assert.equal(result.reason, "UNSUPPORTED_PART_TYPE");
});

test("parameter conflict is an expected failure", async () => {
  const { classifyFailure } = await loadClassifyModule();
  const result = classifyFailure({ status: "failure", errorCode: "PARAMETER_CONFLICT" });

  assert.equal(result.classification, "expected_failure");
  assert.equal(result.reason, "PARAMETER_CONFLICT");
});

test("LLM_JSON_ERROR is an unexpected failure", async () => {
  const { classifyFailure } = await loadClassifyModule();
  const result = classifyFailure({ status: "failure", errorCode: "LLM_JSON_ERROR" });

  assert.equal(result.classification, "unexpected_failure");
  assert.equal(result.reason, "LLM_JSON_ERROR");
});

test("CAD_RUNNER_CRASH is an unexpected failure", async () => {
  const { classifyFailure } = await loadClassifyModule();
  const result = classifyFailure({ status: "failure", errorCode: "CAD_RUNNER_CRASH" });

  assert.equal(result.classification, "unexpected_failure");
  assert.equal(result.reason, "CAD_RUNNER_CRASH");
});

test("unknown AGENT_RUN_FAILED is an unexpected failure", async () => {
  const { classifyFailure } = await loadClassifyModule();
  const result = classifyFailure({ status: "failure", errorCode: "AGENT_RUN_FAILED" });

  assert.equal(result.classification, "unexpected_failure");
  assert.equal(result.reason, "AGENT_RUN_FAILED");
});

test("filterRunsSince limits classification to the requested window", async () => {
  const { classifyRuns, filterRunsSince } = await loadClassifyModule();
  const runs = [
    { timestamp: "2026-06-27T00:00:00.000Z", status: "failure", errorCode: "AGENT_RUN_FAILED" },
    { timestamp: "2026-06-28T00:00:00.000Z", status: "failure", errorCode: "LLM_JSON_ERROR" },
    { timestamp: "2026-06-28T00:01:00.000Z", status: "success" },
  ];
  const filtered = filterRunsSince(runs, "2026-06-28T00:00:00.000Z");
  const classification = classifyRuns(filtered, { since: "2026-06-28T00:00:00.000Z" });

  assert.equal(filtered.length, 2);
  assert.equal(classification.totalRuns, 2);
  assert.equal(classification.unexpectedFailureCount, 1);
});
