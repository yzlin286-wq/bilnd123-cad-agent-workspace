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
          build: { commitSha: "4d7d7c3" },
        }),
      );
      return;
    }
    if (request.url === "/sign-in") {
      response.end("<h1>Clerk is not configured</h1>");
      return;
    }
    if (request.url === "/sign-up") {
      response.end("<h1>Clerk is not configured</h1>");
      return;
    }
    if (request.url === "/app" || request.url === "/admin") {
      response.end("<main>Basic Auth fallback page</main>");
      return;
    }
    if (request.url === "/api/projects") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ projects: [] }));
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
    assert.match(failedIds.join(","), /expected_commit_declared/);
    assert.match(failedIds.join(","), /clerk_sign_in_rendered/);
    assert.match(failedIds.join(","), /clerk_sign_up_rendered/);
    assert.match(failedIds.join(","), /app_requires_clerk_session/);
    assert.match(failedIds.join(","), /admin_requires_clerk_session/);
    assert.match(failedIds.join(","), /projects_api_requires_clerk_session/);
    assert.match(failedIds.join(","), /admin_email_declared/);
    assert.match(failedIds.join(","), /clerk_admin_email_matches/);
    assert.match(failedIds.join(","), /admin_password_delivery_declared/);
    assert.match(failedIds.join(","), /clerk_admin_identity_verified/);
    assert.match(failedIds.join(","), /admin_flow_evidence_verified/);
    assert.match(failedIds.join(","), /admin_login_verified/);
    assert.match(failedIds.join(","), /admin_project_create_verified/);
    assert.match(failedIds.join(","), /admin_package_download_verified/);
    assert.match(failedIds.join(","), /artifact_cross_owner_forbidden/);
    assert.equal(report.observed.accessMode, "http_restricted");
    assert.equal(report.observed.auth.clerkConfigured, false);
    assert.equal(report.observed.dataLayer.mode, "postgres");

    const missingCredentialPath = path.join(outputDir, "missing-admin-credential.txt");
    const adminVerifyPath = path.join(outputDir, "admin-verify.json");
    const adminFlowEvidencePath = path.join(outputDir, "admin-flow-evidence.json");
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
    writeFileSync(
      adminFlowEvidencePath,
      JSON.stringify({
        generatedAt: "2026-06-28T12:00:00.000Z",
        baseUrl: `http://127.0.0.1:${port}`,
        adminEmail: "admin@example.com",
        build: { commitSha: "4d7d7c3" },
        checks: [
          { id: "admin_login", ok: true, status: 200 },
          { id: "admin_page_access", ok: true, status: 200 },
          { id: "non_admin_admin_blocked", ok: true, status: 302, location: "/app" },
          { id: "admin_project_create", ok: true, status: 201, projectId: "project_123" },
          { id: "admin_package_download", ok: true, status: 200, artifactName: "package.zip", projectId: "project_123", bytes: 2048 },
          { id: "artifact_cross_owner_forbidden", ok: true, status: 403, artifactName: "package.zip", targetProjectId: "project_456" },
        ],
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
        "--expected-commit",
        "4d7d7c3",
        "--ip-fallback-url",
        `http://127.0.0.1:${port}`,
        "--admin-email",
        "admin@example.com",
        "--credential-path",
        missingCredentialPath,
        "--admin-verify-path",
        adminVerifyPath,
        "--admin-flow-evidence-path",
        adminFlowEvidencePath,
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
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "expected_commit_declared")?.ok, true);
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "health_commit_reported")?.ok, true);
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "health_commit_matches_expected")?.ok, true);
    assert.equal(credentialReport.observed.build.deployedCommit, "4d7d7c3");
    assert.equal(credentialReport.observed.build.expectedCommit, "4d7d7c3");
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "clerk_admin_email_matches")?.ok, true);
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "clerk_admin_identity_verified")?.ok, true);
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "admin_flow_evidence_verified")?.ok, true);
    assert.equal(credentialReport.observed.verification.evidenceCommit, "4d7d7c3");
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "admin_login_verified")?.ok, true);
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "admin_project_create_verified")?.ok, true);
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "admin_package_download_verified")?.ok, true);
    assert.equal(credentialReport.checks.find((check: { id: string }) => check.id === "artifact_cross_owner_forbidden")?.ok, true);
    assert.match(credentialFailedIds.join(","), /admin_credential_file_exists/);
    assert.match(credentialFailedIds.join(","), /admin_credential_file_private/);

    writeFileSync(
      adminVerifyPath,
      JSON.stringify({
        ok: true,
        adminEmail: "other-admin@example.com",
        userId: "user_other_admin",
        evidence: { adminAuthorized: true },
      }),
      "utf8",
    );
    const mismatchedAdminVerifyResult = await runNode(
      process.execPath,
      [
        "scripts/v12-handoff-check.mjs",
        "--base-url",
        `http://127.0.0.1:${port}`,
        "--expected-ip",
        "127.0.0.1",
        "--expected-commit",
        "4d7d7c3",
        "--ip-fallback-url",
        `http://127.0.0.1:${port}`,
        "--admin-email",
        "admin@example.com",
        "--credential-path",
        missingCredentialPath,
        "--admin-verify-path",
        adminVerifyPath,
        "--admin-flow-evidence-path",
        adminFlowEvidencePath,
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
    assert.equal(mismatchedAdminVerifyResult.code, 1);
    assert.equal(mismatchedAdminVerifyResult.stdout.includes("do-not-print-this"), false);
    const mismatchedReport = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(mismatchedReport.observed.admin.email, "admin@example.com");
    assert.equal(mismatchedReport.observed.admin.verifiedEmail, "other-admin@example.com");
    assert.equal(mismatchedReport.checks.find((check: { id: string }) => check.id === "clerk_admin_email_matches")?.ok, false);
    assert.equal(mismatchedReport.checks.find((check: { id: string }) => check.id === "clerk_admin_identity_verified")?.ok, false);

    const mismatchedCommitResult = await runNode(
      process.execPath,
      [
        "scripts/v12-handoff-check.mjs",
        "--base-url",
        `http://127.0.0.1:${port}`,
        "--expected-ip",
        "127.0.0.1",
        "--expected-commit",
        "aaaaaaaa",
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
    assert.equal(mismatchedCommitResult.code, 1);
    const mismatchedCommitReport = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(mismatchedCommitReport.checks.find((check: { id: string }) => check.id === "health_commit_reported")?.ok, true);
    assert.equal(mismatchedCommitReport.checks.find((check: { id: string }) => check.id === "health_commit_matches_expected")?.ok, false);
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
