import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import boundaryCases from "./fixtures/protocol-boundary-cases.json";

async function loadProtocolModule() {
  const moduleUrl = pathToFileURL(path.resolve("scripts", "run-staging-protocol.mjs")).href;
  return (await import(moduleUrl)) as {
    loadProtocol: () => Promise<Array<{ id: number; category: string; prompt: string }>>;
    sanitizeProtocolText: (value: string, maxChars?: number) => string;
  };
}

async function loadClassifyModule() {
  const moduleUrl = pathToFileURL(path.resolve("scripts", "classify-runs.mjs")).href;
  return (await import(moduleUrl)) as {
    classifyFailure: (run: Record<string, unknown>) => { classification: string; reason: string };
  };
}

test("protocol boundary fixtures map to documented protocol cases", async () => {
  const { loadProtocol } = await loadProtocolModule();
  const protocol = await loadProtocol();
  const ids = new Set(protocol.map((item) => item.id));

  assert.equal(protocol.length, 20);
  for (const item of boundaryCases) {
    assert.equal(ids.has(item.id), true, `missing protocol case ${item.id}`);
  }
});

test("protocol boundary fixtures classify any expected failures", async () => {
  const { classifyFailure } = await loadClassifyModule();

  for (const item of boundaryCases.filter((caseItem) => caseItem.expectedFailureClass === "expected_failure")) {
    if (!("expectedErrorCode" in item)) continue;
    const result = classifyFailure({
      status: "failure",
      errorCode: item.expectedErrorCode,
      prompt: item.prompt,
    });
    assert.equal(result.classification, item.expectedFailureClass);
    assert.equal(result.reason, item.expectedErrorCode);
  }
});

test("protocol fixture sanitizer strips secrets and truncates prompts", async () => {
  const { sanitizeProtocolText } = await loadProtocolModule();

  const sanitized = sanitizeProtocolText(
    `${boundaryCases[0].prompt} Basic abc123 api_key=secret-value password=hunter2`,
    90,
  );

  assert.equal(sanitized.includes("abc123"), false);
  assert.equal(sanitized.includes("secret-value"), false);
  assert.equal(sanitized.includes("hunter2"), false);
  assert.equal(sanitized.length <= 93, true);
});
