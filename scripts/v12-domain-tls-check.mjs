#!/usr/bin/env node

import dns from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUTPUT = "outputs/reports/v12-domain-tls-check.json";
const REQUEST_TIMEOUT_MS = 15_000;

export function evaluateDomainTlsReadiness({
  baseUrl,
  expectedIp,
  dnsResolution,
  httpRedirect,
  httpsUnauthStatus,
  httpsHealthStatus,
  httpsHealth,
  ipFallbackUrl,
  ipFallbackUnauthStatus,
  ipFallbackHealthStatus,
  ipFallbackHealth,
} = {}) {
  const checks = [];
  const normalizedBaseUrl = safeUrl(baseUrl);
  const normalizedIpFallbackUrl = safeUrl(ipFallbackUrl);
  const dnsRecord = record(dnsResolution);
  const redirectRecord = record(httpRedirect);
  const health = record(httpsHealth);
  const fallbackHealth = record(ipFallbackHealth);

  add(checks, "base_url_present", Boolean(baseUrl), "A staging domain URL is required.");
  add(checks, "base_url_https", isHttpsUrl(baseUrl), "The staging domain URL must use HTTPS.");
  add(checks, "base_url_uses_domain", isDomainUrl(baseUrl), "The staging URL must use a real domain, not an IP address.");
  add(checks, "expected_ip_declared", Boolean(expectedIp), "The expected server IP must be declared.");
  add(
    checks,
    "domain_resolves_expected_ip",
    Boolean(expectedIp && arrayOfStrings(dnsRecord.addresses).includes(expectedIp)),
    "The staging domain must resolve to the declared server IP.",
  );
  add(checks, "http_redirects_to_https", isHttpsRedirect(redirectRecord, baseUrl), "HTTP must redirect to the HTTPS staging URL.");
  add(checks, "https_unauth_401", httpsUnauthStatus === 401, "Unauthenticated HTTPS /api/health must return 401.");
  add(checks, "https_health_200", httpsHealthStatus === 200, "Authenticated HTTPS /api/health must return 200.");
  add(checks, "health_app_ok", health.app === "ok", "Health must report app=ok.");
  add(checks, "health_runner_configured", health.cadRunnerConfigured === true, "CAD runner must be configured.");
  add(checks, "health_llm_configured", health.llmConfigured === true, "LLM must be configured.");
  add(checks, "health_output_writable", health.outputDirWritable === true, "CAD output directory must be writable.");
  add(checks, "health_https_configured", health.httpsConfigured === true, "Health must report httpsConfigured=true.");
  add(checks, "health_access_mode_https", health.accessMode === "https", "Health must report accessMode=https.");
  add(checks, "health_no_warning", !health.warning, "Health must not return an HTTP exposure warning.");
  add(checks, "health_no_secret_markers", !containsSecretMarkers(health), "Health response must not contain secret markers.");

  if (ipFallbackUrl) {
    add(checks, "ip_fallback_url_safe", normalizedIpFallbackUrl !== "[invalid-url]", "The IP fallback URL must be valid when declared.");
    add(checks, "ip_fallback_unauth_401", ipFallbackUnauthStatus === 401, "Unauthenticated IP fallback /api/health must return 401.");
    add(checks, "ip_fallback_health_200", ipFallbackHealthStatus === 200, "Authenticated IP fallback /api/health must return 200.");
    add(checks, "ip_fallback_app_ok", fallbackHealth.app === "ok", "Authenticated IP fallback health must report app=ok.");
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    baseUrl: normalizedBaseUrl,
    expectedIp: expectedIp || "",
    ipFallbackUrl: normalizedIpFallbackUrl,
    observed: {
      dns: {
        hostname: stringValue(dnsRecord.hostname),
        addresses: arrayOfStrings(dnsRecord.addresses),
      },
      httpRedirect: {
        status: numberValue(redirectRecord.status),
        location: safeUrl(redirectRecord.location),
      },
      https: {
        unauthStatus: numberValue(httpsUnauthStatus),
        healthStatus: numberValue(httpsHealthStatus),
        app: stringValue(health.app),
        cadRunnerConfigured: health.cadRunnerConfigured === true,
        llmConfigured: health.llmConfigured === true,
        outputDirWritable: health.outputDirWritable === true,
        httpsConfigured: health.httpsConfigured === true,
        accessMode: stringValue(health.accessMode),
        warning: stringValue(health.warning),
        supportedTemplates: arrayOfStrings(health.supportedTemplates),
      },
      ipFallback: ipFallbackUrl
        ? {
            unauthStatus: numberValue(ipFallbackUnauthStatus),
            healthStatus: numberValue(ipFallbackHealthStatus),
            app: stringValue(fallbackHealth.app),
          }
        : undefined,
    },
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    checks,
  };
}

export function renderDomainTlsReadiness(report) {
  const observed = record(report?.observed);
  const dnsRecord = record(observed.dns);
  const redirect = record(observed.httpRedirect);
  const https = record(observed.https);
  const fallback = record(observed.ipFallback);
  const summary = record(report?.summary);
  const failed = arrayValue(report?.checks).filter((check) => check.ok !== true);
  const lines = [
    "# v1.2 Domain TLS Check",
    "",
    `Generated: ${stringValue(report?.generatedAt) || new Date().toISOString()}`,
    `Status: ${report?.ok === true ? "ready" : "not ready"}`,
    `Checks: ${numberValue(summary.passed)}/${numberValue(summary.total)} passed`,
    "",
    "## Access",
    "",
    `- Domain URL: ${stringValue(report?.baseUrl) || "not configured"}`,
    `- Expected IP: ${stringValue(report?.expectedIp) || "not declared"}`,
    `- DNS addresses: ${arrayOfStrings(dnsRecord.addresses).join(", ") || "none"}`,
    `- HTTP redirect: ${numberValue(redirect.status) || "n/a"} ${stringValue(redirect.location) || ""}`.trim(),
    `- HTTPS health: ${numberValue(https.healthStatus) || "n/a"}, app ${stringValue(https.app) || "unknown"}, accessMode ${
      stringValue(https.accessMode) || "unknown"
    }, httpsConfigured ${yesNo(https.httpsConfigured)}`,
    `- Warning: ${stringValue(https.warning) || "none"}`,
    `- IP fallback: ${stringValue(report?.ipFallbackUrl) || "not declared"}`,
    fallback.healthStatus ? `- IP fallback health: ${numberValue(fallback.healthStatus)}, app ${stringValue(fallback.app) || "unknown"}` : "",
    "",
    "## Blockers",
    "",
    ...(failed.length ? failed.map((check) => `- ${stringValue(check.id)}: ${stringValue(check.message)}`) : ["- None"]),
    "",
  ].filter((line) => line !== "");
  return `${redactSecrets(lines.join("\n"))}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = options.baseUrl || process.env.STAGING_BASE_URL || domainUrlFromEnv(process.env.STAGING_DOMAIN);
  const expectedIp = options.expectedIp || process.env.V12_EXPECTED_IP;
  const ipFallbackUrl = options.ipFallbackUrl || process.env.V12_IP_FALLBACK_URL;
  const authHeader = basicAuthHeader(process.env.STAGING_BASIC_AUTH_USER, process.env.STAGING_BASIC_AUTH_PASSWORD);
  const dnsResolution = baseUrl ? await resolveBaseUrlHost(baseUrl) : undefined;
  const httpRedirect = baseUrl ? await probeHttpRedirect(baseUrl) : undefined;
  const httpsUnauth = baseUrl ? await requestJson(new URL("/api/health", baseUrl), {}) : {};
  const httpsAuthenticated = baseUrl ? await requestJson(new URL("/api/health", baseUrl), authHeader ? { authorization: authHeader } : {}) : {};
  const ipFallbackUnauth = ipFallbackUrl ? await requestJson(new URL("/api/health", ipFallbackUrl), {}) : {};
  const ipFallbackAuthenticated = ipFallbackUrl
    ? await requestJson(new URL("/api/health", ipFallbackUrl), authHeader ? { authorization: authHeader } : {})
    : {};

  const result = evaluateDomainTlsReadiness({
    baseUrl,
    expectedIp,
    dnsResolution,
    httpRedirect,
    httpsUnauthStatus: httpsUnauth.status,
    httpsHealthStatus: httpsAuthenticated.status,
    httpsHealth: httpsAuthenticated.body,
    ipFallbackUrl,
    ipFallbackUnauthStatus: ipFallbackUnauth.status,
    ipFallbackHealthStatus: ipFallbackAuthenticated.status,
    ipFallbackHealth: ipFallbackAuthenticated.body,
  });
  const output = options.output || DEFAULT_OUTPUT;
  await writeJson(output, result);
  if (options.markdown) {
    await writeText(options.markdown, renderDomainTlsReadiness(result));
  }
  console.log(JSON.stringify({ ok: result.ok, output, markdown: options.markdown || "", failed: result.checks.filter((check) => !check.ok).map((check) => check.id) }));
  process.exitCode = result.ok ? 0 : 1;
}

async function resolveBaseUrlHost(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    if (isIP(hostname)) return { hostname, addresses: [hostname] };
    const records = await dns.lookup(hostname, { all: true });
    return { hostname, addresses: [...new Set(records.map((record) => record.address))] };
  } catch (error) {
    return { addresses: [], error: error instanceof Error ? error.name : "DnsResolutionError" };
  }
}

async function probeHttpRedirect(baseUrl) {
  try {
    const httpUrl = new URL(baseUrl);
    httpUrl.protocol = "http:";
    httpUrl.username = "";
    httpUrl.password = "";
    httpUrl.pathname = "/";
    httpUrl.search = "";
    const response = await fetch(httpUrl, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { status: response.status, location: safeUrl(response.headers.get("location") || "") };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.name : "FetchError" };
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

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url") options.baseUrl = args[++index];
    else if (arg === "--expected-ip") options.expectedIp = args[++index];
    else if (arg === "--ip-fallback-url") options.ipFallbackUrl = args[++index];
    else if (arg === "--output") options.output = args[++index];
    else if (arg === "--markdown") options.markdown = args[++index];
  }
  return options;
}

async function writeJson(filePath, data) {
  await writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(filePath, text) {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, redactSecrets(text), "utf8");
}

function basicAuthHeader(user, password) {
  if (!user || !password) return undefined;
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function domainUrlFromEnv(domain) {
  const value = stringValue(domain).trim();
  return value ? `https://${value}` : "";
}

function containsSecretMarkers(value) {
  return /sk-[A-Za-z0-9_-]{8,}|Bearer\s+|Basic\s+|CLERK_SECRET_KEY|DATABASE_URL|STAGING_BASIC_AUTH_PASSWORD/i.test(JSON.stringify(value || {}));
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
  const location = stringValue(redirect.location);
  if (!location.startsWith("https://")) return false;
  try {
    return new URL(location).hostname === new URL(baseUrl).hostname;
  } catch {
    return false;
  }
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

function redactSecrets(text) {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+(?!Auth\b)[A-Za-z0-9._~+/-]{6,}=*/gi, "Basic [redacted]")
    .replace(/("password"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/(password=)[^\s]+/gi, "$1[redacted]")
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
        error: error instanceof Error ? error.name : "DomainTlsCheckError",
        message: "v1.2 domain TLS check failed before completion.",
      }),
    );
    process.exitCode = 1;
  });
}
