import assert from "node:assert/strict";
import test from "node:test";
import { config, proxyMode } from "../proxy";

test("staging Basic Auth proxy matcher covers artifact downloads", () => {
  const matcher = config.matcher[0];
  const pattern = new RegExp(`^${matcher}$`);

  assert.equal(pattern.test("/api/artifacts/package-id"), true);
  assert.equal(pattern.test("/api/health"), true);
  assert.equal(pattern.test("/app/projects"), true);
  assert.equal(pattern.test("/admin"), true);
  assert.equal(pattern.test("/_next/static/chunk.js"), false);
});

test("proxy mode defaults to local password auth unless Clerk is explicitly requested", () => {
  assert.equal(proxyMode({}), "fallback");
  assert.equal(proxyMode({ CLERK_SECRET_KEY: "sk_test_secret" }), "fallback");
  assert.equal(proxyMode({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public" }), "fallback");
  assert.equal(
    proxyMode({
      CLERK_SECRET_KEY: "sk_test_secret",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
    }),
    "fallback",
  );
  assert.equal(
    proxyMode({
      SAAS_AUTH_PROVIDER: "clerk",
      CLERK_SECRET_KEY: "sk_test_secret",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
    }),
    "clerk",
  );
});
