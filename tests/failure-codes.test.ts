import assert from "node:assert/strict";
import test from "node:test";
import { operationalErrorCode, userMessageForErrorCode } from "../lib/server/failure-codes";

test("operationalErrorCode classifies expected and unexpected staging failures", () => {
  assert.equal(
    operationalErrorCode(new Error("Unsupported partType 'gear'. Supported partType values: mounting_plate, l_bracket"), "AGENT_RUN_FAILED"),
    "UNSUPPORTED_PART_TYPE",
  );
  assert.equal(operationalErrorCode(new Error("edgeOffset leaves no usable area for the hole pattern"), "CAD_REBUILD_FAILED"), "PARAMETER_CONFLICT");
  assert.equal(operationalErrorCode(new Error("Model did not return valid JSON."), "AGENT_RUN_FAILED"), "LLM_JSON_ERROR");
  assert.equal(
    operationalErrorCode(new Error("build123d is not installed or cannot load Open Cascade."), "AGENT_RUN_FAILED"),
    "CAD_RUNNER_CRASH",
  );
  assert.equal(operationalErrorCode(new Error("something else"), "AGENT_RUN_FAILED"), "AGENT_RUN_FAILED");
});

test("userMessageForErrorCode returns safe user-facing messages", () => {
  assert.match(userMessageForErrorCode("UNSUPPORTED_PART_TYPE"), /supported staging templates/);
  assert.match(userMessageForErrorCode("PARAMETER_CONFLICT"), /dimensions conflict/);
  assert.match(userMessageForErrorCode("LLM_JSON_ERROR"), /could not validate/);
  assert.match(userMessageForErrorCode("CAD_RUNNER_CRASH"), /CAD kernel could not complete/);
  assert.match(userMessageForErrorCode("VALIDATION_FAILED"), /failed geometry validation/);
  assert.match(userMessageForErrorCode("RATE_LIMITED"), /wait a minute/);
  assert.equal(userMessageForErrorCode("AGENT_RUN_FAILED", "Safe fallback."), "Safe fallback.");
});
