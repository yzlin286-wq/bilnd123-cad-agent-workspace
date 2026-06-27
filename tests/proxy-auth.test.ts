import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../proxy";

test("staging Basic Auth proxy matcher covers artifact downloads", () => {
  const matcher = config.matcher[0];
  const pattern = new RegExp(`^${matcher}$`);

  assert.equal(pattern.test("/api/artifacts/package-id"), true);
  assert.equal(pattern.test("/api/health"), true);
  assert.equal(pattern.test("/_next/static/chunk.js"), false);
});
