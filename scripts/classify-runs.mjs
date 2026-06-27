#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRunHistory } from "./summarize-runs.mjs";

const DEFAULT_LOG_PATH = path.resolve(process.cwd(), "logs", "runs.jsonl");
const RECENT_UNEXPECTED_LIMIT = 20;

const UNEXPECTED_ERROR_CODES = new Set([
  "LLM_JSON_ERROR",
  "CAD_RUNNER_CRASH",
  "VALIDATION_FAILED",
  "ARTIFACT_DOWNLOAD_FAILED",
  "SSE_ABORT",
]);

export async function classifyRunHistory({ logPath = DEFAULT_LOG_PATH, since } = {}) {
  const runs = await readRunHistory(logPath);
  return classifyRuns(filterRunsSince(runs, since), { since });
}

export function classifyRuns(runs, { since } = {}) {
  const failures = runs.filter((run) => run.status === "failure" || run.validationPassed === false);
  const classified = failures.map((run) => classifyFailure(run));
  const expected = classified.filter((item) => item.classification === "expected_failure");
  const unexpected = classified.filter((item) => item.classification === "unexpected_failure");

  return {
    since,
    totalRuns: runs.length,
    failureRuns: failures.length,
    expectedFailureCount: expected.length,
    unexpectedFailureCount: unexpected.length,
    expectedByReason: countBy(expected, (item) => item.reason),
    unexpectedByReason: countBy(unexpected, (item) => item.reason),
    recentUnexpectedFailures: unexpected.slice(-RECENT_UNEXPECTED_LIMIT).reverse().map(summarizeClassifiedFailure),
  };
}

export function filterRunsSince(runs, since) {
  if (!since) return runs;
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) {
    throw new Error(`Invalid --since timestamp: ${since}`);
  }
  return runs.filter((run) => {
    const timestampMs = Date.parse(run.timestamp || "");
    return Number.isFinite(timestampMs) && timestampMs >= sinceMs;
  });
}

export function classifyFailure(run) {
  const errorCode = String(run.errorCode || "").toUpperCase();
  const statusCode = Number(run.statusCode || run.httpStatus || run.status);
  const text = [
    run.errorCode,
    run.message,
    run.userMessage,
    run.detail,
    run.reason,
    run.prompt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (statusCode === 401 || /(^|_)401($|_)|unauthorized|auth_required|authentication required/.test(errorCode.toLowerCase() + " " + text)) {
    return classified(run, "expected_failure", "AUTH_REQUIRED");
  }
  if (statusCode === 429 || errorCode === "RATE_LIMITED" || text.includes("too many cad requests")) {
    return classified(run, "expected_failure", "RATE_LIMITED");
  }
  if (errorCode === "UNSUPPORTED_PART_TYPE" || /unsupported (parttype|template)|supported parttype values/.test(text)) {
    return classified(run, "expected_failure", "UNSUPPORTED_PART_TYPE");
  }
  if (
    errorCode === "PARAMETER_CONFLICT" ||
    /edgeoffset|hole radius|no usable area|chamfer is too large|must be positive|must be larger|parameter conflict|invalid dimension/.test(text)
  ) {
    return classified(run, "expected_failure", "PARAMETER_CONFLICT");
  }
  if (["SPEC_REQUIRED", "PROMPT_REQUIRED", "PROMPT_TOO_LONG", "INVALID_JSON", "REVISION_REQUEST_REQUIRED"].includes(errorCode)) {
    return classified(run, "expected_failure", "BAD_REQUEST");
  }
  if (run.validationPassed === false || errorCode === "VALIDATION_FAILED") {
    return classified(run, "unexpected_failure", "VALIDATION_FAILED");
  }
  if (UNEXPECTED_ERROR_CODES.has(errorCode)) {
    return classified(run, "unexpected_failure", errorCode);
  }
  if (/model did not return valid json|invalid json|did not return json engineering spec|invalid engineering spec/.test(text)) {
    return classified(run, "unexpected_failure", "LLM_JSON_ERROR");
  }
  if (/build123d|open cascade|cad runner produced no json|cad runner exited|runner timed out|traceback/.test(text)) {
    return classified(run, "unexpected_failure", "CAD_RUNNER_CRASH");
  }
  if (/artifact download failed|download returned|download was empty/.test(text)) {
    return classified(run, "unexpected_failure", "ARTIFACT_DOWNLOAD_FAILED");
  }
  if (/sse abort|stream aborted|connection closed/.test(text)) {
    return classified(run, "unexpected_failure", "SSE_ABORT");
  }
  return classified(run, "unexpected_failure", errorCode || "UNKNOWN_FAILURE");
}

function classified(run, classification, reason) {
  return { run, classification, reason };
}

function summarizeClassifiedFailure(item) {
  return {
    timestamp: item.run.timestamp,
    route: item.run.route,
    errorCode: item.run.errorCode || "UNKNOWN",
    reason: item.reason,
    partType: item.run.partType || "unknown",
    durationMs: Number.isFinite(Number(item.run.durationMs)) ? Number(item.run.durationMs) : undefined,
    revisionId: item.run.revisionId,
  };
}

function countBy(items, keyFor) {
  return items.reduce((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function parseArgs(argv) {
  const args = { logPath: DEFAULT_LOG_PATH, since: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--log") {
      args.logPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--since") {
      args.since = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  classifyRunHistory(parseArgs(process.argv.slice(2)))
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
