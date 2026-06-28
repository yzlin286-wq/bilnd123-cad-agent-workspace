import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Docker build receives Clerk publishable key for Next client bundles", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const stagingCompose = readFileSync("docker-compose.staging.yml", "utf8");
  const httpsCompose = readFileSync("docker-compose.staging.https.yml", "utf8");

  assert.match(dockerfile, /ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=/);
  assert.match(dockerfile, /ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=\$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  assert.match(stagingCompose, /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:\s*\$\{NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-\}/);
  assert.match(
    httpsCompose,
    /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:\s*\$\{NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:\?set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\}/,
  );
  assert.match(httpsCompose, /STAGING_ACCESS_MODE:\s*\$\{STAGING_ACCESS_MODE:-https\}/);
  assert.match(httpsCompose, /STAGING_HTTPS_ENABLED:\s*\$\{STAGING_HTTPS_ENABLED:-1\}/);
});

test("HTTP and HTTPS staging compose share the same project and persistence volumes", () => {
  const stagingCompose = readFileSync("docker-compose.staging.yml", "utf8");
  const httpsCompose = readFileSync("docker-compose.staging.https.yml", "utf8");

  assert.match(stagingCompose, /^name:\s*bilnd123-cad-agent-workspace/m);
  assert.match(httpsCompose, /^name:\s*bilnd123-cad-agent-workspace/m);
  for (const volume of ["cad_outputs", "run_logs", "postgres_data"]) {
    assert.match(stagingCompose, new RegExp(`^  ${volume}:\\s*$`, "m"));
    assert.match(httpsCompose, new RegExp(`^  ${volume}:\\s*$`, "m"));
  }
  assert.doesNotMatch(httpsCompose, /name:\s*bilnd123_cad_outputs/);
  assert.doesNotMatch(httpsCompose, /name:\s*bilnd123_run_logs/);
});
