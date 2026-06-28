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
  const adminIdentityVerified = admin.clerkIdentityVerified === true && admin.clerkAdminAuthorized === true;
  const adminFlowVerified = verification.evidenceVerified === true;
  const adminPageVerified = verification.adminPageVerified === true;

  const blockers = [];
  addBlocker(blockers, !domain, "domain_missing", "缺少正式 HTTPS 域名/DNS 证据，未完成域名访问。");
  addBlocker(blockers, !isHttpsUrl(domain), "domain_not_https", "Domain URL 必须是 HTTPS。");
  addBlocker(blockers, !ip, "expected_ip_missing", "缺少服务器公网 IP 证据。");
  addBlocker(blockers, accessMode !== "https", "access_mode_not_https", "accessMode 必须为 https。");
  addBlocker(blockers, !httpsEnabled, "https_not_enabled", "authenticated /api/health 必须返回 httpsConfigured=true。");
  addBlocker(blockers, Boolean(observed.warning), "health_warning_present", "authenticated /api/health 不应返回 HTTP 暴露 warning。");
  addBlocker(blockers, !clerkConfigured, "clerk_not_configured", "真实 Clerk keys 未配置或 health 未报告 Clerk configured。");
  addBlocker(blockers, !adminIdentityVerified, "clerk_admin_not_verified", "Clerk 管理员身份未通过 Backend API 验证。");
  addBlocker(blockers, !adminFlowVerified, "admin_flow_evidence_missing", "缺少真实管理员登录、/admin、项目创建、package 下载和越权 403 的脱敏证据。");
  addBlocker(blockers, !adminPageVerified, "admin_page_not_verified", "未验证管理员登录后 /admin 返回 200。");
  addBlocker(blockers, !postgresReady, "postgres_not_ready", "staging 必须使用 productionReady 的 Postgres 数据层。");
  addBlocker(blockers, handoffRecord.ok !== true, "handoff_gate_failed", "npm run handoff:check 尚未通过。");

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
      email: stringValue(admin.email) || stringValue(env.V12_ADMIN_EMAIL) || stringValue(env.ADMIN_BOOTSTRAP_EMAIL),
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
    blockers,
  };
}

export function renderV12AccessPreflight(report) {
  const access = record(report?.access);
  const health = record(access.health);
  const admin = record(report?.admin);
  const dataLayer = record(report?.dataLayer);
  const handoff = record(report?.handoff);
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
  console.log(JSON.stringify({ ok: result.ok, output, json: options.json || "", blockers: result.blockers.map((blocker) => blocker.id) }));
  process.exitCode = result.ok ? 0 : 1;
}

function passwordDeliveryText(admin, env) {
  const delivery = stringValue(admin.passwordDelivery) || stringValue(env.V12_ADMIN_PASSWORD_DELIVERY) || stringValue(env.ADMIN_BOOTSTRAP_PASSWORD_DELIVERY);
  const credentialPath = stringValue(admin.credentialPath) || stringValue(env.V12_ADMIN_CREDENTIAL_PATH) || stringValue(env.ADMIN_BOOTSTRAP_CREDENTIAL_PATH);
  if (delivery === "server_file" || credentialPath) return `server-only file ${credentialPath || "(path not recorded)"}`;
  if (delivery === "secure_channel") return "secure one-time channel";
  return "";
}

function domainUrlFromEnv(env) {
  const domain = stringValue(env.STAGING_DOMAIN);
  if (!domain) return "";
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
    .replace(/\bBasic\s+[A-Za-z0-9._~+/-]+=*/gi, "Basic [redacted]")
    .replace(/("password"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/(password=)[^\s]+/gi, "$1[redacted]")
    .replace(/(STAGING_BASIC_AUTH_PASSWORD=)[^\s]+/gi, "$1[redacted]")
    .replace(/(CLERK_SECRET_KEY=)[^\s]+/gi, "$1[redacted]")
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
