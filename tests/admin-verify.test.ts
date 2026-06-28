import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { updateAdminHandoffEnvFile } from "../scripts/bootstrap-admin.mjs";
import { evaluateAdminVerification } from "../scripts/verify-admin.mjs";

test("admin verification accepts Clerk admin metadata without exposing secrets", () => {
  const result = evaluateAdminVerification({
    clerkSecretConfigured: true,
    clerkPublishableConfigured: true,
    adminEmail: "Admin@Example.com",
    user: {
      id: "user_admin",
      passwordEnabled: true,
      banned: false,
      locked: false,
      primaryEmailAddress: { emailAddress: "admin@example.com" },
      publicMetadata: { role: "admin" },
      privateMetadata: {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.adminEmail, "admin@example.com");
  assert.equal(result.evidence.adminAuthorized, true);
  assert.equal(result.evidence.adminByMetadata, true);
});

test("admin verification fails when Clerk user is not authorized as admin", () => {
  const result = evaluateAdminVerification({
    clerkSecretConfigured: true,
    clerkPublishableConfigured: true,
    adminEmail: "member@example.com",
    user: {
      id: "user_member",
      passwordEnabled: true,
      banned: false,
      locked: false,
      primaryEmailAddress: { emailAddress: "member@example.com" },
      publicMetadata: {},
      privateMetadata: {},
    },
  });
  const failedIds = result.checks.filter((check: { ok: boolean }) => !check.ok).map((check: { id: string }) => check.id);

  assert.equal(result.ok, false);
  assert.match(failedIds.join(","), /admin_authorized/);
});

test("admin:verify writes a sanitized failure report when Clerk keys are absent", async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), "admin-verify-"));
  const outputPath = path.join(outputDir, "admin.json");

  try {
    const result = await runNode(process.execPath, ["scripts/verify-admin.mjs", "--admin-email", "admin@example.com", "--output", outputPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLERK_SECRET_KEY: "",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      },
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout.includes("sk_"), false);

    const report = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(report.ok, false);
    assert.equal(report.adminEmail, "admin@example.com");
    assert.match(report.checks.filter((check: { ok: boolean }) => !check.ok).map((check: { id: string }) => check.id).join(","), /clerk_secret_configured/);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("admin:bootstrap loads Clerk lazily and keeps config failures sanitized", async () => {
  const source = readFileSync(path.join(process.cwd(), "scripts/bootstrap-admin.mjs"), "utf8");
  assert.doesNotMatch(source, /import\s+\{\s*createClerkClient\s*\}\s+from\s+["']@clerk\/backend["']/);
  assert.match(source, /await import\(["']@clerk\/backend["']\)/);
  assert.match(source, /ADMIN_BOOTSTRAP_RESET_PASSWORD !== "0"/);
  assert.match(source, /passwordUpdated/);

  const result = await runNode(process.execPath, ["scripts/bootstrap-admin.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLERK_SECRET_KEY: "",
      ADMIN_BOOTSTRAP_EMAIL: "admin@example.com",
      ADMIN_BOOTSTRAP_PASSWORD: "do-not-print-this-password",
    },
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /BOOTSTRAP_CONFIG_ERROR/);
  assert.equal(result.stderr.includes("do-not-print-this-password"), false);
  assert.equal(result.stdout.includes("do-not-print-this-password"), false);
});

test("admin:bootstrap persists safe v1.2 handoff metadata without a password", async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), "admin-bootstrap-env-"));
  const envPath = path.join(outputDir, ".env");

  try {
    writeFileSync(
      envPath,
      "SAAS_ADMIN_EMAILS=owner@example.com\nADMIN_BOOTSTRAP_EMAIL=old@example.com\nV12_ADMIN_PASSWORD_DELIVERY=secure_channel\n",
      "utf8",
    );

    await updateAdminHandoffEnvFile(envPath, {
      adminEmail: "Admin@Example.com",
      credentialPath: "/opt/bilnd123-cad-agent-workspace/admin-credential.txt",
    });

    const text = readFileSync(envPath, "utf8");
    assert.match(text, /SAAS_ADMIN_EMAILS=owner@example.com,admin@example.com/);
    assert.match(text, /ADMIN_BOOTSTRAP_EMAIL=admin@example.com/);
    assert.match(text, /V12_ADMIN_EMAIL=admin@example.com/);
    assert.match(
      text,
      /ADMIN_BOOTSTRAP_CREDENTIAL_PATH=\/opt\/bilnd123-cad-agent-workspace\/admin-credential\.txt/,
    );
    assert.match(text, /V12_ADMIN_PASSWORD_DELIVERY=server_file/);
    assert.match(text, /V12_ADMIN_CREDENTIAL_PATH=\/opt\/bilnd123-cad-agent-workspace\/admin-credential\.txt/);
    assert.equal(text.includes("ADMIN_BOOTSTRAP_PASSWORD"), false);
    assert.equal(text.includes("do-not-print-this-password"), false);
    if (process.platform !== "win32") {
      assert.equal(statSync(envPath).mode & 0o077, 0);
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

function runNode(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
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
  });
}
