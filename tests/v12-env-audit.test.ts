import assert from "node:assert/strict";
import test from "node:test";
import { evaluateV12EnvAudit, parseEnvText, renderV12EnvAudit } from "../scripts/v12-env-audit.mjs";

test("v1.2 env audit rejects HTTP staging and missing Clerk handoff values", () => {
  const env = parseEnvText(`
STAGING_ACCESS_MODE=http_restricted
STAGING_HTTPS_ENABLED=0
STAGING_BASIC_AUTH_USER=cad-admin
STAGING_BASIC_AUTH_PASSWORD=secret-value
DATABASE_URL=postgres://cad_agent:secret@postgres:5432/cad_agent
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_CREDENTIAL_PATH=/opt/app/admin-credential.txt
`);

  const report = evaluateV12EnvAudit({
    env,
    envFileInfo: { exists: true, privatePermissions: true, mode: "0600" },
    credentialFileInfo: { exists: true, privatePermissions: true, mode: "0600" },
  });

  assert.equal(report.ok, false);
  const failed = report.checks.filter((check) => !check.ok).map((check) => check.id).join(",");
  assert.match(failed, /staging_domain_present/);
  assert.match(failed, /staging_access_mode_https/);
  assert.match(failed, /staging_https_enabled/);
  assert.match(failed, /clerk_secret_configured/);
  assert.match(failed, /app_commit_sha_configured/);

  const markdown = renderV12EnvAudit(report);
  assert.match(markdown, /Status: not ready/);
  assert.match(markdown, /APP_COMMIT_SHA: no/);
  assert.equal(markdown.includes("secret-value"), false);
});

test("v1.2 env audit accepts complete handoff env without leaking secrets", () => {
  const env = parseEnvText(`
STAGING_DOMAIN=cad-agent.example.com
STAGING_HTTPS_ENABLED=1
STAGING_ACCESS_MODE=https
CLERK_SECRET_KEY=sk_test_should_not_leak_123456
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_should_not_leak_123456
DATABASE_URL=postgres://cad_agent:db-password@postgres:5432/cad_agent
STAGING_BASIC_AUTH_USER=cad-admin
STAGING_BASIC_AUTH_PASSWORD=basic-password
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_CREDENTIAL_PATH=/opt/app/admin-credential.txt
SAAS_DEV_AUTH_BYPASS=0
APP_COMMIT_SHA=4d7d7c3
`);

  const report = evaluateV12EnvAudit({
    env,
    envFileInfo: { exists: true, privatePermissions: true, mode: "0600" },
    credentialFileInfo: { exists: true, privatePermissions: true, mode: "0600" },
  });

  assert.equal(report.ok, true);
  assert.equal(report.configured.clerkSecret, true);
  assert.equal(report.configured.databaseUrl, true);
  assert.equal(report.configured.appCommitSha, true);

  const markdown = renderV12EnvAudit(report);
  assert.match(markdown, /Status: ready/);
  assert.match(markdown, /Clerk secret: yes/);
  assert.match(markdown, /APP_COMMIT_SHA: yes/);
  assert.equal(markdown.includes("4d7d7c3"), false);
  assert.equal(markdown.includes("should_not_leak"), false);
  assert.equal(markdown.includes("db-password"), false);
  assert.equal(markdown.includes("basic-password"), false);
});
