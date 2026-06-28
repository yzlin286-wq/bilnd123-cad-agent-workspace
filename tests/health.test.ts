import assert from "node:assert/strict";
import test from "node:test";
import { healthWarning, parseStagingAccessMode } from "../app/api/health/route";
import { getDataLayerStatus } from "../lib/server/data-layer";

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
