import assert from "node:assert/strict";
import test from "node:test";
import { authPosture, deploymentInfo, healthWarning, isHttpsConfigured, parseStagingAccessMode } from "../app/api/health/route";
import { getDataLayerStatus } from "../lib/server/data-layer";
import { missingRequiredPostgresTables, REQUIRED_POSTGRES_TABLES } from "../lib/server/postgres";

test("parseStagingAccessMode accepts only documented access modes", () => {
  assert.equal(parseStagingAccessMode("https"), "https");
  assert.equal(parseStagingAccessMode("private_network_or_tunnel"), "private_network_or_tunnel");
  assert.equal(parseStagingAccessMode("http_restricted"), "http_restricted");
  assert.equal(parseStagingAccessMode("unknown"), "unknown");
  assert.equal(parseStagingAccessMode(" public "), "unknown");
  assert.equal(parseStagingAccessMode(undefined), "unknown");
});

test("healthWarning only warns for production without HTTPS", () => {
  assert.equal(
    healthWarning({ nodeEnv: "production", httpsConfigured: false }),
    "Staging is running without HTTPS domain; restrict access.",
  );
  assert.equal(healthWarning({ nodeEnv: "production", httpsConfigured: true }), undefined);
  assert.equal(healthWarning({ nodeEnv: "development", httpsConfigured: false }), undefined);
});

test("isHttpsConfigured requires a domain and an explicit HTTPS enable flag", () => {
  assert.equal(isHttpsConfigured({ stagingDomain: "cad.example.com", stagingHttpsEnabled: "1" }), true);
  assert.equal(isHttpsConfigured({ stagingDomain: "cad.example.com", stagingHttpsEnabled: "0" }), false);
  assert.equal(isHttpsConfigured({ stagingDomain: "cad.example.com", stagingHttpsEnabled: undefined }), false);
  assert.equal(isHttpsConfigured({ stagingDomain: "", stagingHttpsEnabled: "1" }), false);
});

test("authPosture reports safe booleans without exposing secret values", () => {
  assert.deepEqual(
    authPosture({
      clerkSecretKey: "sk_test_secret",
      clerkPublishableKey: "pk_test_public",
      stagingBasicAuthUser: "cad-admin",
      stagingBasicAuthPassword: "basic-secret",
      devBypass: "0",
      adminEmails: "admin@example.com",
      appAuthUser: "cad-admin",
      appAuthPassword: "app-secret",
      appAuthSessionSecret: "x".repeat(48),
    }),
    {
      provider: "local_password",
      clerkConfigured: true,
      localPasswordConfigured: true,
      basicAuthConfigured: true,
      devBypassEnabled: false,
      adminAllowlistConfigured: true,
    },
  );
  assert.deepEqual(authPosture({ devBypass: "1" }), {
    provider: "local_password",
    clerkConfigured: false,
    localPasswordConfigured: false,
    basicAuthConfigured: false,
    devBypassEnabled: true,
    adminAllowlistConfigured: false,
  });
});

test("deploymentInfo exposes only sanitized commit metadata", () => {
  assert.deepEqual(deploymentInfo({ appCommitSha: "4D7D7C3" }), { commitSha: "4d7d7c3" });
  assert.deepEqual(deploymentInfo({ appCommitSha: "4d7d7c39240b83a54785c1efd59b907a5a4fc921" }), {
    commitSha: "4d7d7c39240b83a54785c1efd59b907a5a4fc921",
  });
  assert.deepEqual(deploymentInfo({ appCommitSha: "not-a-commit; /opt/secret" }), { commitSha: "" });
});

test("data layer reports JSON fallback when DATABASE_URL is absent", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    const status = await getDataLayerStatus();
    assert.equal(status.mode, "dev_json_fallback");
    assert.equal(status.productionReady, false);
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});

test("Postgres schema health requires every v1.2 persistence table", () => {
  assert.deepEqual(missingRequiredPostgresTables(REQUIRED_POSTGRES_TABLES), []);
  assert.deepEqual(missingRequiredPostgresTables(["projects", "messages", "revisions", "artifacts", "feedback"]), ["usage_events"]);
  assert.deepEqual(missingRequiredPostgresTables(["PROJECTS", "messages"]), ["revisions", "artifacts", "feedback", "usage_events"]);
});
