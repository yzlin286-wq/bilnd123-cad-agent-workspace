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
  assert.equal(written.protocol[10].category, "revision");

  await fs.rm(tempRoot, { recursive: true, force: true });
});
