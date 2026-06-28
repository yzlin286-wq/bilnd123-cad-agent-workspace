#!/usr/bin/env node

import dns from "node:dns/promises";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateAdminFlowEvidence } from "./v12-admin-flow-evidence.mjs";

const DEFAULT_OUTPUT = "outputs/reports/v12-handoff-check.json";
const REQUEST_TIMEOUT_MS = 15_000;

export function evaluateV12Handoff({
  baseUrl,
  expectedIp,
  dnsResolution,
  httpRedirect,
  ipFallbackUrl,
  ipFallbackUnauthStatus,
  ipFallbackHealthStatus,
  ipFallbackHealth,
  healthStatus,
  health,
  signInStatus,
  signInHtml = "",
  signUpStatus,
  signUpHtml = "",
  appStatus,
  appLocation,
  adminStatus,
  adminLocation,
  projectsApiStatus,
  projectsApiLocation,
  adminEmail,
  credentialPath,
  passwordDelivery,
  credentialInspection,
  adminVerifyPath,
  adminVerification,
  adminFlowEvidencePath,
  adminFlowEvidence,
  expectedCommit,
  adminLoginVerified,
  adminPageVerified,
  nonAdminBlockedVerified,
  adminProjectCreateVerified,
  adminPackageDownloadVerified,
  artifactAuthzVerified,
} = {}) {
  const checks = [];
  const normalizedBaseUrl = safeUrl(baseUrl);
  const normalizedIpFallbackUrl = safeUrl(ipFallbackUrl);
  const healthRecord = record(health);
  const fallbackHealthRecord = record(ipFallbackHealth);
  const dataLayer = record(healthRecord.dataLayer);
  const auth = record(healthRecord.auth);
  const build = record(healthRecord.build);
  const dnsRecord = record(dnsResolution);
  const httpRedirectRecord = record(httpRedirect);
  const normalizedExpectedCommit = normalizeCommitSha(expectedCommit);
  const deployedCommit = normalizeCommitSha(build.commitSha);
  const normalizedDelivery = normalizePasswordDelivery(passwordDelivery, credentialPath);
  const credentialRecord = record(credentialInspection);
  const adminVerificationRecord = record(adminVerification);
  const adminVerificationEvidence = record(adminVerificationRecord.evidence);
  const declaredAdminEmail = normalizeEmail(adminEmail);
  const verifiedAdminEmail = normalizeEmail(adminVerificationRecord.adminEmail);
  const adminVerificationMatchesDeclaredEmail = Boolean(
    declaredAdminEmail && verifiedAdminEmail && declaredAdminEmail === verifiedAdminEmail,
  );
  const adminFlowEvidenceRecord = record(adminFlowEvidence);
  const adminFlowEvidenceBuild = record(adminFlowEvidenceRecord.build);

  add(checks, "base_url_present", Boolean(baseUrl), "A staging base URL is required.");
  add(checks, "base_url_https", isHttpsUrl(baseUrl), "The v1.2 handoff URL must use HTTPS.");
  add(checks, "base_url_uses_domain", isDomainUrl(baseUrl), "The v1.2 handoff URL must use a real domain, not an IP address.");
  add(checks, "expected_ip_declared", Boolean(expectedIp), "The staging server public IP must be declared.");
  add(
    checks,
    "domain_resolves_expected_ip",
    Boolean(expectedIp && dnsRecord.addresses?.includes(expectedIp)),
    "The staging domain must resolve to the declared server IP.",
  );
  add(
    checks,
    "http_redirects_to_https",
    isHttpsRedirect(httpRedirectRecord, baseUrl),
    "HTTP must redirect to the HTTPS staging URL.",
  );
  if (ipFallbackUrl) {
    add(checks, "ip_fallback_url_safe", normalizedIpFallbackUrl !== "[invalid-url]", "The IP fallback URL must be valid when declared.");
    add(checks, "ip_fallback_unauth_401", ipFallbackUnauthStatus === 401, "Unauthenticated IP fallback /api/health must return 401.");
    add(checks, "ip_fallback_health_200", ipFallbackHealthStatus === 200, "Authenticated IP fallback /api/health must return 200.");
    add(checks, "ip_fallback_app_ok", fallbackHealthRecord.app === "ok", "Authenticated IP fallback health must report app=ok.");
  }
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
  add(checks, "expected_commit_declared", Boolean(normalizedExpectedCommit), "The expected deployed commit must be declared.");
  add(checks, "health_commit_reported", Boolean(deployedCommit), "Health must report the deployed commit.");
  add(
    checks,
    "health_commit_matches_expected",
    commitsMatch(deployedCommit, normalizedExpectedCommit),
    "Health deployed commit must match the expected handoff commit.",
  );
  add(
    checks,
    "clerk_sign_in_rendered",
    signInStatus === 200 && !signInHtml.includes("Clerk is not configured"),
    "The sign-in page must render real Clerk UI, not the placeholder.",
  );
  add(
    checks,
    "clerk_sign_up_rendered",
    signUpStatus === 200 && !signUpHtml.includes("Clerk is not configured"),
    "The sign-up page must render real Clerk UI, not the placeholder.",
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
  add(
    checks,
    "projects_api_requires_clerk_session",
    isProtectedResponse(projectsApiStatus, projectsApiLocation),
    "With the outer staging gate satisfied but no Clerk session, /api/projects must reject the request.",
  );
  add(checks, "admin_email_declared", Boolean(adminEmail), "A Clerk admin email must be declared for handoff.");
  add(
    checks,
    "clerk_admin_email_matches",
    adminVerificationMatchesDeclaredEmail,
    "The Clerk admin verification report must match the declared admin email.",
  );
  add(checks, "admin_password_delivery_declared", Boolean(normalizedDelivery), "A one-time admin password delivery method must be declared.");
  if (normalizedDelivery === "server_file") {
    add(checks, "admin_credential_file_exists", credentialRecord.exists === true, "The server-only admin credential file must exist.");
    add(
      checks,
      "admin_credential_file_private",
      credentialRecord.privatePermissions === true,
      "The server-only admin credential file must not allow group or world access.",
    );
    add(
      checks,
      "admin_credential_email_matches",
      credentialRecord.emailMatches === true,
      "The server-only admin credential file must contain the declared admin identity.",
    );
    add(
      checks,
      "admin_credential_password_present",
      credentialRecord.passwordPresent === true,
      "The server-only admin credential file must contain an initial password.",
    );
    add(
      checks,
      "admin_credential_rotation_required",
      credentialRecord.rotationRequired === true,
      "The server-only admin credential file must require password rotation.",
    );
  }
  if (normalizedDelivery === "secure_channel") {
    add(checks, "admin_password_secure_channel_declared", true, "A secure one-time password channel was declared.");
  }
  add(
    checks,
    "clerk_admin_identity_verified",
    adminVerificationRecord.ok === true && adminVerificationEvidence.adminAuthorized === true && adminVerificationMatchesDeclaredEmail,
    "The declared admin must be verified through Clerk Backend API and authorized as admin.",
  );
  add(
    checks,
    "admin_flow_evidence_verified",
    adminFlowEvidenceRecord.ok === true,
    "A sanitized admin flow evidence report must verify the real admin login and artifact flow.",
  );
  add(checks, "admin_login_verified", adminLoginVerified === true, "A real Clerk admin login must be verified.");
  add(checks, "admin_page_verified", adminPageVerified === true, "The logged-in admin must be verified to access /admin.");
  add(checks, "non_admin_admin_blocked", nonAdminBlockedVerified === true, "A non-admin Clerk user must be blocked from /admin.");
  add(
    checks,
    "admin_project_create_verified",
    adminProjectCreateVerified === true,
    "The admin must be verified to create a CAD project.",
  );
  add(
    checks,
    "admin_package_download_verified",
    adminPackageDownloadVerified === true,
    "The admin must be verified to download their own package.zip.",
  );
  add(
    checks,
    "artifact_cross_owner_forbidden",
    artifactAuthzVerified === true,
    "Cross-owner artifact download must be verified to return 403.",
  );

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    baseUrl: normalizedBaseUrl,
    expectedIp: expectedIp || "",
    ipFallbackUrl: normalizedIpFallbackUrl,
    observed: {
      domainUrl: isHttpsUrl(baseUrl) && isDomainUrl(baseUrl) ? normalizedBaseUrl : "",
      ipAddress: expectedIp || "",
      ipFallbackUrl: normalizedIpFallbackUrl,
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
        projectStore: stringValue(dataLayer.projectStore),
        schemaReady: dataLayer.schemaReady === true,
        requiredTables: arrayOfStrings(dataLayer.requiredTables),
        missingTables: arrayOfStrings(dataLayer.missingTables),
      },
      build: {
        expectedCommit: normalizedExpectedCommit,
        deployedCommit,
      },
      admin: {
        email: stringValue(adminEmail),
        passwordDelivery: normalizedDelivery,
        credentialPath: normalizedDelivery === "server_file" ? stringValue(credentialPath) : "",
        verifyPath: stringValue(adminVerifyPath),
        flowEvidencePath: stringValue(adminFlowEvidencePath),
        clerkIdentityVerified: adminVerificationRecord.ok === true,
        clerkAdminAuthorized: adminVerificationEvidence.adminAuthorized === true,
        verifiedEmail: verifiedAdminEmail,
        userId: stringValue(adminVerificationRecord.userId),
      },
      verification: {
        adminLoginVerified: adminLoginVerified === true,
        adminPageVerified: adminPageVerified === true,
        nonAdminBlockedVerified: nonAdminBlockedVerified === true,
        adminProjectCreateVerified: adminProjectCreateVerified === true,
        adminPackageDownloadVerified: adminPackageDownloadVerified === true,
        artifactAuthzVerified: artifactAuthzVerified === true,
        evidenceVerified: adminFlowEvidenceRecord.ok === true,
        evidenceGeneratedAt: stringValue(adminFlowEvidenceRecord.evidenceGeneratedAt),
        evidenceCommit: normalizeCommitSha(adminFlowEvidenceBuild.deployedCommit),
      },
    },
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
  const expectedIp = options.expectedIp || process.env.V12_EXPECTED_IP;
  const expectedCommit = options.expectedCommit || process.env.V12_EXPECTED_COMMIT || process.env.APP_COMMIT_SHA;
  const ipFallbackUrl = options.ipFallbackUrl || process.env.V12_IP_FALLBACK_URL;
  const adminEmail = options.adminEmail || process.env.ADMIN_BOOTSTRAP_EMAIL || process.env.V12_ADMIN_EMAIL;
  const credentialPath = options.credentialPath || process.env.ADMIN_BOOTSTRAP_CREDENTIAL_PATH || process.env.V12_ADMIN_CREDENTIAL_PATH;
  const passwordDelivery =
    options.passwordDelivery || process.env.ADMIN_BOOTSTRAP_PASSWORD_DELIVERY || process.env.V12_ADMIN_PASSWORD_DELIVERY;
  const authHeader = basicAuthHeader(process.env.STAGING_BASIC_AUTH_USER, process.env.STAGING_BASIC_AUTH_PASSWORD);
  const probe = baseUrl ? await probeStaging(baseUrl, authHeader) : {};
  const dnsResolution = baseUrl ? await resolveBaseUrlHost(baseUrl) : undefined;
  const httpRedirect = baseUrl ? await probeHttpRedirect(baseUrl) : undefined;
  const ipFallbackProbe = ipFallbackUrl ? await probeIpFallback(ipFallbackUrl, authHeader) : {};
  const credentialInspection = credentialPath ? await inspectCredentialFile(credentialPath, adminEmail) : undefined;
  const adminVerifyPath = options.adminVerifyPath || process.env.V12_ADMIN_VERIFY_PATH;
  const adminVerification = adminVerifyPath ? await readJsonIfPresent(adminVerifyPath) : undefined;
  const adminFlowEvidencePath = options.adminFlowEvidencePath || process.env.V12_ADMIN_FLOW_EVIDENCE_PATH;
  const adminFlowEvidence = adminFlowEvidencePath
    ? evaluateAdminFlowEvidence(await readJsonIfPresent(adminFlowEvidencePath), {
        expectedBaseUrl: baseUrl,
        expectedAdminEmail: adminEmail,
        expectedCommit,
      })
    : undefined;
  const adminFlowFlags = record(adminFlowEvidence?.flags);
  const result = evaluateV12Handoff({
    baseUrl,
    expectedIp,
    ipFallbackUrl,
    adminEmail,
    credentialPath,
    passwordDelivery,
    adminVerifyPath,
    adminVerification,
    adminFlowEvidencePath,
    adminFlowEvidence,
    expectedCommit,
    adminLoginVerified: adminFlowFlags.adminLoginVerified === true,
    adminPageVerified: adminFlowFlags.adminPageVerified === true,
    nonAdminBlockedVerified: adminFlowFlags.nonAdminBlockedVerified === true,
    adminProjectCreateVerified: adminFlowFlags.adminProjectCreateVerified === true,
    adminPackageDownloadVerified: adminFlowFlags.adminPackageDownloadVerified === true,
    artifactAuthzVerified: adminFlowFlags.artifactAuthzVerified === true,
    dnsResolution,
    httpRedirect,
    ...ipFallbackProbe,
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
  const signUpResponse = await requestText(new URL("/sign-up", baseUrl), headers);
  const appResponse = await requestText(new URL("/app", baseUrl), headers, "manual");
  const adminResponse = await requestText(new URL("/admin", baseUrl), headers, "manual");
  const projectsApiResponse = await requestJson(new URL("/api/projects", baseUrl), headers);
  return {
    healthStatus: healthResponse.status,
    health: healthResponse.body,
    signInStatus: signInResponse.status,
    signInHtml: signInResponse.body,
    signUpStatus: signUpResponse.status,
    signUpHtml: signUpResponse.body,
    appStatus: appResponse.status,
    appLocation: appResponse.location,
    adminStatus: adminResponse.status,
    adminLocation: adminResponse.location,
    projectsApiStatus: projectsApiResponse.status,
    projectsApiLocation: projectsApiResponse.location,
  };
}

async function probeIpFallback(ipFallbackUrl, authHeader) {
  const unauth = await requestJson(new URL("/api/health", ipFallbackUrl), {});
  const authenticated = await requestJson(new URL("/api/health", ipFallbackUrl), authHeader ? { authorization: authHeader } : {});
  return {
    ipFallbackUnauthStatus: unauth.status,
    ipFallbackHealthStatus: authenticated.status,
    ipFallbackHealth: authenticated.body,
  };
}

async function probeHttpRedirect(baseUrl) {
  try {
    const httpsUrl = new URL(baseUrl);
    const httpUrl = new URL(baseUrl);
    httpUrl.protocol = "http:";
    httpUrl.username = "";
    httpUrl.password = "";
    httpUrl.pathname = "/";
    httpUrl.search = "";
    const response = await fetch(httpUrl, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return {
      status: response.status,
      location: safeUrl(response.headers.get("location") || ""),
      expectedPrefix: safeUrl(httpsUrl.toString()),
    };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.name : "FetchError" };
  }
}

async function resolveBaseUrlHost(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    if (isIP(hostname)) {
      return { hostname, addresses: [hostname] };
    }
    const records = await dns.lookup(hostname, { all: true });
    return { hostname, addresses: [...new Set(records.map((record) => record.address))] };
  } catch (error) {
    return { addresses: [], error: error instanceof Error ? error.name : "DnsResolutionError" };
  }
}

async function requestJson(url, headers) {
  try {
    const response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await response.text();
    return { status: response.status, body: parseJson(text), location: response.headers.get("location") || "" };
  } catch (error) {
    return { status: 0, body: { error: error instanceof Error ? error.name : "FetchError" }, location: "" };
  }
}

async function requestText(url, headers, redirect = "follow") {
  try {
    const response = await fetch(url, { headers, redirect, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
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
    else if (arg === "--expected-ip") options.expectedIp = args[++index];
    else if (arg === "--expected-commit") options.expectedCommit = args[++index];
    else if (arg === "--ip-fallback-url") options.ipFallbackUrl = args[++index];
    else if (arg === "--admin-email") options.adminEmail = args[++index];
    else if (arg === "--credential-path") options.credentialPath = args[++index];
    else if (arg === "--password-delivery") options.passwordDelivery = args[++index];
    else if (arg === "--admin-verify-path") options.adminVerifyPath = args[++index];
    else if (arg === "--admin-flow-evidence-path") options.adminFlowEvidencePath = args[++index];
  }
  return options;
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  } catch {
    return undefined;
  }
}

export async function inspectCredentialFile(filePath, adminEmail) {
  try {
    const absolutePath = path.resolve(filePath);
    const fileStat = await stat(absolutePath);
    const permissions = fileStat.mode & 0o777;
    const text = fileStat.isFile() ? await readFile(absolutePath, "utf8") : "";
    const credential = parseCredentialFile(text);
    const declaredEmail = normalizeEmail(adminEmail);
    return {
      checked: true,
      exists: fileStat.isFile(),
      privatePermissions: fileStat.isFile() && (permissions & 0o077) === 0,
      emailMatches: Boolean(declaredEmail && credential.identity === declaredEmail),
      passwordPresent: credential.passwordPresent === true,
      rotationRequired: credential.rotationRequired === true,
      mode: `0${permissions.toString(8).padStart(3, "0")}`,
    };
  } catch {
    return {
      checked: true,
      exists: false,
      privatePermissions: false,
      emailMatches: false,
      passwordPresent: false,
      rotationRequired: false,
    };
  }
}

function parseCredentialFile(text) {
  const parsed = { identity: "", passwordPresent: false, rotationRequired: false };
  for (const line of String(text || "").split(/\r?\n/)) {
    const equalsSeparator = line.indexOf("=");
    const colonSeparator = line.indexOf(":");
    const separator =
      equalsSeparator >= 0 && (colonSeparator < 0 || equalsSeparator < colonSeparator) ? equalsSeparator : colonSeparator;
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "email" || key === "user" || key === "username") parsed.identity = normalizeEmail(value);
    if (key === "password") parsed.passwordPresent = Boolean(value);
    if (key === "rotation_required") parsed.rotationRequired = value.toLowerCase() === "yes";
  }
  return parsed;
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

function isDomainUrl(value) {
  try {
    const { hostname } = new URL(value);
    return Boolean(hostname && !isIP(hostname));
  } catch {
    return false;
  }
}

function isHttpsRedirect(redirect, baseUrl) {
  if (![301, 302, 307, 308].includes(Number(redirect.status))) return false;
  const location = typeof redirect.location === "string" ? redirect.location : "";
  if (!location.startsWith("https://")) return false;
  try {
    return new URL(location).hostname === new URL(baseUrl).hostname;
  } catch {
    return false;
  }
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeCommitSha(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{7,40}$/.test(normalized) ? normalized : "";
}

function commitsMatch(deployedCommit, expectedCommit) {
  if (!deployedCommit || !expectedCommit) return false;
  return deployedCommit === expectedCommit || deployedCommit.startsWith(expectedCommit) || expectedCommit.startsWith(deployedCommit);
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
