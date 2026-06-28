import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("handoff:check fails the current HTTP Basic Auth fallback posture without leaking credentials", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/api/health") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          app: "ok",
          cadRunnerConfigured: true,
          llmConfigured: true,
          outputDirWritable: true,
          httpsConfigured: false,
          accessMode: "http_restricted",
          warning: "Staging is running without HTTPS domain; restrict access.",
          dataLayer: { mode: "postgres", productionReady: true },
        }),
      );
      return;
    }
    if (request.url === "/sign-in") {
      response.end("<h1>Clerk is not configured</h1>");
      return;
    }
    if (request.url === "/app" || request.url === "/admin") {
      response.end("<main>Basic Auth fallback page</main>");
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  const port = (address as AddressInfo).port;
  const outputDir = mkdtempSync(path.join(tmpdir(), "v12-handoff-"));
  const outputPath = path.join(outputDir, "handoff.json");

  try {
    const baseUrl = `http://operator:super-secret@127.0.0.1:${port}`;
    const result = spawnSync(
      process.execPath,
      ["scripts/v12-handoff-check.mjs", "--base-url", baseUrl, "--output", outputPath],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          STAGING_BASIC_AUTH_USER: "cad-admin",
          STAGING_BASIC_AUTH_PASSWORD: "do-not-print-this",
        },
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout.includes("super-secret"), false);
    assert.equal(result.stdout.includes("do-not-print-this"), false);

    const report = JSON.parse(readFileSync(outputPath, "utf8"));
    const failedIds = report.checks.filter((check: { ok: boolean }) => !check.ok).map((check: { id: string }) => check.id);
    assert.equal(report.ok, false);
    assert.equal(report.baseUrl, `http://127.0.0.1:${port}`);
    assert.match(failedIds.join(","), /base_url_https/);
    assert.match(failedIds.join(","), /health_https_configured/);
    assert.match(failedIds.join(","), /health_access_mode_https/);
    assert.match(failedIds.join(","), /clerk_sign_in_rendered/);
    assert.match(failedIds.join(","), /app_requires_clerk_session/);
    assert.match(failedIds.join(","), /admin_requires_clerk_session/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(outputDir, { recursive: true, force: true });
  }
});
