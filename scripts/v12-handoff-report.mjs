#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_INPUT = "outputs/reports/v12-handoff-check.json";
const DEFAULT_OUTPUT = "outputs/reports/v12-handoff-report.md";

export function renderV12HandoffReport(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const failed = checks.filter((check) => !check?.ok);
  const observed = record(report?.observed);
  const health = record(observed.health);
  const auth = record(observed.auth);
  const dataLayer = record(observed.dataLayer);
  const build = record(observed.build);
  const admin = record(observed.admin);
  const verification = record(observed.verification);
  const summary = record(report?.summary);
  const ok = report?.ok === true;

  const lines = [
    "# v1.2 SaaS Access Handoff Report",
    "",
    `Generated: ${stringValue(report?.generatedAt) || new Date().toISOString()}`,
    `Status: ${ok ? "ready" : "not ready"}`,
    `Checks: ${numberValue(summary.passed)}/${numberValue(summary.total)} passed`,
    "",
    "## Access",
    "",
    `- Domain: ${stringValue(observed.domainUrl) || "not configured"}`,
    `- IP: ${stringValue(observed.ipAddress) || "not declared"}`,
    `- IP fallback: ${stringValue(observed.ipFallbackUrl) || "not declared"}`,
    `- accessMode: ${stringValue(observed.accessMode) || "unknown"}`,
    `- HTTPS: ${observed.httpsConfigured === true ? "enabled" : "not enabled"}`,
    `- Warning: ${stringValue(observed.warning) || "none"}`,
    `- Health: app ${stringValue(health.app) || "unknown"}, runner ${yesNo(health.cadRunnerConfigured)}, llm ${yesNo(
      health.llmConfigured,
    )}, output writable ${yesNo(health.outputDirWritable)}`,
    `- Supported templates: ${arrayValue(health.supportedTemplates).join(", ") || "unknown"}`,
    `- Data layer: ${stringValue(dataLayer.mode) || "unknown"}, production ready ${yesNo(dataLayer.productionReady)}`,
    `- Missing Postgres tables: ${arrayValue(dataLayer.missingTables).join(", ") || "none"}`,
    `- Build commit: ${stringValue(build.deployedCommit) || "not reported"}${build.expectedCommit ? ` (expected ${stringValue(build.expectedCommit)})` : ""}`,
    "",
    "## Admin",
    "",
    `- Admin email: ${stringValue(admin.email) || "not declared"}`,
    `- Admin password: ${passwordDeliveryText(admin)}`,
    `- Password rotation required: ${admin.passwordDelivery ? "yes" : "not verified"}`,
    `- Clerk configured: ${yesNo(auth.clerkConfigured)}`,
    `- Clerk admin identity verified: ${yesNo(admin.clerkIdentityVerified)}`,
    `- Clerk admin authorized: ${yesNo(admin.clerkAdminAuthorized)}`,
    `- Admin flow evidence: ${yesNo(verification.evidenceVerified)}${admin.flowEvidencePath ? ` (${stringValue(admin.flowEvidencePath)})` : ""}`,
    `- Admin flow evidence commit: ${stringValue(verification.evidenceCommit) || "not reported"}`,
    `- Dev auth bypass disabled: ${auth.devBypassEnabled === false ? "yes" : "no"}`,
    `- /admin verified: ${yesNo(verification.adminPageVerified)}`,
    "",
    "## Required Verification",
    "",
    `- Admin can log in: ${yesNo(verification.adminLoginVerified)}`,
    `- Admin can access /admin: ${yesNo(verification.adminPageVerified)}`,
    `- Non-admin is blocked from /admin: ${yesNo(verification.nonAdminBlockedVerified)}`,
    `- Admin can create CAD project: ${yesNo(verification.adminProjectCreateVerified)}`,
    `- Admin can download own package.zip: ${yesNo(verification.adminPackageDownloadVerified)}`,
    `- Cross-owner artifact download returns 403: ${yesNo(verification.artifactAuthzVerified)}`,
    "",
    "## Open Blockers",
    "",
    ...blockerLines(failed),
    "",
    "## Action Items",
    "",
    ...actionItems(checks),
    "",
  ];

  return `${redactSecrets(lines.join("\n"))}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = options.input || DEFAULT_INPUT;
  const output = options.output || DEFAULT_OUTPUT;
  const report = JSON.parse(await readFile(input, "utf8"));
  const markdown = renderV12HandoffReport(report);
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, markdown, "utf8");
  console.log(JSON.stringify({ ok: true, input, output }));
}

function blockerLines(failed) {
  if (!failed.length) return ["- None"];
  return failed.map((check) => `- ${stringValue(check.id) || "unknown"}: ${stringValue(check.message) || "failed"}`);
}

function actionItems(checks) {
  const failedIds = new Set(checks.filter((check) => !check?.ok).map((check) => check.id));
  const items = [];
  if (failedIds.has("base_url_https") || failedIds.has("health_https_configured") || failedIds.has("http_redirects_to_https")) {
    items.push("- Configure DNS, Caddy HTTPS, and HTTP to HTTPS redirect before claiming v1.2 handoff.");
  }
  if (failedIds.has("health_clerk_configured") || failedIds.has("clerk_sign_in_rendered") || failedIds.has("clerk_sign_up_rendered")) {
    items.push("- Configure real Clerk keys and bootstrap a real admin user.");
  }
  if (failedIds.has("app_requires_clerk_session") || failedIds.has("admin_requires_clerk_session") || failedIds.has("projects_api_requires_clerk_session")) {
    items.push("- Verify Clerk session protection for /app, /admin, and project APIs with only the outer staging gate satisfied.");
  }
  if (failedIds.has("clerk_admin_identity_verified") || failedIds.has("clerk_admin_email_matches")) {
    items.push("- Run npm run admin:verify for the declared admin email and pass its matching output to handoff:check.");
  }
  if (failedIds.has("admin_flow_evidence_verified")) {
    items.push("- Capture sanitized admin flow evidence and verify it with npm run admin:flow:verify before handoff:check.");
  }
  if (failedIds.has("health_data_layer_postgres")) {
    items.push("- Configure DATABASE_URL, run migrations, and verify Postgres health.");
  }
  if (failedIds.has("expected_commit_declared") || failedIds.has("health_commit_reported") || failedIds.has("health_commit_matches_expected")) {
    items.push("- Set APP_COMMIT_SHA on the deployment and rerun handoff:check with --expected-commit for the deployed commit.");
  }
  if ([...failedIds].some((id) => id.startsWith("admin_") || id.includes("artifact"))) {
    items.push("- Complete real admin login, project creation, package download, and artifact authorization verification.");
  }
  return items.length ? items : ["- None"];
}

function passwordDeliveryText(admin) {
  const delivery = stringValue(admin.passwordDelivery);
  if (delivery === "server_file") {
    return `server-only file ${stringValue(admin.credentialPath) || "(path not recorded)"}`;
  }
  if (delivery === "secure_channel") return "secure one-time channel";
  return "not delivered";
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") options.input = args[++index];
    else if (arg === "--output") options.output = args[++index];
  }
  return options;
}

function redactSecrets(text) {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+(?!Auth\b)[A-Za-z0-9._~+/-]{6,}=*/gi, "Basic [redacted]")
    .replace(/(password=)[^\s]+/gi, "$1[redacted]")
    .replace(/(STAGING_BASIC_AUTH_PASSWORD=)[^\s]+/gi, "$1[redacted]")
    .replace(/(CLERK_SECRET_KEY=)[^\s]+/gi, "$1[redacted]")
    .replace(/(POSTGRES_PASSWORD=)[^\s]+/gi, "$1[redacted]");
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function numberValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function yesNo(value) {
  return value === true ? "yes" : "no";
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (entryPath && path.resolve(process.argv[1]) === entryPath) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.name : "V12HandoffReportError",
        message: "v1.2 handoff report generation failed.",
      }),
    );
    process.exitCode = 1;
  });
}
