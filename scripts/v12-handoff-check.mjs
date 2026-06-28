#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUTPUT = "outputs/reports/v12-handoff-check.json";

export function evaluateV12Handoff({
  baseUrl,
  healthStatus,
  health,
  signInStatus,
  signInHtml = "",
  appStatus,
  appLocation,
  adminStatus,
  adminLocation,
  adminEmail,
  credentialPath,
  passwordDelivery,
  credentialInspection,
} = {}) {
  const checks = [];
  const normalizedBaseUrl = safeUrl(baseUrl);
  const healthRecord = record(health);
  const dataLayer = record(healthRecord.dataLayer);
  const auth = record(healthRecord.auth);
  const normalizedDelivery = normalizePasswordDelivery(passwordDelivery, credentialPath);
  const credentialRecord = record(credentialInspection);

  add(checks, "base_url_present", Boolean(baseUrl), "A staging base URL is required.");
  add(checks, "base_url_https", isHttpsUrl(baseUrl), "The v1.2 handoff URL must use HTTPS.");
  add(checks, "health_reachable", healthStatus === 200, "Authenticated /api/health must return 200.");
  add(checks, "health_app_ok", healthRecord.app === "ok", "Health must report app=ok.");
  add(checks, "health_runner_configured", healthRecord.cadRunnerConfigured === true, "CAD runner must be configured.");
  add(checks, "health_llm_configured", healthRecord.llmConfigured === true, "LLM must be configured.");
  add(checks, "health_output_writable", healthRecord.outputDirWritable === true, "CAD output directory must be writable.");
  add(checks, "health_https_configured", healthRecord.httpsConfigured === true, "Health must report httpsConfigured=true.");
  add(checks, "health_access_mode_https", healthRecord.accessMode === "https", "Health must report accessMode=https.");
  add(checks, "health_no_warning", !healthRecord.warning, "Health must not return an HTTP exposure warning.");
  add(checks, "health_clerk_configured", auth.clerkConfigured === true, "Health must report Clerk configured.");
  add(checks, "health_dev_bypass_disabled", auth.devBypassEnabled === false, "SAAS_DEV_AUTH_BYPASS must be disabled in staging.");
  add(checks, "health_data_layer_postgres", dataLayer.mode === "postgres", "Staging must use Postgres.");
  add(
    checks,
    "health_data_layer_production_ready",
    dataLayer.productionReady === true,
    "Postgres data layer must report productionReady=true.",
  );
  add(
    checks,
    "clerk_sign_in_rendered",
    signInStatus === 200 && !signInHtml.includes("Clerk is not configured"),
    "The sign-in page must render real Clerk UI, not the placeholder.",
  );
  add(
    checks,
    "app_requires_clerk_session",
    isProtectedResponse(appStatus, appLocation),
    "With the outer staging gate satisfied but no Clerk session, /app must redirect/block instead of returning 200.",
  );
  add(
    checks,
    "admin_requires_clerk_session",
    isProtectedResponse(adminStatus, adminLocation),
    "With the outer staging gate satisfied but no Clerk session, /admin must redirect/block instead of returning 200.",
  );
  add(checks, "admin_email_declared", Boolean(adminEmail), "A Clerk admin email must be declared for handoff.");
  add(checks, "admin_password_delivery_declared", Boolean(normalizedDelivery), "A one-time admin password delivery method must be declared.");
  if (normalizedDelivery === "server_file") {
    add(checks, "admin_credential_file_exists", credentialRecord.exists === true, "The server-only admin credential file must exist.");
    add(
      checks,
      "admin_credential_file_private",
      credentialRecord.privatePermissions === true,
      "The server-only admin credential file must not allow group or world access.",
    );
  }
  if (normalizedDelivery === "secure_channel") {
    add(checks, "admin_password_secure_channel_declared", true, "A secure one-time password channel was declared.");
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    baseUrl: normalizedBaseUrl,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    checks,
  };
}

export function safeUrl(value) {
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

export function isProtectedResponse(status, location) {
  if ([401, 403].includes(Number(status))) return true;
  if ([302, 303, 307, 308].includes(Number(status))) {
    return !location || location.includes("/sign-in") || location.includes("clerk");
  }
  return false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = options.baseUrl || process.env.STAGING_BASE_URL;
  const output = options.output || DEFAULT_OUTPUT;
  const adminEmail = options.adminEmail || process.env.ADMIN_BOOTSTRAP_EMAIL || process.env.V12_ADMIN_EMAIL;
  const credentialPath = options.credentialPath || process.env.ADMIN_BOOTSTRAP_CREDENTIAL_PATH || process.env.V12_ADMIN_CREDENTIAL_PATH;
  const passwordDelivery =
    options.passwordDelivery || process.env.ADMIN_BOOTSTRAP_PASSWORD_DELIVERY || process.env.V12_ADMIN_PASSWORD_DELIVERY;
  const authHeader = basicAuthHeader(process.env.STAGING_BASIC_AUTH_USER, process.env.STAGING_BASIC_AUTH_PASSWORD);
  const probe = baseUrl ? await probeStaging(baseUrl, authHeader) : {};
  const credentialInspection = credentialPath ? await inspectCredentialFile(credentialPath) : undefined;
  const result = evaluateV12Handoff({
    baseUrl,
    adminEmail,
    credentialPath,
    passwordDelivery,
    credentialInspection,
    ...probe,
  });

  await writeJson(output, result);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

async function probeStaging(baseUrl, authHeader) {
  const headers = authHeader ? { authorization: authHeader } : {};
  const healthResponse = await requestJson(new URL("/api/health", baseUrl), headers);
  const signInResponse = await requestText(new URL("/sign-in", baseUrl), headers);
  const appResponse = await requestText(new URL("/app", baseUrl), headers, "manual");
  const adminResponse = await requestText(new URL("/admin", baseUrl), headers, "manual");
  return {
    healthStatus: healthResponse.status,
    health: healthResponse.body,
    signInStatus: signInResponse.status,
    signInHtml: signInResponse.body,
    appStatus: appResponse.status,
    appLocation: appResponse.location,
    adminStatus: adminResponse.status,
    adminLocation: adminResponse.location,
  };
}

async function requestJson(url, headers) {
  try {
    const response = await fetch(url, { headers, redirect: "manual" });
    const text = await response.text();
    return { status: response.status, body: parseJson(text), location: response.headers.get("location") || "" };
  } catch (error) {
    return { status: 0, body: { error: error instanceof Error ? error.name : "FetchError" }, location: "" };
  }
}

async function requestText(url, headers, redirect = "follow") {
  try {
    const response = await fetch(url, { headers, redirect });
    return { status: response.status, body: await response.text(), location: response.headers.get("location") || "" };
  } catch (error) {
    return { status: 0, body: error instanceof Error ? error.name : "FetchError", location: "" };
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function basicAuthHeader(user, password) {
  if (!user || !password) return undefined;
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url") options.baseUrl = args[++index];
    else if (arg === "--output") options.output = args[++index];
    else if (arg === "--admin-email") options.adminEmail = args[++index];
    else if (arg === "--credential-path") options.credentialPath = args[++index];
    else if (arg === "--password-delivery") options.passwordDelivery = args[++index];
  }
  return options;
}

async function inspectCredentialFile(filePath) {
  try {
    const fileStat = await stat(path.resolve(filePath));
    const permissions = fileStat.mode & 0o777;
    return {
      checked: true,
      exists: fileStat.isFile(),
      privatePermissions: fileStat.isFile() && (permissions & 0o077) === 0,
      mode: `0${permissions.toString(8).padStart(3, "0")}`,
    };
  } catch {
    return {
      checked: true,
      exists: false,
      privatePermissions: false,
    };
  }
}

async function writeJson(filePath, data) {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function add(checks, id, ok, message) {
  checks.push({ id, ok: Boolean(ok), message });
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizePasswordDelivery(value, credentialPath) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "secure_channel") return "secure_channel";
  if (normalized === "server_file" || credentialPath) return "server_file";
  return "";
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (entryPath && existsSync(process.argv[1]) && path.resolve(process.argv[1]) === entryPath) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.name : "V12HandoffCheckError",
        message: "v1.2 handoff check failed before completion.",
      }),
    );
    process.exitCode = 1;
  });
}
