import assert from "node:assert/strict";
import test from "node:test";
import { errorGuidanceForCode } from "../lib/agent/error-guidance";

test("unsupported part type guidance names supported templates and examples", () => {
  const guidance = errorGuidanceForCode("UNSUPPORTED_PART_TYPE");

  assert.match(guidance.message, /mounting_plate/);
  assert.match(guidance.message, /l_bracket/);
  assert.equal(guidance.suggestions.length >= 2, true);
});

test("parameter conflict guidance suggests dimension changes", () => {
  const guidance = errorGuidanceForCode("PARAMETER_CONFLICT");

  assert.match(guidance.suggestions.join(" "), /edgeOffset/);
  assert.match(guidance.suggestions.join(" "), /hole diameter/);
});

test("internal failures do not expose provider details", () => {
  const guidance = errorGuidanceForCode("CAD_RUNNER_CRASH", "Traceback /app/provider raw error");

  assert.equal(guidance.message.includes("/app"), false);
  assert.match(guidance.message, /contact the staging administrator/);
});
