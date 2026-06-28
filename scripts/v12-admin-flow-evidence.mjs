#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_INPUT = "outputs/reports/v12-admin-flow-evidence.json";
const DEFAULT_OUTPUT = "outputs/reports/v12-admin-flow-verify.json";
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\bBasic\s+[A-Za-z0-9._~+/-]+=*/i,
  /CLERK_SECRET_KEY/i,
  /STAGING_BASIC_AUTH_PASSWORD/i,
  /ADMIN_BOOTSTRAP_PASSWORD/i,
  /"password"\s*:/i,
  /password\s*[:=]/i,
];

const REQUIRED_CHECKS = [
  {
    id: "admin_login",
    flag: "adminLoginVerified",
    message: "A real Clerk admin login must be verified.",
    predicate: (check) => check.ok === true,
  },
  {
    id: "admin_page_access",
    flag: "adminPageVerified",
    message: "The logged-in admin must be verified to access /admin.",
    predicate: (check) => check.ok === true && numberValue(check.status) === 200,
  },
  {
    id: "non_admin_admin_blocked",
    flag: "nonAdminBlockedVerified",
    message: "A signed-in non-admin user must be blocked from /admin.",
    predicate: (check) => {
      const status = numberValue(check.status);
      return check.ok === true && (status === 401 || status === 403 || isRedirectToApp(check));
    },
  },
  {
    id: "admin_project_create",
    flag: "adminProjectCreateVerified",
    message: "The admin must be verified to create a CAD project.",
    predicate: (check) => check.ok === true && [200, 201].includes(numberValue(check.status)) && Boolean(stringValue(check.projectId)),
  },
  {
    id: "admin_package_download",
    flag: "adminPackageDownloadVerified",
    message: "The admin must be verified to download their own package.zip.",
    predicate: (check) =>
      check.ok === true &&
      numberValue(check.status) === 200 &&
      stringValue(check.artifactName) === "package.zip" &&
      numberValue(check.bytes) > 0,
  },
  {
    id: "artifact_cross_owner_forbidden",
    flag: "artifactAuthzVerified",
    message: "Cross-owner artifact download must be verified to return 403.",
    predicate: (check) => check.ok === true && numberValue(check.status) === 403,
  },
];

export function evaluateAdminFlowEvidence(evidence, { expectedBaseUrl, expectedAdminEmail } = {}) {
  const evidenceRecord = record(evidence);
  const checksById = new Map(arrayValue(evidenceRecord.checks).map((check) => [stringValue(check.id), record(check)]));
  const issues = [];
  const safeChecks = [];
  const flags = {};
  const generatedAt = stringValue(evidenceRecord.generatedAt);
  const baseUrl = safeUrl(evidenceRecord.baseUrl);
  const adminEmail = normalizeEmail(evidenceRecord.adminEmail);
  const secretScan = scanForSecrets(evidenceRecord);

  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    issues.push({ id: "generated_at_missing", message: "Admin flow evidence must include a valid generatedAt timestamp." });
  }
  if (!baseUrl) {
    issues.push({ id: "base_url_missing", message: "Admin flow evidence must include the tested baseUrl." });
  }
  if (expectedBaseUrl && baseUrl && safeUrl(expectedBaseUrl) !== baseUrl) {
    issues.push({ id: "base_url_mismatch", message: "Admin flow evidence baseUrl must match the handoff base URL." });
  }
  if (!adminEmail) {
    issues.push({ id: "admin_email_missing", message: "Admin flow evidence must include the tested admin email." });
  }
  if (expectedAdminEmail && adminEmail && normalizeEmail(expectedAdminEmail) !== adminEmail) {
    issues.push({ id: "admin_email_mismatch", message: "Admin flow evidence adminEmail must match the declared handoff admin." });
  }
  if (secretScan.found) {
    issues.push({ id: "secret_like_value_detected", message: "Admin flow evidence must not include passwords, API keys, or auth headers." });
  }

  for (const requirement of REQUIRED_CHECKS) {
    const check = checksById.get(requirement.id);
    const ok = Boolean(check && requirement.predicate(check));
    flags[requirement.flag] = ok;
    if (!ok) {
      issues.push({ id: requirement.id, message: requirement.message });
    }
    safeChecks.push(sanitizeCheck(requirement.id, check, ok));
  }

  const result = {
    ok: issues.length === 0,
    generatedAt: new Date().toISOString(),
    evidenceGeneratedAt: generatedAt,
    baseUrl,
    adminEmail,
    flags,
    summary: {
      total: REQUIRED_CHECKS.length,
      passed: Object.values(flags).filter(Boolean).length,
      failed: REQUIRED_CHECKS.length - Object.values(flags).filter(Boolean).length,
    },
    checks: safeChecks,
    issues,
  };
  return JSON.parse(redactSecrets(JSON.stringify(result)));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = options.input || DEFAULT_INPUT;
  const output = options.output || DEFAULT_OUTPUT;
  const evidence = JSON.parse(stripBom(await readFile(input, "utf8")));
  const result = evaluateAdminFlowEvidence(evidence, {
    expectedBaseUrl: options.expectedBaseUrl,
    expectedAdminEmail: options.expectedAdminEmail,
  });
  await writeJson(output, result);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

function sanitizeCheck(id, check, ok) {
  const checkRecord = record(check);
  return {
    id,
    ok,
    status: numberOrUndefined(checkRecord.status),
    location: safePath(checkRecord.location),
    artifactName: stringValue(checkRecord.artifactName),
    bytes: numberOrUndefined(checkRecord.bytes),
    projectId: stringValue(checkRecord.projectId),
  };
}

function scanForSecrets(value) {
  const text = JSON.stringify(value);
  return { found: SECRET_PATTERNS.some((pattern) => pattern.test(text)) };
}

function isRedirectToApp(check) {
  const status = numberValue(check.status);
  const location = stringValue(check.location);
  return [302, 303, 307, 308].includes(status) && location.startsWith("/app");
}

function safePath(value) {
  const text = stringValue(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    return `${url.pathname}${url.search}`;
  } catch {
    return text.startsWith("/") ? text : "";
  }
}

function safeUrl(value) {
  const text = stringValue(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function normalizeEmail(value) {
  return stringValue(value).trim().toLowerCase();
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") options.input = args[++index];
    else if (arg === "--output") options.output = args[++index];
    else if (arg === "--expected-base-url") options.expectedBaseUrl = args[++index];
    else if (arg === "--expected-admin-email") options.expectedAdminEmail = args[++index];
  }
  return options;
}

async function writeJson(filePath, data) {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function redactSecrets(text) {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+[A-Za-z0-9._~+/-]+=*/gi, "Basic [redacted]")
    .replace(/(password\s*[:=]\s*)[^\s,"}]+/gi, "$1[redacted]");
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

function numberOrUndefined(value) {
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (entryPath && path.resolve(process.argv[1]) === entryPath) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.name : "AdminFlowEvidenceError",
        message: "Admin flow evidence verification failed.",
      }),
    );
    process.exitCode = 1;
  });
}
