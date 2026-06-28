import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAdminFlowEvidence } from "../scripts/v12-admin-flow-evidence.mjs";

const completeEvidence = {
  generatedAt: "2026-06-28T12:00:00.000Z",
  baseUrl: "https://cad-agent.example.com",
  adminEmail: "Admin@Example.com",
  checks: [
    { id: "admin_login", ok: true, status: 200 },
    { id: "admin_page_access", ok: true, status: 200 },
    { id: "non_admin_admin_blocked", ok: true, status: 302, location: "/app" },
    { id: "admin_project_create", ok: true, status: 201, projectId: "project_123" },
    { id: "admin_package_download", ok: true, status: 200, artifactName: "package.zip", bytes: 2048 },
    { id: "artifact_cross_owner_forbidden", ok: true, status: 403 },
  ],
};

test("admin flow evidence verifies real handoff flags without prompts or secrets", () => {
  const result = evaluateAdminFlowEvidence(completeEvidence, {
    expectedBaseUrl: "https://cad-agent.example.com",
    expectedAdminEmail: "admin@example.com",
  });

  assert.equal(result.ok, true);
  assert.equal(result.adminEmail, "admin@example.com");
  assert.equal(result.flags.adminLoginVerified, true);
  assert.equal(result.flags.adminPageVerified, true);
  assert.equal(result.flags.nonAdminBlockedVerified, true);
  assert.equal(result.flags.adminProjectCreateVerified, true);
  assert.equal(result.flags.adminPackageDownloadVerified, true);
  assert.equal(result.flags.artifactAuthzVerified, true);
  assert.equal(JSON.stringify(result).includes("should-not-be-here"), false);
});

test("admin flow evidence rejects secret-like fields and redacts output", () => {
  const result = evaluateAdminFlowEvidence({
    ...completeEvidence,
    password: "should-not-be-here",
    checks: [...completeEvidence.checks, { id: "debug", ok: true, header: "Basic abc123456789" }],
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue: { id: string }) => issue.id).join(","), /secret_like_value_detected/);
  assert.equal(JSON.stringify(result).includes("should-not-be-here"), false);
  assert.equal(JSON.stringify(result).includes("Basic abc123456789"), false);
});
