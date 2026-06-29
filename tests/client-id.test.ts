import assert from "node:assert/strict";
import test from "node:test";
import { createClientId } from "../lib/client/ids";

test("createClientId works without randomUUID for HTTP staging browsers", () => {
  let called = false;
  const id = createClientId("agent", {
    getRandomValues(array) {
      called = true;
      array.fill(7);
      return array;
    },
  });

  assert.equal(called, true);
  assert.equal(id, "agent-07070707070707070707070707070707");
});

test("createClientId has a last-resort client-only id when Web Crypto is unavailable", () => {
  const id = createClientId("user", undefined);
  assert.match(id, /^user-/);
});
