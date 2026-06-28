#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_FILE = ".env";
const DEFAULT_OUTPUT = "outputs/reports/v12-env-audit.md";
const PLACEHOLDER_PATTERN = /^(replace|replace-|changeme|todo|example|your-|set-me|xxx)/i;

export function parseEnvText(text) {
  const env = {};
  for (const rawLine of stripBom(String(text || "")).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = unquote(line.slice(index + 1).trim());
    if (key) env[key] = value;
  }
  return env;
}

export function evaluateV12EnvAudit({ env = {}, envFile = ".env", envFileInfo, credentialFileInfo } = {}) {
  const checks = [];
  const stagingDomain = stringValue(env.STAGING_DOMAIN);
  const credentialPath =
    stringValue(env.ADMIN_BOOTSTRAP_CREDENTIAL_PATH) || stringValue(env.V12_ADMIN_CREDENTIAL_PATH) || stringValue(env.ADMIN_CREDENTIAL_PATH);
  const credentialInfo = record(credentialFileInfo);

  add(checks, "env_file_exists", envFileInfo?.exists === true, "Server-only .env must exist.");
  add(checks, "env_file_private", envFileInfo?.privatePermissions === true, "Server-only .env must be chmod 600 or stricter.");
  add(checks, "staging_domain_present", usableValue(stagingDomain), "STAGING_DOMAIN must be set to the real staging domain.");
  add(checks, "staging_domain_is_domain", usableValue(stagingDomain) && !isIP(stagingDomain), "STAGING_DOMAIN must be a domain, not a raw IP.");
  add(checks, "staging_https_enabled", env.STAGING_HTTPS_ENABLED === "1", "STAGING_HTTPS_ENABLED must be 1 after TLS is active.");
  add(checks, "staging_access_mode_https", env.STAGING_ACCESS_MODE === "https", "STAGING_ACCESS_MODE must be https for v1.2 handoff.");
  add(checks, "clerk_secret_configured", looksLikeSecret(env.CLERK_SECRET_KEY, "sk_"), "CLERK_SECRET_KEY must be configured.");
  add(
    checks,
    "clerk_publishable_configured",
    looksLikeSecret(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, "pk_"),
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be configured.",
  );
  add(checks, "dev_auth_bypass_disabled", !truthy(env.SAAS_DEV_AUTH_BYPASS), "SAAS_DEV_AUTH_BYPASS must not be enabled.");
  add(checks, "database_url_configured", usableValue(env.DATABASE_URL), "DATABASE_URL must be configured for Postgres.");
  add(checks, "database_url_not_placeholder", usableValue(env.DATABASE_URL) && !placeholder(env.DATABASE_URL), "DATABASE_URL must not be a placeholder.");
  add(checks, "basic_auth_user_configured", usableValue(env.STAGING_BASIC_AUTH_USER), "STAGING_BASIC_AUTH_USER should remain configured as the outer staging gate.");
  add(
    checks,
    "basic_auth_password_configured",
    usableValue(env.STAGING_BASIC_AUTH_PASSWORD),
    "STAGING_BASIC_AUTH_PASSWORD should remain configured as the outer staging gate.",
  );
  add(checks, "admin_email_configured", usableValue(env.ADMIN_BOOTSTRAP_EMAIL) || usableValue(env.V12_ADMIN_EMAIL), "Admin email must be declared.");
  add(checks, "admin_credential_path_configured", usableValue(credentialPath), "Admin credential delivery path must be declared.");
  if (credentialPath) {
    add(checks, "admin_credential_file_exists", credentialInfo.exists === true, "Admin credential file must exist after bootstrap.");
    add(
      checks,
      "admin_credential_file_private",
      credentialInfo.privatePermissions === true,
      "Admin credential file must be chmod 600 or stricter.",
    );
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    envFile,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    configured: {
      stagingDomain: usableValue(stagingDomain),
      stagingHttpsEnabled: env.STAGING_HTTPS_ENABLED === "1",
      accessMode: stringValue(env.STAGING_ACCESS_MODE) || "unknown",
      clerkSecret: usableValue(env.CLERK_SECRET_KEY),
      clerkPublishable: usableValue(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
      databaseUrl: usableValue(env.DATABASE_URL),
      basicAuth: usableValue(env.STAGING_BASIC_AUTH_USER) && usableValue(env.STAGING_BASIC_AUTH_PASSWORD),
      adminEmail: usableValue(env.ADMIN_BOOTSTRAP_EMAIL) || usableValue(env.V12_ADMIN_EMAIL),
      adminCredentialPath: usableValue(credentialPath),
    },
    files: {
      env: sanitizeFileInfo(envFileInfo),
      adminCredential: credentialPath ? sanitizeFileInfo(credentialFileInfo) : { checked: false, exists: false, privatePermissions: false, mode: "" },
    },
    checks,
  };
}

export function renderV12EnvAudit(report) {
  const summary = record(report?.summary);
  const configured = record(report?.configured);
  const files = record(report?.files);
  const envFile = record(files.env);
  const credentialFile = record(files.adminCredential);
  const failed = arrayValue(report?.checks).filter((check) => check.ok !== true);
  const lines = [
    "# v1.2 Server Env Audit",
    "",
    `Generated: ${stringValue(report?.generatedAt) || new Date().toISOString()}`,
    `Status: ${report?.ok === true ? "ready" : "not ready"}`,
    `Checks: ${numberValue(summary.passed)}/${numberValue(summary.total)} passed`,
    "",
    "## Configured",
    "",
    `- STAGING_DOMAIN: ${yesNo(configured.stagingDomain)}`,
    `- STAGING_HTTPS_ENABLED=1: ${yesNo(configured.stagingHttpsEnabled)}`,
    `- STAGING_ACCESS_MODE: ${stringValue(configured.accessMode) || "unknown"}`,
    `- Clerk secret: ${yesNo(configured.clerkSecret)}`,
    `- Clerk publishable key: ${yesNo(configured.clerkPublishable)}`,
    `- DATABASE_URL: ${yesNo(configured.databaseUrl)}`,
    `- Basic Auth gate: ${yesNo(configured.basicAuth)}`,
    `- Admin email: ${yesNo(configured.adminEmail)}`,
    `- Admin credential path: ${yesNo(configured.adminCredentialPath)}`,
    "",
    "## Files",
    "",
    `- .env exists: ${yesNo(envFile.exists)}, private: ${yesNo(envFile.privatePermissions)}, mode: ${stringValue(envFile.mode) || "unknown"}`,
    `- Admin credential exists: ${yesNo(credentialFile.exists)}, private: ${yesNo(credentialFile.privatePermissions)}, mode: ${
      stringValue(credentialFile.mode) || "unknown"
    }`,
    "",
    "## Blockers",
    "",
    ...(failed.length ? failed.map((check) => `- ${stringValue(check.id)}: ${stringValue(check.message)}`) : ["- None"]),
    "",
  ];
  return `${redactSecrets(lines.join("\n"))}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const envFile = options.envFile || DEFAULT_ENV_FILE;
  const envText = await readTextIfPresent(envFile);
  const env = parseEnvText(envText);
  const credentialPath = options.credentialPath || env.ADMIN_BOOTSTRAP_CREDENTIAL_PATH || env.V12_ADMIN_CREDENTIAL_PATH || "";
  const report = evaluateV12EnvAudit({
    env,
    envFile,
    envFileInfo: await inspectFile(envFile),
    credentialFileInfo: credentialPath ? await inspectFile(credentialPath) : undefined,
  });
  const output = options.output || DEFAULT_OUTPUT;
  await writeText(output, renderV12EnvAudit(report));
  if (options.json) {
    await writeText(options.json, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({ ok: report.ok, output, json: options.json || "", failed: report.checks.filter((check) => !check.ok).map((check) => check.id) }));
  process.exitCode = report.ok ? 0 : 1;
}

async function inspectFile(filePath) {
  try {
    const absolutePath = path.resolve(filePath);
    const fileStat = await stat(absolutePath);
    const mode = fileStat.mode & 0o777;
    return {
      checked: true,
      exists: fileStat.isFile(),
      privatePermissions: fileStat.isFile() && (mode & 0o077) === 0,
      mode: `0${mode.toString(8).padStart(3, "0")}`,
    };
  } catch {
    return { checked: true, exists: false, privatePermissions: false, mode: "" };
  }
}

async function readTextIfPresent(filePath) {
  try {
    return await readFile(path.resolve(filePath), "utf8");
  } catch {
    return "";
  }
}

async function writeText(filePath, text) {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, redactSecrets(text), "utf8");
}

function sanitizeFileInfo(value) {
  const info = record(value);
  return {
    checked: info.checked === true,
    exists: info.exists === true,
    privatePermissions: info.privatePermissions === true,
    mode: stringValue(info.mode),
  };
}

function add(checks, id, ok, message) {
  checks.push({ id, ok: Boolean(ok), message });
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--env-file") options.envFile = args[++index];
    else if (arg === "--credential-path") options.credentialPath = args[++index];
    else if (arg === "--output") options.output = args[++index];
    else if (arg === "--json") options.json = args[++index];
  }
  return options;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function looksLikeSecret(value, prefix) {
  const text = stringValue(value);
  return usableValue(text) && text.startsWith(prefix) && !placeholder(text);
}

function usableValue(value) {
  const text = stringValue(value).trim();
  return Boolean(text && !placeholder(text));
}

function placeholder(value) {
  return PLACEHOLDER_PATTERN.test(stringValue(value).trim());
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(stringValue(value).trim().toLowerCase());
}

function redactSecrets(text) {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/pk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+[A-Za-z0-9._~+/-]+=*/gi, "Basic [redacted]")
    .replace(/("password"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/(password=)[^\s]+/gi, "$1[redacted]")
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
if (entryPath && existsSync(process.argv[1]) && path.resolve(process.argv[1]) === entryPath) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.name : "V12EnvAuditError",
        message: "v1.2 server env audit failed before completion.",
      }),
    );
    process.exitCode = 1;
  });
}
