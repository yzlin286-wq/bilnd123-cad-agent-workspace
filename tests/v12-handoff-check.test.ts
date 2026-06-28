import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("handoff:check fails the current HTTP Basic Auth fallback posture without leaking credentials", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/api/health") {
      if (!request.headers.authorization) {
        response.statusCode = 401;
        response.end("Authentication required");
        return;
      }
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
          auth: {
            clerkConfigured: false,
            basicAuthConfigured: true,
            devBypassEnabled: false,
            adminAllowlistConfigured: false,
          },
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
    const baseUrl = `http://127.0.0.1:${port}`;
    const result = await runNode(
      process.execPath,
      ["scripts/v12-handoff-check.mjs", "--base-url", baseUrl, "--output", outputPath],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          STAGING_BASIC_AUTH_USER: "cad-admin",
          STAGING_BASIC_AUTH_PASSWORD: "do-not-print-this",
        },
      },
    );

    assert.equal(result.code, 1);
    assert.equal(result.stdout.includes("do-not-print-this"), false);

    const report = JSON.parse(readFileSync(outputPath, "utf8"));
    const failedIds = report.checks.filter((check: { ok: boolean }) => !check.ok).map((check: { id: string }) => check.id);
    assert.equal(report.ok, false);
    assert.equal(report.baseUrl, `http://127.0.0.1:${port}`);
    assert.match(failedIds.join(","), /base_url_https/);
    assert.match(failedIds.join(","), /base_url_uses_domain/);
    assert.match(failedIds.join(","), /expected_ip_declared/);
    assert.match(failedIds.join(","), /domain_resolves_expected_ip/);
    assert.match(failedIds.join(","), /http_redirects_to_https/);
    assert.match(failedIds.join(","), /health_https_configured/);
    assert.match(failedIds.join(","), /health_access_mode_https/);
    assert.match(failedIds.join(","), /health_clerk_configured/);
    assert.match(failedIds.join(","), /clerk_sign_in_rendered/);
    assert.match(failedIds.join(","), /app_requires_clerk_session/);
    assert.match(failedIds.join(","), /admin_requires_clerk_session/);
    assert.match(failedIds.join(","), /admin_email_declared/);
    assert.match(failedIds.join(","), /admin_password_delivery_declared/);
    assert.match(failedIds.join(","), /clerk_admin_identity_verified/);
    assert.match(failedIds.join(","), /admin_login_verified/);
    assert.match(failedIds.join(","), /admin_project_create_verified/);
    assert.match(failedIds.join(","), /admin_package_download_verified/);
    assert.match(failedIds.join(","), /artifact_cross_owner_forbidden/);
    assert.equal(report.observed.accessMode, "http_restricted");
    assert.equal(report.observed.auth.clerkConfigured, false);
    assert.equal(report.observed.dataLayer.mode, "postgres");

    const missingCredentialPath = path.join(outputDir, "missing-admin-credential.txt");
    const adminVerifyPath = path.join(outputDir, "admin-verify.json");
    writeFileSync(
      adminVerifyPath,
      JSON.stringify({
        ok: true,
        adminEmail: "admin@example.com",
        userId: "user_admin",
        evidence: { adminAuthorized: true },
      }),
      "utf8",
    );
    const missingCredentialResult = await runNode(
      process.execPath,
      [
        "scripts/v12-handoff-check.mjs",
        "--base-url",
        `http://127.0.0.1:${port}`,
        "--expected-ip",
        "127.0.0.1",
        "--ip-fallback-url",
        `http://127.0.0.1:${port}`,
        "--admin-email",
        "admin@example.com",
        "--credential-path",
        missingCredentialPath,
        "--admin-verify-path",
        adminVerifyPath,
        "--output",
        outputPath,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          STAGING_BASIC_AUTH_USER: "cad-admin",
          STAGING_BASIC_AUTH_PASSWORD: "do-not-print-this",
        },
      },
    );
    assert.equal(missingCredentialResult.code, 1);
    const credentialReport = JSON.parse(readFileSync(outputPath, "utf8"));
    const credentialFailedIds = credentialReport.checks
      .filter((check: { ok: boolean }) => !check.ok)
      .map((check: { id: string }) => check.id);
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "ip_fallback_unauth_401")?.ok, true);
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "ip_fallback_health_200")?.ok, true);
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "clerk_admin_identity_verified")?.ok, true);
    assert.match(credentialFailedIds.join(","), /admin_credential_file_exists/);
    assert.match(credentialFailedIds.join(","), /admin_credential_file_private/);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

function runNode(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out: ${command} ${args.join(" ")}`));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}
