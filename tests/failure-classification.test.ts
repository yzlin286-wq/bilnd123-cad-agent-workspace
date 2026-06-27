import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function loadClassifyModule() {
  const moduleUrl = pathToFileURL(path.resolve("scripts", "classify-runs.mjs")).href;
  return (await import(moduleUrl)) as {
    classifyFailure: (run: Record<string, unknown>) => { classification: string; reason: string };
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
