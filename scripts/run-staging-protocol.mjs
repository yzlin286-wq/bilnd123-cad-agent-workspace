#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listZipEntries } from "./zip-entries.mjs";

const DEFAULT_PROTOCOL_PATH = path.resolve(process.cwd(), "docs", "STAGING_TEST_PROTOCOL.md");
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), "outputs", "protocol", "latest.json");
const DEFAULT_EXECUTE_DELAY_MS = 6500;
const REQUIRED_ARTIFACT_KINDS = ["step", "stl", "drawingSvg", "source", "spec", "validation", "manifest", "package"];
const REQUIRED_PACKAGE_ENTRIES = ["model.step", "model.stl", "drawing.svg", "source.py", "spec.json", "validation.json", "manifest.json"];

const REVISION_CASES = {
  11: {
    seed: "mounting_plate",
    preserved: ["length", "width", "holeDiameter", "edgeOffset", "chamfer"],
    changed: { thickness: 6 },
  },
  12: {
    seed: "mounting_plate",
    preserved: ["length", "width", "thickness", "holeDiameter", "edgeOffset"],
    changed: { chamfer: 2 },
    seedPrompt: "Make a 120 x 80 x 6 mm mounting plate with four 4.5 mm holes, 10 mm edge offset, and 1 mm chamfer.",
  },
  13: {
    seed: "l_bracket",
    preserved: ["length", "width", "thickness", "holeDiameter", "edgeOffset", "chamfer"],
    changed: { height: 80 },
  },
  14: {
    seed: "l_bracket",
    preserved: ["length", "height", "width", "thickness", "edgeOffset", "chamfer"],
    changed: { holeDiameter: 6 },
  },
  15: {
    seed: "mounting_plate",
    preserved: ["length", "width", "thickness", "holeDiameter", "edgeOffset", "chamfer"],
    changed: { materialIncludes: "stainless" },
  },
};

const EXPECTED_FAILURE_BY_CATEGORY = {
  "unsupported partType": "UNSUPPORTED_PART_TYPE",
  "parameter conflict": "PARAMETER_CONFLICT",
};

export async function loadProtocol({ protocolPath = DEFAULT_PROTOCOL_PATH } = {}) {
  return parseProtocolMarkdown(await fs.readFile(protocolPath, "utf8"));
}

export function parseProtocolMarkdown(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim());
      return {
        id: Number(cells[0]),
        category: sanitizeProtocolText(cells[1]),
        prompt: sanitizeProtocolText(stripMarkdown(cells[2])),
        expectedResult: sanitizeProtocolText(stripMarkdown(cells[3])),
      };
    })
    .filter((item) => Number.isFinite(item.id) && item.category && item.prompt);
}

export async function runStagingProtocol({
  protocolPath = DEFAULT_PROTOCOL_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  execute = false,
  baseUrl = process.env.STAGING_BASE_URL,
  delayMs = DEFAULT_EXECUTE_DELAY_MS,
} = {}) {
  const protocol = await loadProtocol({ protocolPath });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const results = execute ? await executeProtocol(protocol, requiredBaseUrl(baseUrl), Number(delayMs || 0)) : [];
  const payload = {
    warning: execute ? "Execution calls the real staging service and can incur model/API and CAD runner cost." : undefined,
    startedAt,
    generatedAt: new Date().toISOString(),
    executed: execute,
    count: protocol.length,
    protocol,
    results,
    summary: summarizeProtocolResults(protocol, results, execute),
    durationMs: Date.now() - startedMs,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export function summarizeProtocolResults(protocol, results, executed = false) {
  if (!executed) {
    return {
      total: protocol.length,
      passed: 0,
      failed: 0,
      expectedFailureCasesPassed: 0,
      expectedFailures: 0,
      unexpectedFailures: 0,
    };
  }
  const failedResults = results.filter((result) => !result.ok);
  return {
    total: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: failedResults.length,
    expectedFailureCasesPassed: results.filter((result) => result.ok && result.failureClass === "expected_failure").length,
    expectedFailures: failedResults.filter((result) => result.failureClass === "expected_failure").length,
    unexpectedFailures: failedResults.filter((result) => result.failureClass === "unexpected_failure").length,
  };
}

export function sanitizeProtocolText(value, maxChars = 500) {
  const sanitized = String(value || "")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted-api-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/Basic\s+(?!Auth\b)[A-Za-z0-9+/=-]{6,}/gi, "Basic [redacted]")
    .replace(/(password|api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length <= maxChars) return sanitized;
  return `${sanitized.slice(0, maxChars)}...`;
}

async function executeProtocol(protocol, baseUrl, delayMs) {
  const results = [];
  for (let index = 0; index < protocol.length; index += 1) {
    const item = protocol[index];
    const startedAt = Date.now();
    try {
      const evaluation = await executeProtocolItem(item, baseUrl);
      results.push({
        id: item.id,
        category: item.category,
        expectedResult: item.expectedResult,
        ok: evaluation.ok,
        failureClass: evaluation.failureClass,
        status: evaluation.status,
        errorCode: evaluation.errorCode,
        userMessage: sanitizeProtocolText(evaluation.userMessage, 240) || undefined,
        revisionId: evaluation.revisionId,
        seedRevisionId: evaluation.seedRevisionId,
        validationPassed: evaluation.validationPassed,
        artifactCount: evaluation.artifactCount,
        packageVerified: evaluation.packageVerified,
        checks: evaluation.checks,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      results.push({
        id: item.id,
        category: item.category,
        expectedResult: item.expectedResult,
        ok: false,
        failureClass: "unexpected_failure",
        status: "protocol_error",
        errorCode: "PROTOCOL_EXECUTION_FAILED",
        userMessage: sanitizeProtocolText(error instanceof Error ? error.message : "Protocol execution failed.", 240),
        checks: [],
        durationMs: Date.now() - startedAt,
      });
    }
    if (delayMs > 0 && index < protocol.length - 1) {
      await sleep(delayMs);
    }
  }
  return results;
}

async function executeProtocolItem(item, baseUrl) {
  if (item.category === "revision") {
    return executeRevisionCase(item, baseUrl);
  }
  if (EXPECTED_FAILURE_BY_CATEGORY[item.category]) {
    return executeExpectedFailureCase(item, baseUrl, EXPECTED_FAILURE_BY_CATEGORY[item.category]);
  }
  return executeSuccessCase(item, baseUrl);
}

async function executeSuccessCase(item, baseUrl) {
  const response = await postSSE(baseUrl, "/api/agent/run", { prompt: item.prompt });
  if (response.error) {
    return failedEvaluation("unexpected_failure", "agent_error", response.error.code, response.error.userMessage, [
      check("agent produced revision", true, false),
    ]);
  }
  return evaluateSuccessfulRevision({
    item,
    baseUrl,
    revision: response.revision,
    expectedPartType: expectedPartTypeFor(item),
  });
}

async function executeExpectedFailureCase(item, baseUrl, expectedErrorCode) {
  const response = await postSSE(baseUrl, "/api/agent/run", { prompt: item.prompt });
  if (!response.error) {
    return failedEvaluation("unexpected_failure", "unexpected_revision", "EXPECTED_FAILURE_NOT_RAISED", "A protocol case expected failure but generated CAD.", [
      check("expected failure was raised", expectedErrorCode, "revision"),
    ]);
  }

  const checks = [
    check("expected error code", expectedErrorCode, response.error.code),
    check("no revision generated", true, !response.revision),
  ];
  const ok = checks.every((item) => item.passed);
  return {
    ok,
    failureClass: ok ? "expected_failure" : "unexpected_failure",
    status: ok ? "expected_failure" : "wrong_failure",
    errorCode: response.error.code,
    userMessage: response.error.userMessage,
    checks,
  };
}

async function executeRevisionCase(item, baseUrl) {
  const revisionCase = REVISION_CASES[item.id];
  if (!revisionCase) {
    return failedEvaluation("unexpected_failure", "protocol_error", "REVISION_CASE_NOT_CONFIGURED", "Revision protocol case is not configured.", []);
  }

  const seed = await postSSE(baseUrl, "/api/agent/run", { prompt: revisionCase.seedPrompt || seedPromptFor(revisionCase.seed) });
  if (seed.error || !seed.revision) {
    return failedEvaluation("unexpected_failure", "seed_failed", seed.error?.code || "SEED_REVISION_FAILED", seed.error?.userMessage, [
      check("seed revision generated", true, false),
    ]);
  }

  const revisionPrompt = extractRevisionPrompt(item.prompt);
  const revised = await postSSE(baseUrl, "/api/agent/revise", {
    projectId: seed.projectId,
    currentSpec: seed.revision.engineeringSpec,
    currentRevisionId: seed.revision.id,
    userPrompt: revisionPrompt,
  });
  if (revised.error || !revised.revision) {
    return failedEvaluation("unexpected_failure", "revision_failed", revised.error?.code || "REVISION_FAILED", revised.error?.userMessage, [
      check("revision generated", true, false),
    ]);
  }

  const checks = [
    check("validation passed", true, Boolean(revised.revision.validation?.passed)),
    check("partType preserved", seed.revision.engineeringSpec.partType, revised.revision.engineeringSpec.partType),
    ...preservationChecks(seed.revision.engineeringSpec, revised.revision.engineeringSpec, revisionCase.preserved),
    ...changedChecks(revised.revision.engineeringSpec, revisionCase.changed),
  ];
  checks.push(...artifactChecks(revised.revision));
  const packageCheck = await verifyPackageArtifact(baseUrl, revised.revision);
  checks.push(...packageCheck.checks);

  const ok = checks.every((item) => item.passed);
  return {
    ok,
    failureClass: ok ? undefined : "unexpected_failure",
    status: ok ? "revision_passed" : "revision_failed_checks",
    errorCode: ok ? undefined : "PROTOCOL_REVISION_CHECK_FAILED",
    userMessage: ok ? undefined : "Revision protocol checks failed.",
    revisionId: revised.revision.id,
    seedRevisionId: seed.revision.id,
    validationPassed: Boolean(revised.revision.validation?.passed),
    artifactCount: revised.revision.artifacts?.length ?? 0,
    packageVerified: packageCheck.ok,
    checks,
  };
}

async function evaluateSuccessfulRevision({ item, baseUrl, revision, expectedPartType }) {
  if (!revision) {
    return failedEvaluation("unexpected_failure", "missing_revision", "MISSING_REVISION", "The agent did not return a revision.", [
      check("revision generated", true, false),
    ]);
  }
  const checks = [
    check("partType", expectedPartType, revision.engineeringSpec?.partType),
    check("validation passed", true, Boolean(revision.validation?.passed)),
    ...artifactChecks(revision),
  ];
  const packageCheck = await verifyPackageArtifact(baseUrl, revision);
  checks.push(...packageCheck.checks);

  const ok = checks.every((item) => item.passed);
  return {
    ok,
    failureClass: ok ? undefined : "unexpected_failure",
    status: ok ? "success" : "success_checks_failed",
    errorCode: ok ? undefined : "PROTOCOL_SUCCESS_CHECK_FAILED",
    userMessage: ok ? undefined : `Protocol case ${item.id} generated a revision but failed artifact or validation checks.`,
    revisionId: revision.id,
    validationPassed: Boolean(revision.validation?.passed),
    artifactCount: revision.artifacts?.length ?? 0,
    packageVerified: packageCheck.ok,
    checks,
  };
}

function failedEvaluation(failureClass, status, errorCode, userMessage, checks) {
  return {
    ok: false,
    failureClass,
    status,
    errorCode,
    userMessage,
    checks,
  };
}

async function postSSE(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...basicAuthHeader(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return {
      error: {
        code: `HTTP_${response.status}`,
        userMessage: `Staging request returned HTTP ${response.status}.`,
      },
    };
  }
  const text = await response.text();
  const events = parseSSE(text);
  const error = events.find((event) => event.type === "error");
  const revision = events.filter((event) => event.type === "revision").at(-1)?.revision;
  const projectId = events.find((event) => event.type === "project")?.project?.id;
  if (error) {
    return {
      error: {
        code: error.code || "AGENT_ERROR",
        userMessage: error.userMessage || "The CAD agent returned an error.",
      },
      revision,
      projectId,
    };
  }
  return { revision, projectId };
}

async function verifyPackageArtifact(baseUrl, revision) {
  const packageArtifact = revision.artifacts?.find((artifact) => artifact.kind === "package");
  const checks = [check("package artifact present", true, Boolean(packageArtifact))];
  if (!packageArtifact) return { ok: false, checks };

  const response = await fetchURL(baseUrl, packageArtifact.url);
  const body = Buffer.from(await response.arrayBuffer());
  checks.push(check("package download status", 200, response.status));
  checks.push(check("package download non-empty", true, body.byteLength > 0));
  if (response.status === 200 && body.byteLength > 0) {
    const entries = listZipEntries(body);
    for (const entry of REQUIRED_PACKAGE_ENTRIES) {
      checks.push(check(`package includes ${entry}`, true, entries.includes(entry)));
    }
  }
  return { ok: checks.every((item) => item.passed), checks };
}

function artifactChecks(revision) {
  const kinds = new Set((revision.artifacts || []).map((artifact) => artifact.kind));
  return REQUIRED_ARTIFACT_KINDS.map((kind) => check(`artifact ${kind}`, true, kinds.has(kind)));
}

function preservationChecks(currentSpec, revisedSpec, fields) {
  return fields.map((field) => check(`${field} preserved`, currentSpec[field], revisedSpec[field]));
}

function changedChecks(spec, changed) {
  const checks = [];
  for (const [field, expected] of Object.entries(changed)) {
    if (field === "materialIncludes") {
      checks.push(check("material updated", true, String(spec.material || "").toLowerCase().includes(String(expected).toLowerCase())));
    } else {
      checks.push(check(`${field} updated`, expected, spec[field]));
    }
  }
  return checks;
}

function check(name, expected, actual) {
  return {
    name,
    expected,
    actual,
    passed: actual === expected,
  };
}

function parseSSE(text) {
  const events = [];
  for (const chunk of text.split("\n\n")) {
    const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    events.push(JSON.parse(dataLine.slice(5).trim()));
  }
  return events;
}

function expectedPartTypeFor(item) {
  if (item.category.startsWith("l_bracket")) return "l_bracket";
  return "mounting_plate";
}

function seedPromptFor(seed) {
  if (seed === "l_bracket") {
    return "Make a 90 x 60 x 40 mm L bracket, 5 mm thick, 5 mm holes, 12 mm edge offset, and 1 mm chamfer.";
  }
  return "Make a 120 x 80 x 4 mm mounting plate with four 4.5 mm holes, 10 mm edge offset, and 1 mm chamfer.";
}

function extractRevisionPrompt(prompt) {
  const match = prompt.match(/say:\s*(.+)$/i);
  return stripMarkdown(match?.[1] || prompt).replace(/\.\s*$/, "");
}

function fetchURL(baseUrl, pathOrUrl, init = {}) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
  return fetch(url, { ...init, headers: { ...basicAuthHeader(), ...(init.headers ?? {}) } });
}

function basicAuthHeader() {
  const user = process.env.STAGING_BASIC_AUTH_USER;
  const password = process.env.STAGING_BASIC_AUTH_PASSWORD;
  if (!user || !password) return {};
  return {
    Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
  };
}

function requiredBaseUrl(baseUrl) {
  if (!baseUrl) {
    throw new Error("STAGING_BASE_URL is required when using --execute.");
  }
  return baseUrl.replace(/\/$/, "");
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    protocolPath: DEFAULT_PROTOCOL_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    execute: false,
    delayMs: DEFAULT_EXECUTE_DELAY_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--protocol") {
      args.protocolPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--output") {
      args.outputPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--execute") {
      args.execute = true;
    } else if (argv[index] === "--delay-ms") {
      args.delayMs = Number(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  runStagingProtocol(args)
    .then((payload) => {
      console.log(JSON.stringify({ output: args.outputPath, executed: payload.executed, count: payload.count, summary: payload.summary }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
