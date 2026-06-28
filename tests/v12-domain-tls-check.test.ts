import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDomainTlsReadiness, renderDomainTlsReadiness } from "../scripts/v12-domain-tls-check.mjs";

test("domain TLS check accepts a real HTTPS domain posture", () => {
  const result = evaluateDomainTlsReadiness({
    baseUrl: "https://cad-agent.example.com",
    expectedIp: "203.0.113.10",
    dnsResolution: { hostname: "cad-agent.example.com", addresses: ["203.0.113.10"] },
    httpRedirect: { status: 308, location: "https://cad-agent.example.com/" },
    httpsUnauthStatus: 401,
    httpsHealthStatus: 200,
    httpsHealth: {
      app: "ok",
      cadRunnerConfigured: true,
      llmConfigured: true,
      outputDirWritable: true,
      httpsConfigured: true,
      accessMode: "https",
      supportedTemplates: ["mounting_plate", "l_bracket"],
    },
    ipFallbackUrl: "http://203.0.113.10:12602",
    ipFallbackUnauthStatus: 401,
    ipFallbackHealthStatus: 200,
    ipFallbackHealth: { app: "ok" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.failed, 0);

  const markdown = renderDomainTlsReadiness(result);
  assert.match(markdown, /Status: ready/);
  assert.match(markdown, /Domain URL: https:\/\/cad-agent\.example\.com/);
  assert.match(markdown, /HTTPS health: 200, app ok, accessMode https, httpsConfigured yes/);
});

test("domain TLS check rejects current HTTP or unconfigured domain posture without leaking secrets", () => {
  const result = evaluateDomainTlsReadiness({
    baseUrl: "http://43.138.153.37:12602",
    expectedIp: "43.138.153.37",
    dnsResolution: { hostname: "43.138.153.37", addresses: ["43.138.153.37"] },
    httpRedirect: { status: 0 },
    httpsUnauthStatus: 401,
    httpsHealthStatus: 200,
    httpsHealth: {
      app: "ok",
      cadRunnerConfigured: true,
      llmConfigured: true,
      outputDirWritable: true,
      httpsConfigured: false,
      accessMode: "http_restricted",
      warning: "Staging is running without HTTPS domain; restrict access.",
      CLERK_SECRET_KEY: "sk-test-should-not-leak",
    },
  });

  assert.equal(result.ok, false);
  const failed = result.checks.filter((check) => !check.ok).map((check) => check.id).join(",");
  assert.match(failed, /base_url_https/);
  assert.match(failed, /base_url_uses_domain/);
  assert.match(failed, /health_https_configured/);
  assert.match(failed, /health_access_mode_https/);
  assert.match(failed, /health_no_secret_markers/);

  const markdown = renderDomainTlsReadiness(result);
  assert.match(markdown, /Status: not ready/);
  assert.equal(markdown.includes("sk-test-should-not-leak"), false);
});
