#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUTPUT = "outputs/reports/v12-current-access-report.md";
const DEFAULT_JSON = "outputs/reports/v12-current-access-report.json";
const REQUEST_TIMEOUT_MS = 15_000;

export function evaluateCurrentAccessReport({
  generatedAt = new Date().toISOString(),
  baseUrl,
  domainUrl,
  ip,
  ipFallback,
  adminUser,
  passwordDelivery,
  credentialPath,
  healthUnauthStatus,
  healthStatus,
  health,
  adminStatus,
  appStatus,
  handoff,
} = {}) {
  const healthRecord = record(health);
  const auth = record(healthRecord.auth);
  const dataLayer = record(healthRecord.dataLayer);
  const build = record(healthRecord.build);
  const handoffRecord = record(handoff);
  const handoffSummary = record(handoffRecord.summary);
  const handoffChecks = arrayValue(handoffRecord.checks);
  const failedHandoffChecks = handoffChecks.filter((check) => check.ok !== true).map((check) => stringValue(check.id)).filter(Boolean);
  const normalizedBaseUrl = safeUrl(baseUrl);
  const normalizedDomainUrl = safeUrl(domainUrl);
  const normalizedIpFallback = safeUrl(ipFallback);

  const temporaryAccessOk =
    healthUnauthStatus === 401 &&
    healthStatus === 200 &&
    healthRecord.app === "ok" &&
    healthRecord.cadRunnerConfigured === true &&
    healthRecord.llmConfigured === true &&
    healthRecord.outputDirWritable === true;
  const appBlockedWithoutSaasSession = isProtectedStatus(appStatus);
  const adminBlockedWithoutSaasSession = isProtectedStatus(adminStatus);

  const blockers = [];
  addBlocker(blockers, !normalizedDomainUrl || !isHttpsDomainUrl(normalizedDomainUrl), "domain_https_missing", "A real HTTPS domain is not configured.");
  addBlocker(blockers, healthRecord.httpsConfigured !== true, "https_not_enabled", "Health does not report httpsConfigured=true.");
  addBlocker(blockers, healthRecord.accessMode !== "https", "access_mode_not_https", "Health does not report accessMode=https.");
  addBlocker(blockers, Boolean(healthRecord.warning), "health_warning_present", "Health still returns an HTTP exposure warning.");
  addBlocker(blockers, auth.clerkConfigured !== true, "clerk_not_configured", "Real Clerk keys are not configured.");
  addBlocker(blockers, auth.devBypassEnabled === true, "dev_bypass_enabled", "SAAS_DEV_AUTH_BYPASS must be disabled.");
  addBlocker(
    blockers,
    dataLayer.mode !== "postgres" || dataLayer.productionReady !== true || dataLayer.connected !== true || dataLayer.schemaReady !== true,
    "postgres_not_ready",
    "Postgres must be connected, schema ready, and productionReady.",
  );
  addBlocker(blockers, handoffRecord.ok !== true, "handoff_gate_not_passed", "The strict v1.2 handoff gate has not passed.");

  return {
    ok: temporaryAccessOk,
    generatedAt,
    currentAccess: {
      baseUrl: normalizedBaseUrl,
      domainUrl: normalizedDomainUrl,
      ip: stringValue(ip),
      ipFallback: normalizedIpFallback,
      basicAuthProtected: healthUnauthStatus === 401,
      healthStatus: numberValue(healthStatus),
      adminStatus: numberValue(adminStatus),
      appStatus: numberValue(appStatus),
      temporarySmokeAccessReady: temporaryAccessOk,
      appBlockedWithoutSaasSession,
      adminBlockedWithoutSaasSession,
      accessMode: stringValue(healthRecord.accessMode),
      httpsConfigured: healthRecord.httpsConfigured === true,
      warning: stringValue(healthRecord.warning),
      health: {
        app: stringValue(healthRecord.app),
        cadRunnerConfigured: healthRecord.cadRunnerConfigured === true,
        llmConfigured: healthRecord.llmConfigured === true,
        outputDirWritable: healthRecord.outputDirWritable === true,
        supportedTemplates: arrayOfStrings(healthRecord.supportedTemplates),
      },
      auth: {
        clerkConfigured: auth.clerkConfigured === true,
        basicAuthConfigured: auth.basicAuthConfigured === true,
        devBypassEnabled: auth.devBypassEnabled === true,
        adminAllowlistConfigured: auth.adminAllowlistConfigured === true,
      },
      dataLayer: {
        mode: stringValue(dataLayer.mode),
        productionReady: dataLayer.productionReady === true,
        connected: dataLayer.connected === true,
        schemaReady: dataLayer.schemaReady === true,
        requiredTables: arrayOfStrings(dataLayer.requiredTables),
        missingTables: arrayOfStrings(dataLayer.missingTables),
      },
      build: {
        deployedCommit: normalizeCommitSha(build.commitSha),
      },
    },
    admin: {
      user: stringValue(adminUser),
      passwordDelivery: passwordDeliveryText(passwordDelivery, credentialPath),
      passwordRotationRequired: Boolean(passwordDelivery || credentialPath),
      temporaryBasicAuthOnly: auth.clerkConfigured !== true,
    },
    v12Handoff: {
      ready: handoffRecord.ok === true && blockers.length === 0,
      handoffGateOk: handoffRecord.ok === true,
      passed: numberValue(handoffSummary.passed),
      total: numberValue(handoffSummary.total),
      failedChecks: failedHandoffChecks,
      blockers,
    },
  };
}

export function renderCurrentAccessReport(report) {
  const access = record(report?.currentAccess);
  const health = record(access.health);
  const auth = record(access.auth);
  const dataLayer = record(access.dataLayer);
  const build = record(access.build);
  const admin = record(report?.admin);
  const handoff = record(report?.v12Handoff);
  const blockers = arrayValue(handoff.blockers);
  const lines = [
    "# v1.2 Current Access Report",
    "",
    `Generated: ${stringValue(report?.generatedAt) || new Date().toISOString()}`,
    `Temporary smoke/API access: ${report?.ok === true ? "ready" : "not ready"}`,
    `Interactive SaaS access: ${handoff.ready === true ? "ready" : "requires real Clerk login and HTTPS handoff"}`,
    `Final v1.2 handoff: ${handoff.ready === true ? "ready" : "not ready"}`,
    "",
    "## Access",
    "",
    `- Current URL: ${stringValue(access.baseUrl) || "not configured"}`,
    `- HTTPS domain: ${stringValue(access.domainUrl) || "not configured"}`,
    `- IP: ${stringValue(access.ip) || "not declared"}`,
    `- IP fallback: ${stringValue(access.ipFallback) || "not declared"}`,
    `- Basic Auth protected: ${yesNo(access.basicAuthProtected)}`,
    `- accessMode: ${stringValue(access.accessMode) || "unknown"}`,
    `- HTTPS configured: ${yesNo(access.httpsConfigured)}`,
    `- Warning: ${stringValue(access.warning) || "none"}`,
    `- Health: ${numberValue(access.healthStatus) || "n/a"}, app ${stringValue(health.app) || "unknown"}, runner ${yesNo(
      health.cadRunnerConfigured,
    )}, llm ${yesNo(health.llmConfigured)}, output writable ${yesNo(health.outputDirWritable)}`,
    `- /app status with current access gate: ${numberValue(access.appStatus) || "n/a"}`,
    `- /admin status with current access gate: ${numberValue(access.adminStatus) || "n/a"}`,
    `- /app blocked without SaaS session: ${yesNo(access.appBlockedWithoutSaasSession)}`,
    `- /admin blocked without SaaS session: ${yesNo(access.adminBlockedWithoutSaasSession)}`,
    `- Supported templates: ${arrayOfStrings(health.supportedTemplates).join(", ") || "unknown"}`,
    `- Build commit: ${stringValue(build.deployedCommit) || "not reported"}`,
    "",
    "## Admin",
    "",
    `- Admin user: ${stringValue(admin.user) || "not declared"}`,
    `- Admin password: ${stringValue(admin.passwordDelivery) || "not included in report"}`,
    `- Password rotation required: ${admin.passwordRotationRequired === true ? "yes" : "not verified"}`,
    `- Clerk SaaS admin login: ${admin.temporaryBasicAuthOnly === true ? "not configured; Basic Auth is only the outer staging gate" : "configured"}`,
    "",
    "## Auth And Data",
    "",
    `- Clerk configured: ${yesNo(auth.clerkConfigured)}`,
    `- Basic Auth configured: ${yesNo(auth.basicAuthConfigured)}`,
    `- Dev bypass enabled: ${yesNo(auth.devBypassEnabled)}`,
    `- Data layer: ${stringValue(dataLayer.mode) || "unknown"}, production ready ${yesNo(dataLayer.productionReady)}, connected ${yesNo(
      dataLayer.connected,
    )}, schema ready ${yesNo(dataLayer.schemaReady)}`,
    `- Required Postgres tables: ${arrayOfStrings(dataLayer.requiredTables).join(", ") || "not reported"}`,
    `- Missing Postgres tables: ${arrayOfStrings(dataLayer.missingTables).join(", ") || "none"}`,
    "",
    "## Final Handoff Blockers",
    "",
    ...(blockers.length ? blockers.map((blocker) => `- ${stringValue(blocker.id)}: ${stringValue(blocker.message)}`) : ["- None"]),
    "",
  ];
  return `${redactSecrets(lines.join("\n"))}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = resolveCurrentAccessRuntimeOptions(options, process.env);
  const authHeader = basicAuthHeader(process.env.STAGING_BASIC_AUTH_USER, process.env.STAGING_BASIC_AUTH_PASSWORD);
  const probeBaseUrl = runtime.probeBaseUrl;
  const healthUnauth = probeBaseUrl ? await requestJson(new URL("/api/health", probeBaseUrl), {}) : {};
  const healthAuth = probeBaseUrl ? await requestJson(new URL("/api/health", probeBaseUrl), authHeader ? { authorization: authHeader } : {}) : {};
  const adminResponse = probeBaseUrl ? await requestText(new URL("/admin", probeBaseUrl), authHeader ? { authorization: authHeader } : {}) : {};
  const appResponse = probeBaseUrl ? await requestText(new URL("/app", probeBaseUrl), authHeader ? { authorization: authHeader } : {}) : {};
  const handoff = options.handoff ? await readJsonIfPresent(options.handoff) : undefined;
  const report = evaluateCurrentAccessReport({
    baseUrl: runtime.baseUrl,
    domainUrl: runtime.domainUrl,
    ip: runtime.ip,
    ipFallback: runtime.ipFallback,
    adminUser: runtime.adminUser,
    passwordDelivery: runtime.passwordDelivery,
    credentialPath: runtime.credentialPath,
    healthUnauthStatus: healthUnauth.status,
    healthStatus: healthAuth.status,
    health: healthAuth.body,
    adminStatus: adminResponse.status,
    appStatus: appResponse.status,
    handoff,
  });
  const output = options.output || DEFAULT_OUTPUT;
  const json = options.json || DEFAULT_JSON;
  await writeText(output, renderCurrentAccessReport(report));
  await writeText(json, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: report.ok, handoffReady: report.v12Handoff.ready, output, json }));
  process.exitCode = report.ok ? 0 : 1;
}

export function resolveCurrentAccessRuntimeOptions(options = {}, env = {}) {
  const baseUrl =
    options.baseUrl || env.V12_PUBLIC_BASE_URL || env.STAGING_PUBLIC_BASE_URL || env.STAGING_BASE_URL || "";
  const probeBaseUrl = options.probeBaseUrl || env.V12_PROBE_BASE_URL || env.STAGING_PROBE_BASE_URL || baseUrl;
  return {
    baseUrl,
    probeBaseUrl,
    domainUrl: options.domainUrl || domainUrlFromEnv(env.STAGING_DOMAIN),
    ip: options.ip || env.V12_EXPECTED_IP || "",
    ipFallback: options.ipFallback || env.V12_IP_FALLBACK_URL || baseUrl,
    adminUser: options.adminUser || env.V12_ADMIN_EMAIL || env.STAGING_BASIC_AUTH_USER || "",
    credentialPath: options.credentialPath || env.V12_ADMIN_CREDENTIAL_PATH || env.ADMIN_BOOTSTRAP_CREDENTIAL_PATH || "",
    passwordDelivery: options.passwordDelivery || env.V12_ADMIN_PASSWORD_DELIVERY || env.ADMIN_BOOTSTRAP_PASSWORD_DELIVERY || "",
  };
}

async function requestJson(url, headers) {
  try {
    const response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await response.text();
    return { status: response.status, body: parseJson(text) };
  } catch (error) {
    return { status: 0, body: { error: error instanceof Error ? error.name : "FetchError" } };
  }
}

async function requestText(url, headers) {
  try {
    const response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { status: response.status };
  } catch {
    return { status: 0 };
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
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
    if (arg === "--base-url") options.baseUrl = args[++index];
    else if (arg === "--domain-url") options.domainUrl = args[++index];
    else if (arg === "--ip") options.ip = args[++index];
    else if (arg === "--ip-fallback") options.ipFallback = args[++index];
    else if (arg === "--probe-base-url") options.probeBaseUrl = args[++index];
    else if (arg === "--admin-user") options.adminUser = args[++index];
    else if (arg === "--password-delivery") options.passwordDelivery = args[++index];
    else if (arg === "--credential-path") options.credentialPath = args[++index];
    else if (arg === "--handoff") options.handoff = args[++index];
    else if (arg === "--output") options.output = args[++index];
    else if (arg === "--json") options.json = args[++index];
  }
  return options;
}

function passwordDeliveryText(delivery, credentialPath) {
  const normalized = stringValue(delivery);
  const pathValue = stringValue(credentialPath);
  if (normalized === "server_file" || pathValue) return `server-only file ${pathValue || "(path not recorded)"}`;
  if (normalized === "secure_channel") return "secure one-time channel";
  return "";
}

function basicAuthHeader(user, password) {
  if (!user || !password) return undefined;
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function domainUrlFromEnv(domain) {
  const value = stringValue(domain).trim();
  return value ? `https://${value}` : "";
}

function safeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "[invalid-url]";
  }
}

function isHttpsDomainUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !isIP(url.hostname);
  } catch {
    return false;
  }
}

function addBlocker(blockers, condition, id, message) {
  if (condition) blockers.push({ id, message });
}

function isProtectedStatus(status) {
  const code = numberValue(status);
  return code === 401 || code === 403 || (code >= 300 && code < 400);
}

function redactSecrets(text) {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/pk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+[A-Za-z0-9._~+/-]{12,}=*/gi, "Basic [redacted]")
    .replace(/("password"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/(password=)[^\s]+/gi, "$1[redacted]")
    .replace(/(STAGING_BASIC_AUTH_PASSWORD=)[^\s]+/gi, "$1[redacted]")
    .replace(/(CLERK_SECRET_KEY=)[^\s]+/gi, "$1[redacted]")
    .replace(/(DATABASE_URL=)[^\s]+/gi, "$1[redacted]");
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

function normalizeCommitSha(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{7,40}$/.test(normalized) ? normalized : "";
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
        error: error instanceof Error ? error.name : "V12CurrentAccessReportError",
        message: "v1.2 current access report failed before completion.",
      }),
    );
    process.exitCode = 1;
  });
}
