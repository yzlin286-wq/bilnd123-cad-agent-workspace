import assert from "node:assert/strict";
import test from "node:test";
import { evaluateV12AccessPreflight, renderV12AccessPreflight } from "../scripts/v12-access-preflight.mjs";

test("v1.2 access preflight rejects current HTTP Basic Auth fallback posture", () => {
  const report = evaluateV12AccessPreflight({
    handoff: {
      ok: false,
      observed: {
        ipAddress: "43.138.153.37",
        ipFallbackUrl: "http://43.138.153.37:12602",
        accessMode: "http_restricted",
        httpsConfigured: false,
        warning: "Staging is running without HTTPS domain; restrict access.",
        health: { app: "ok", cadRunnerConfigured: true, llmConfigured: true, outputDirWritable: true },
        auth: { clerkConfigured: false, basicAuthConfigured: true, devBypassEnabled: false },
        dataLayer: { mode: "postgres", productionReady: true, connected: true, schemaReady: true },
        admin: { email: "admin@example.com", passwordDelivery: "server_file", credentialPath: "/opt/app/admin-credential.txt" },
        verification: { adminPageVerified: false, evidenceVerified: false },
      },
      summary: { total: 37, passed: 18, failed: 19 },
      checks: [{ id: "base_url_https", ok: false }],
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.access.accessMode, "http_restricted");
  assert.equal(report.access.https, "not enabled");
  assert.equal(report.dataLayer.productionReady, true);
  assert.match(report.blockers.map((blocker) => blocker.id).join(","), /domain_missing/);
  assert.match(report.blockers.map((blocker) => blocker.id).join(","), /clerk_not_configured/);
  assert.match(report.blockers.map((blocker) => blocker.id).join(","), /admin_flow_evidence_missing/);
  assert.match(report.requiredInputs.map((item) => item.id).join(","), /domain_dns/);
  assert.match(report.requiredInputs.map((item) => item.id).join(","), /https_tls/);
  assert.match(report.requiredInputs.map((item) => item.id).join(","), /clerk_keys/);
  assert.match(report.requiredInputs.map((item) => item.id).join(","), /admin_flow_evidence/);

  const markdown = renderV12AccessPreflight(report);
  assert.match(markdown, /Status: not ready/);
  assert.match(markdown, /Domain: not configured/);
  assert.match(markdown, /Data layer: postgres/);
  assert.match(markdown, /Required External Inputs/);
  assert.match(markdown, /domain_dns: Staging domain and DNS/);
  assert.match(markdown, /clerk_keys: Real Clerk keys/);
  assert.equal(markdown.includes("缂"), false);
});

test("v1.2 access preflight renders ready access and admin handoff without secrets", () => {
  const report = evaluateV12AccessPreflight({
    handoff: {
      ok: true,
      observed: {
        domainUrl: "https://cad-agent.example.com",
        ipAddress: "203.0.113.10",
        ipFallbackUrl: "http://203.0.113.10:12602",
        accessMode: "https",
        httpsConfigured: true,
        health: { app: "ok", cadRunnerConfigured: true, llmConfigured: true, outputDirWritable: true },
        auth: { clerkConfigured: true, basicAuthConfigured: true, devBypassEnabled: false },
        dataLayer: { mode: "postgres", productionReady: true, connected: true, schemaReady: true },
        admin: {
          email: "admin@example.com",
          passwordDelivery: "server_file",
          credentialPath: "/opt/app/admin-credential.txt",
          clerkIdentityVerified: true,
          clerkAdminAuthorized: true,
          flowEvidencePath: "outputs/reports/v12-admin-flow-evidence.json",
        },
        verification: { adminPageVerified: true, evidenceVerified: true },
      },
      summary: { total: 37, passed: 37, failed: 0 },
      checks: [{ id: "health_clerk_configured", ok: true }],
    },
    env: {
      CLERK_SECRET_KEY: "sk-test-should-not-leak",
      STAGING_BASIC_AUTH_PASSWORD: "basic-should-not-leak",
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.blockers.length, 0);
  assert.equal(report.requiredInputs.length, 0);

  const markdown = renderV12AccessPreflight(report);
  assert.match(markdown, /Status: ready/);
  assert.match(markdown, /Domain: https:\/\/cad-agent\.example\.com/);
  assert.match(markdown, /Admin password: server-only file/);
  assert.equal(markdown.includes("sk-test-should-not-leak"), false);
  assert.equal(markdown.includes("basic-should-not-leak"), false);
});
