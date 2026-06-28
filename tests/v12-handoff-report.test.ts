import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("handoff:report renders a sanitized v1.2 handoff report", async () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), "v12-handoff-report-"));
  const inputPath = path.join(outputDir, "handoff.json");
  const outputPath = path.join(outputDir, "handoff.md");

  try {
    writeFileSync(
      inputPath,
      JSON.stringify(
        {
          ok: false,
          generatedAt: "2026-06-28T00:00:00.000Z",
          observed: {
            domainUrl: "",
            ipAddress: "203.0.113.10",
            ipFallbackUrl: "http://203.0.113.10:12602",
            accessMode: "http_restricted",
            httpsConfigured: false,
            warning: "Staging is running without HTTPS domain; restrict access.",
            health: {
              app: "ok",
              cadRunnerConfigured: true,
              llmConfigured: true,
              outputDirWritable: true,
              supportedTemplates: ["mounting_plate", "l_bracket"],
            },
            auth: {
              clerkConfigured: false,
              basicAuthConfigured: true,
              devBypassEnabled: false,
              adminAllowlistConfigured: false,
            },
            dataLayer: {
              mode: "postgres",
              productionReady: true,
            },
            admin: {
              email: "admin@example.com",
              passwordDelivery: "server_file",
              credentialPath: "/opt/bilnd123-cad-agent-workspace/admin-credential.txt",
            },
            verification: {
              adminLoginVerified: false,
              adminPageVerified: false,
              nonAdminBlockedVerified: false,
              adminProjectCreateVerified: false,
              adminPackageDownloadVerified: false,
              artifactAuthzVerified: false,
            },
          },
          summary: { total: 4, passed: 1, failed: 3 },
          checks: [
            { id: "base_url_https", ok: false, message: "The v1.2 handoff URL must use HTTPS." },
            { id: "health_clerk_configured", ok: false, message: "password=super-secret sk-test-secret must not leak." },
            { id: "admin_login_verified", ok: false, message: "A real Clerk admin login must be verified." },
            { id: "health_data_layer_postgres", ok: true, message: "Staging must use Postgres." },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runNode(process.execPath, ["scripts/v12-handoff-report.mjs", "--input", inputPath, "--output", outputPath], {
      cwd: process.cwd(),
    });
    assert.equal(result.code, 0);

    const markdown = readFileSync(outputPath, "utf8");
    assert.match(markdown, /Status: not ready/);
    assert.match(markdown, /Domain: not configured/);
    assert.match(markdown, /IP fallback: http:\/\/203\.0\.113\.10:12602/);
    assert.match(markdown, /Admin email: admin@example\.com/);
    assert.match(markdown, /Admin password: server-only file/);
    assert.match(markdown, /Configure DNS, Caddy HTTPS/);
    assert.match(markdown, /Configure real Clerk keys/);
    assert.equal(markdown.includes("super-secret"), false);
    assert.equal(markdown.includes("sk-test-secret"), false);
    assert.match(markdown, /password=\[redacted\]/);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

function runNode(command: string, args: string[], options: { cwd: string }) {
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
