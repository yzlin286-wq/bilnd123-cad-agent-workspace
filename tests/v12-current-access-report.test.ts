import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCurrentAccessReport,
  renderCurrentAccessReport,
  resolveCurrentAccessRuntimeOptions,
} from "../scripts/v12-current-access-report.mjs";

test("current access report accepts temporary HTTP Basic Auth access but rejects final handoff", () => {
  const report = evaluateCurrentAccessReport({
    baseUrl: "http://43.138.153.37:12602",
    ip: "43.138.153.37",
    ipFallback: "http://43.138.153.37:12602",
    adminUser: "cad-admin",
    passwordDelivery: "server_file",
    credentialPath: "/opt/bilnd123-cad-agent-workspace/admin-credential.txt",
    healthUnauthStatus: 401,
    healthStatus: 200,
    adminStatus: 307,
    appStatus: 307,
    health: {
      app: "ok",
      cadRunnerConfigured: true,
      llmConfigured: true,
      outputDirWritable: true,
      httpsConfigured: false,
      accessMode: "http_restricted",
      warning: "Staging is running without HTTPS domain; restrict access.",
      supportedTemplates: ["mounting_plate", "l_bracket"],
      auth: { clerkConfigured: false, basicAuthConfigured: true, devBypassEnabled: false },
      dataLayer: { mode: "postgres", productionReady: true, connected: true, schemaReady: true },
      build: { commitSha: "4D7D7C3" },
    },
    handoff: {
      ok: false,
      summary: { passed: 14, total: 32 },
      checks: [{ id: "base_url_https", ok: false }],
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.currentAccess.basicAuthProtected, true);
  assert.equal(report.currentAccess.dataLayer.mode, "postgres");
  assert.equal(report.currentAccess.build.deployedCommit, "4d7d7c3");
  assert.equal(report.currentAccess.temporarySmokeAccessReady, true);
  assert.equal(report.currentAccess.appBlockedWithoutSaasSession, true);
  assert.equal(report.currentAccess.adminBlockedWithoutSaasSession, true);
  assert.equal(report.v12Handoff.ready, false);
  assert.match(report.v12Handoff.blockers.map((blocker) => blocker.id).join(","), /domain_https_missing/);
  assert.match(report.v12Handoff.blockers.map((blocker) => blocker.id).join(","), /clerk_not_configured/);

  const markdown = renderCurrentAccessReport(report);
  assert.match(markdown, /Temporary smoke\/API access: ready/);
  assert.match(markdown, /Interactive SaaS access: requires real Clerk login and HTTPS handoff/);
  assert.match(markdown, /Final v1\.2 handoff: not ready/);
  assert.match(markdown, /Build commit: 4d7d7c3/);
  assert.match(markdown, /\/app blocked without SaaS session: yes/);
  assert.match(markdown, /\/admin blocked without SaaS session: yes/);
  assert.match(markdown, /Clerk SaaS admin login: not configured; Basic Auth is only the outer staging gate/);
});

test("current access report redacts credentials and secret-like values", () => {
  const report = evaluateCurrentAccessReport({
    baseUrl: "https://cad-agent.example.com",
    domainUrl: "https://cad-agent.example.com",
    adminUser: "admin@example.com",
    passwordDelivery: "secure_channel",
    healthUnauthStatus: 401,
    healthStatus: 200,
    health: {
      app: "ok",
      cadRunnerConfigured: true,
      llmConfigured: true,
      outputDirWritable: true,
      httpsConfigured: true,
      accessMode: "https",
      auth: { clerkConfigured: true, basicAuthConfigured: true, devBypassEnabled: false },
      dataLayer: { mode: "postgres", productionReady: true, connected: true, schemaReady: true },
      build: { commitSha: "not-a-commit; /opt/secret" },
      leaked: "password=should-not-leak sk-test-should-not-leak",
    },
    handoff: { ok: true, summary: { passed: 32, total: 32 }, checks: [] },
  });

  assert.equal(report.v12Handoff.ready, true);
  const markdown = renderCurrentAccessReport(report);
  assert.equal(markdown.includes("should-not-leak"), false);
  assert.equal(markdown.includes("/opt/secret"), false);
  assert.match(markdown, /secure one-time channel/);
});

test("current access report separates public URL from private probe URL", () => {
  const resolved = resolveCurrentAccessRuntimeOptions(
    {
      baseUrl: "http://43.138.153.37:12602",
      probeBaseUrl: "http://127.0.0.1:3000",
      ip: "43.138.153.37",
    },
    {
      STAGING_BASE_URL: "http://127.0.0.1:3000",
      STAGING_BASIC_AUTH_USER: "cad-admin",
      V12_ADMIN_PASSWORD_DELIVERY: "server_file",
      V12_ADMIN_CREDENTIAL_PATH: "/opt/bilnd123-cad-agent-workspace/admin-credential.txt",
    },
  );

  assert.equal(resolved.baseUrl, "http://43.138.153.37:12602");
  assert.equal(resolved.probeBaseUrl, "http://127.0.0.1:3000");
  assert.equal(resolved.ipFallback, "http://43.138.153.37:12602");
  assert.equal(resolved.ip, "43.138.153.37");
  assert.equal(resolved.adminUser, "cad-admin");
  assert.equal(resolved.passwordDelivery, "server_file");
});
