import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function loadProtocolModule() {
  const moduleUrl = pathToFileURL(path.resolve("scripts", "run-staging-protocol.mjs")).href;
  return (await import(moduleUrl)) as {
    loadProtocol: (options?: { protocolPath?: string }) => Promise<Array<{ id: number; category: string; prompt: string }>>;
    sanitizeProtocolText: (value: string, maxChars?: number) => string;
    summarizeProtocolResults: (
      protocol: Array<Record<string, unknown>>,
      results: Array<{ ok: boolean; failureClass?: string }>,
      executed?: boolean,
    ) => { total: number; passed: number; failed: number; expectedFailureCasesPassed: number; unexpectedFailures: number };
    runStagingProtocol: (options: {
      protocolPath?: string;
      outputPath: string;
      execute?: boolean;
    }) => Promise<{ executed: boolean; count: number }>;
  };
}

test("staging protocol dry-run parses the 20 prompt checklist and writes output", async () => {
  const { loadProtocol, runStagingProtocol } = await loadProtocolModule();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "staging-protocol-"));
  const outputPath = path.join(tempRoot, "latest.json");

  const protocol = await loadProtocol();
  const result = await runStagingProtocol({ outputPath });
  const written = JSON.parse(await fs.readFile(outputPath, "utf8")) as {
    executed: boolean;
    count: number;
    protocol: Array<{ id: number; category: string; prompt: string }>;
  };

  assert.equal(protocol.length, 20);
  assert.equal(result.executed, false);
  assert.equal(result.count, 20);
  assert.equal(written.executed, false);
  assert.equal(written.protocol.length, 20);
  assert.equal(written.protocol[0].id, 1);
  assert.equal(written.protocol[17].category, "helical_spring success");

  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("protocol sanitizer redacts auth and model secrets", async () => {
  const { sanitizeProtocolText } = await loadProtocolModule();

  const sanitized = sanitizeProtocolText("sk-testsecret Bearer token.value Basic abc123 password=hunter2 api_key=secret");

  assert.equal(sanitized.includes("sk-testsecret"), false);
  assert.equal(sanitized.includes("token.value"), false);
  assert.equal(sanitized.includes("abc123"), false);
  assert.equal(sanitized.includes("hunter2"), false);
  assert.equal(sanitized.includes("secret"), false);
});

test("protocol summary counts passed expected-failure cases separately from failed cases", async () => {
  const { summarizeProtocolResults } = await loadProtocolModule();

  const summary = summarizeProtocolResults(
    [{ id: 1 }, { id: 2 }, { id: 3 }],
    [
      { ok: true },
      { ok: true, failureClass: "expected_failure" },
      { ok: false, failureClass: "unexpected_failure" },
    ],
    true,
  );

  assert.equal(summary.total, 3);
  assert.equal(summary.passed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.expectedFailureCasesPassed, 1);
  assert.equal(summary.unexpectedFailures, 1);
});
