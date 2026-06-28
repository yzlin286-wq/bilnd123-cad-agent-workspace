#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_HANDOFF = "outputs/reports/v12-handoff-check.json";
const DEFAULT_OUTPUT = "outputs/reports/v12-access-preflight.md";

export function evaluateV12AccessPreflight({ handoff, env = {} } = {}) {
  const handoffRecord = record(handoff);
  const observed = record(handoffRecord.observed);
  const health = record(observed.health);
  const auth = record(observed.auth);
  const dataLayer = record(observed.dataLayer);
  const admin = record(observed.admin);
  const verification = record(observed.verification);
  const summary = record(handoffRecord.summary);
  const failedChecks = arrayValue(handoffRecord.checks)
    .filter((check) => check.ok !== true)
    .map((check) => stringValue(check.id))
    .filter(Boolean);

  const domain = stringValue(observed.domainUrl) || domainUrlFromEnv(env);
  const ip = stringValue(observed.ipAddress) || stringValue(env.V12_EXPECTED_IP);
  const ipFallback = stringValue(observed.ipFallbackUrl) || stringValue(env.V12_IP_FALLBACK_URL);
  const accessMode = stringValue(observed.accessMode) || stringValue(env.STAGING_ACCESS_MODE) || "unknown";
  const httpsEnabled = observed.httpsConfigured === true;
  const clerkConfigured = auth.clerkConfigured === true;
  const postgresReady = dataLayer.mode === "postgres" && dataLayer.productionReady === true;
  const adminEmail = stringValue(admin.email) || stringValue(env.V12_ADMIN_EMAIL) || stringValue(env.ADMIN_BOOTSTRAP_EMAIL);
  const credentialPath =
    stringValue(admin.credentialPath) || stringValue(env.V12_ADMIN_CREDENTIAL_PATH) || stringValue(env.ADMIN_BOOTSTRAP_CREDENTIAL_PATH);
  const adminIdentityVerified = admin.clerkIdentityVerified === true && admin.clerkAdminAuthorized === true;
  const adminFlowVerified = verification.evidenceVerified === true;
  const adminPageVerified = verification.adminPageVerified === true;

  const blockers = [];
  addBlocker(blockers, !domain, "domain_missing", "A real HTTPS staging domain and DNS evidence are missing.");
  addBlocker(blockers, !isHttpsUrl(domain), "domain_not_https", "Domain URL must be HTTPS.");
  addBlocker(blockers, !ip, "expected_ip_missing", "The staging server public IP is not declared.");
  addBlocker(blockers, accessMode !== "https", "access_mode_not_https", "accessMode must be https for final v1.2 handoff.");
  addBlocker(blockers, !httpsEnabled, "https_not_enabled", "Authenticated /api/health must return httpsConfigured=true.");
  addBlocker(blockers, Boolean(observed.warning), "health_warning_present", "Authenticated /api/health must not return an HTTP exposure warning.");
  addBlocker(blockers, !clerkConfigured, "clerk_not_configured", "Real Clerk keys are not configured or health does not report Clerk configured.");
  addBlocker(blockers, !adminIdentityVerified, "clerk_admin_not_verified", "The Clerk admin identity has not been verified through the Backend API.");
  addBlocker(
    blockers,
    !adminFlowVerified,
    "admin_flow_evidence_missing",
    "Missing sanitized evidence for real admin login, /admin access, project creation, package download, and cross-owner artifact 403.",
  );
  addBlocker(blockers, !adminPageVerified, "admin_page_not_verified", "A logged-in admin has not been verified to receive 200 from /admin.");
  addBlocker(blockers, !postgresReady, "postgres_not_ready", "Staging must use a productionReady Postgres data layer.");
  addBlocker(blockers, handoffRecord.ok !== true, "handoff_gate_failed", "npm run handoff:check has not passed.");

  return {
    ok: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    access: {
      domain,
      ip,
      ipFallback,
      accessMode,
      https: httpsEnabled ? "enabled" : "not enabled",
      warning: stringValue(observed.warning),
      health: {
        app: stringValue(health.app),
        runner: health.cadRunnerConfigured === true,
        llm: health.llmConfigured === true,
        outputWritable: health.outputDirWritable === true,
        supportedTemplates: arrayOfStrings(health.supportedTemplates),
      },
    },
    admin: {
      email: adminEmail,
      passwordDelivery: passwordDeliveryText(admin, env),
      passwordRotationRequired: Boolean(stringValue(admin.passwordDelivery) || env.V12_ADMIN_PASSWORD_DELIVERY || env.ADMIN_BOOTSTRAP_PASSWORD_DELIVERY),
      adminVerified: adminPageVerified,
      identityVerified: adminIdentityVerified,
      flowEvidenceVerified: adminFlowVerified,
      flowEvidencePath: stringValue(admin.flowEvidencePath) || stringValue(env.V12_ADMIN_FLOW_EVIDENCE_PATH),
    },
    dataLayer: {
      mode: stringValue(dataLayer.mode),
      productionReady: dataLayer.productionReady === true,
      connected: dataLayer.connected === true,
      schemaReady: dataLayer.schemaReady === true,
    },
    handoff: {
      ok: handoffRecord.ok === true,
      passed: numberValue(summary.passed),
      total: numberValue(summary.total),
      failed: numberValue(summary.failed),
      failedChecks,
    },
    requiredInputs: requiredInputsFor(blockers, {
      adminEmail,
      credentialPath,
      domain,
      ip,
    }),
    blockers,
  };
}

export function renderV12AccessPreflight(report) {
  const access = record(report?.access);
  const health = record(access.health);
  const admin = record(report?.admin);
  const dataLayer = record(report?.dataLayer);
  const handoff = record(report?.handoff);
  const requiredInputs = arrayValue(report?.requiredInputs);
  const blockers = arrayValue(report?.blockers);
  const lines = [
    "# v1.2 SaaS Access Preflight",
    "",
    `Generated: ${stringValue(report?.generatedAt) || new Date().toISOString()}`,
    `Status: ${report?.ok === true ? "ready" : "not ready"}`,
    "",
    "## Access",
    "",
    `- Domain: ${stringValue(access.domain) || "not configured"}`,
    `- IP: ${stringValue(access.ip) || "not declared"}`,
    `- IP fallback: ${stringValue(access.ipFallback) || "not declared"}`,
    `- accessMode: ${stringValue(access.accessMode) || "unknown"}`,
    `- HTTPS: ${stringValue(access.https) || "not enabled"}`,
    `- Health: app ${stringValue(health.app) || "unknown"}, runner ${yesNo(health.runner)}, llm ${yesNo(health.llm)}, output writable ${yesNo(
      health.outputWritable,
    )}`,
    `- Warning: ${stringValue(access.warning) || "none"}`,
    "",
    "## Admin",
    "",
    `- Admin email: ${stringValue(admin.email) || "not declared"}`,
    `- Admin password: ${stringValue(admin.passwordDelivery) || "not delivered"}`,
    `- Password rotation required: ${admin.passwordRotationRequired === true ? "yes" : "not verified"}`,
    `- /admin verified: ${yesNo(admin.adminVerified)}`,
    `- Clerk admin identity verified: ${yesNo(admin.identityVerified)}`,
    `- Admin flow evidence: ${yesNo(admin.flowEvidenceVerified)}${admin.flowEvidencePath ? ` (${stringValue(admin.flowEvidencePath)})` : ""}`,
    "",
    "## Data",
    "",
    `- Data layer: ${stringValue(dataLayer.mode) || "unknown"}`,
    `- Production ready: ${yesNo(dataLayer.productionReady)}`,
    `- Connected: ${yesNo(dataLayer.connected)}`,
    `- Schema ready: ${yesNo(dataLayer.schemaReady)}`,
    "",
    "## Gate",
    "",
    `- handoff:check: ${handoff.ok === true ? "passed" : "failed"}`,
    `- Checks: ${numberValue(handoff.passed)}/${numberValue(handoff.total)} passed`,
    "",
    "## Required External Inputs",
    "",
    ...requiredInputLines(requiredInputs),
    "",
    "## Blockers",
    "",
    ...(blockers.length ? blockers.map((blocker) => `- ${stringValue(blocker.id)}: ${stringValue(blocker.message)}`) : ["- None"]),
    "",
  ];
  return `${redactSecrets(lines.join("\n"))}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const handoff = await readJsonIfPresent(options.handoff || DEFAULT_HANDOFF);
  const result = evaluateV12AccessPreflight({ handoff, env: process.env });
  const output = options.output || DEFAULT_OUTPUT;
  const markdown = renderV12AccessPreflight(result);
  await writeText(output, markdown);
  if (options.json) {
    await writeText(options.json, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(
    JSON.stringify({
      ok: result.ok,
      output,
      json: options.json || "",
      blockers: result.blockers.map((blocker) => blocker.id),
      requiredInputs: result.requiredInputs.map((item) => item.id),
    }),
  );
  process.exitCode = result.ok ? 0 : 1;
}

function passwordDeliveryText(admin, env) {
  const delivery = stringValue(admin.passwordDelivery) || stringValue(env.V12_ADMIN_PASSWORD_DELIVERY) || stringValue(env.ADMIN_BOOTSTRAP_PASSWORD_DELIVERY);
  const credentialPath = stringValue(admin.credentialPath) || stringValue(env.V12_ADMIN_CREDENTIAL_PATH) || stringValue(env.ADMIN_BOOTSTRAP_CREDENTIAL_PATH);
  if (delivery === "server_file" || credentialPath) return `server-only file ${credentialPath || "(path not recorded)"}`;
  if (delivery === "secure_channel") return "secure one-time channel";
  return "";
}

function requiredInputsFor(blockers, context) {
  const failedIds = new Set(blockers.map((blocker) => blocker.id));
  const items = [];
  if (failedIds.has("domain_missing") || failedIds.has("domain_not_https") || failedIds.has("expected_ip_missing")) {
    items.push({
      id: "domain_dns",
      label: "Staging domain and DNS",
      required: true,
      detail: context.domain
        ? `Use ${context.domain} and confirm it resolves to ${context.ip || "the staging public IP"}.`
        : "Provide a real staging domain or subdomain and create an A record to the staging public IP.",
    });
  }
  if (failedIds.has("access_mode_not_https") || failedIds.has("https_not_enabled") || failedIds.has("health_warning_present")) {
    items.push({
      id: "https_tls",
      label: "HTTPS/TLS activation",
      required: true,
      detail: "Enable Caddy or an equivalent reverse proxy, redirect HTTP to HTTPS, then set STAGING_HTTPS_ENABLED=1 and STAGING_ACCESS_MODE=https.",
    });
  }
  if (failedIds.has("clerk_not_configured")) {
    items.push({
      id: "clerk_keys",
      label: "Real Clerk keys",
      required: true,
      detail: "Configure CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY on the server and rebuild the Docker image.",
    });
  }
  if (failedIds.has("clerk_admin_not_verified") || failedIds.has("admin_page_not_verified")) {
    items.push({
      id: "clerk_admin",
      label: "Real Clerk admin user",
      required: true,
      detail: context.adminEmail
        ? `Bootstrap and verify Clerk admin ${context.adminEmail}; deliver the one-time password through ${context.credentialPath || "a secure channel"}.`
        : "Choose an admin email, run npm run admin:bootstrap with a one-time password, and verify it with npm run admin:verify.",
    });
  }
  if (failedIds.has("admin_flow_evidence_missing")) {
    items.push({
      id: "admin_flow_evidence",
      label: "Admin browser-flow evidence",
      required: true,
      detail: "Capture sanitized evidence for admin login, /admin 200, project creation, package.zip download, non-admin denial, and cross-owner artifact 403.",
    });
  }
  if (failedIds.has("postgres_not_ready")) {
    items.push({
      id: "postgres",
      label: "Postgres data layer",
      required: true,
      detail: "Configure DATABASE_URL, run migrations, and confirm health reports dataLayer.mode=postgres with schemaReady=true.",
    });
  }
  return items;
}

function requiredInputLines(items) {
  if (!items.length) return ["- None"];
  return items.map((item) => `- ${stringValue(item.id)}: ${stringValue(item.label)} - ${stringValue(item.detail)}`);
}

function domainUrlFromEnv(env) {
  const domain = stringValue(env.STAGING_DOMAIN);
  if (!domain) return "";
  if (domain.startsWith("http://") || domain.startsWith("https://")) return domain;
  return `https://${domain}`;
}

function addBlocker(blockers, condition, id, message) {
  if (condition) blockers.push({ id, message });
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(stripBom(await readFile(path.resolve(filePath), "utf8")));
  } catch {
    return undefined;
  }
}

async function writeText(filePath, text) {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, redactSecrets(text), "utf8");
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--handoff") options.handoff = args[++index];
    else if (arg === "--output") options.output = args[++index];
    else if (arg === "--json") options.json = args[++index];
  }
  return options;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function redactSecrets(text) {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+(?!Auth\b)[A-Za-z0-9._~+/-]{6,}=*/gi, "Basic [redacted]")
    .replace(/("password"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/(password=)[^\s]+/gi, "$1[redacted]")
    .replace(/(ADMIN_BOOTSTRAP_PASSWORD=)[^\s]+/gi, "$1[redacted]")
    .replace(/(STAGING_BASIC_AUTH_PASSWORD=)[^\s]+/gi, "$1[redacted]")
    .replace(/(CLERK_SECRET_KEY=)[^\s]+/gi, "$1[redacted]")
    .replace(/(NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=)[^\s]+/gi, "$1[redacted]")
    .replace(/(DATABASE_URL=)[^\s]+/gi, "$1[redacted]");
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value.map(record) : [];
}

function arrayOfStrings(value) {
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
        error: error instanceof Error ? error.name : "V12AccessPreflightError",
        message: "v1.2 access preflight failed before completion.",
      }),
    );
    process.exitCode = 1;
  });
}
