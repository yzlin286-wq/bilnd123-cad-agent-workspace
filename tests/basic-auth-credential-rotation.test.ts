import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { rotateBasicAuthCredential } from "../scripts/rotate-basic-auth-credential.mjs";

test("staging Basic Auth rotation writes env and server credential evidence without returning the password", async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), "basic-auth-rotation-"));
  const envPath = path.join(outputDir, ".env");
  const credentialPath = path.join(outputDir, "admin-credential.txt");

  try {
    writeFileSync(
      envPath,
      [
        "STAGING_BASIC_AUTH_USER=old-admin",
        "STAGING_BASIC_AUTH_PASSWORD=old-password",
        "STAGING_ACCESS_MODE=unknown",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await rotateBasicAuthCredential({
      envFile: envPath,
      credentialPath,
      user: "cad-admin",
      password: "one-time-secret-value",
      accessMode: "http_restricted",
    });

    assert.equal(result.ok, true);
    assert.equal(result.user, "cad-admin");
    assert.equal(result.passwordPresent, true);
    assert.equal(result.rotationRequired, true);
    assert.equal(JSON.stringify(result).includes("one-time-secret-value"), false);

    const envText = readFileSync(envPath, "utf8");
    assert.match(envText, /STAGING_BASIC_AUTH_USER=cad-admin/);
    assert.match(envText, /STAGING_BASIC_AUTH_PASSWORD=one-time-secret-value/);
    assert.match(envText, /STAGING_ACCESS_MODE=http_restricted/);
    assert.match(envText, /V12_ADMIN_PASSWORD_DELIVERY=server_file/);
    assert.match(envText, new RegExp(`V12_ADMIN_CREDENTIAL_PATH=${escapeRegExp(credentialPath)}`));

    const credentialText = readFileSync(credentialPath, "utf8");
    assert.match(credentialText, /username: cad-admin/);
    assert.match(credentialText, /password: one-time-secret-value/);
    assert.match(credentialText, /rotation_required: yes/);
    assert.match(credentialText, /access_mode: http_restricted/);

    if (process.platform !== "win32") {
      assert.equal(statSync(envPath).mode & 0o077, 0);
      assert.equal(statSync(credentialPath).mode & 0o077, 0);
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("staging Basic Auth rotation CLI reads password from stdin and does not print it", async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), "basic-auth-rotation-cli-"));
  const envPath = path.join(outputDir, ".env");
  const credentialPath = path.join(outputDir, "admin-credential.txt");

  try {
    const result = await runNode(
      process.execPath,
      [
        "scripts/rotate-basic-auth-credential.mjs",
        "--staging-env-file",
        envPath,
        "--credential-path",
        credentialPath,
        "--user",
        "cad-admin",
        "--access-mode",
        "http_restricted",
        "--password-stdin",
      ],
      {
        cwd: process.cwd(),
        stdin: "stdin-secret-value",
      },
    );

    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes("stdin-secret-value"), false);
    assert.equal(result.stderr.includes("stdin-secret-value"), false);
    assert.match(result.stdout, /"ok":true/);
    assert.match(result.stdout, /"passwordDelivery":"server_file"/);

    const envText = readFileSync(envPath, "utf8");
    const credentialText = readFileSync(credentialPath, "utf8");
    assert.match(envText, /STAGING_BASIC_AUTH_PASSWORD=stdin-secret-value/);
    assert.match(credentialText, /password: stdin-secret-value/);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runNode(
  command: string,
  args: string[],
  options: { cwd: string; stdin?: string },
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out: ${command} ${args.join(" ")}`));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(options.stdin || "");
  });
}
