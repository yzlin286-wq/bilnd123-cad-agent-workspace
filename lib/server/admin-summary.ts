import { promises as fs } from "node:fs";
import path from "node:path";
import { summarizeFeedback } from "@/lib/server/feedback";
import { listProjects } from "@/lib/server/project-store";
import { getDataLayerStatus } from "@/lib/server/data-layer";

const RUN_LOG_PATH = path.resolve(process.cwd(), "logs", "runs.jsonl");
const SMOKE_PATH = path.resolve(process.cwd(), "outputs", "smoke", "latest.json");
const PROTOCOL_PATH = path.resolve(process.cwd(), "outputs", "protocol", "latest.json");

const EXPECTED_FAILURE_CODES = new Set([
  "AUTH_REQUIRED",
  "RATE_LIMITED",
  "UNSUPPORTED_PART_TYPE",
  "PARAMETER_CONFLICT",
  "SPEC_REQUIRED",
  "PROMPT_REQUIRED",
  "PROMPT_TOO_LONG",
  "INVALID_JSON",
  "REVISION_REQUEST_REQUIRED",
]);

const UNEXPECTED_FAILURE_CODES = new Set([
  "LLM_JSON_ERROR",
  "CAD_RUNNER_CRASH",
  "VALIDATION_FAILED",
  "ARTIFACT_DOWNLOAD_FAILED",
  "SSE_ABORT",
]);

type RunRecord = {
  timestamp?: string;
  route?: string;
  status?: string;
  durationMs?: number;
  partType?: string;
  errorCode?: string;
  validationPassed?: boolean;
};

type JSONRecord = Record<string, unknown>;

export async function getAdminSummary() {
  const [runs, smoke, protocol, feedback, projects] = await Promise.all([
    readJSONL<RunRecord>(RUN_LOG_PATH),
    readJSONIfExists(SMOKE_PATH),
    readJSONIfExists(PROTOCOL_PATH),
    summarizeFeedback(),
    listProjects({ limit: 10_000 }),
  ]);
  const durations = runs.map((run) => Number(run.durationMs)).filter((duration) => Number.isFinite(duration));
  const failures = runs.filter((run) => run.status === "failure" || run.validationPassed === false);
  const since = trialWindowStart({ smoke, protocol });
  const newUnexpectedFailures = since
    ? failures.filter((run) => isUnexpectedFailure(run) && timestampAfter(run.timestamp, since)).length
    : failures.filter(isUnexpectedFailure).length;

  return {
    generatedAt: new Date().toISOString(),
    totalUsers: new Set(projects.map((project) => project.ownerUserId).filter(Boolean)).size,
    totalProjects: projects.length,
    totalRuns: runs.length,
    successCount: runs.filter((run) => run.status === "success").length,
    failureCount: failures.length,
    p95DurationMs: percentile(durations, 0.95),
    runsByPartType: countBy(runs, (run) => run.partType || "unknown"),
    protocolStatus: protocol?.summary
      ? {
          total: numberField(recordField(protocol, "summary"), "total"),
          passed: numberField(recordField(protocol, "summary"), "passed"),
          failed: numberField(recordField(protocol, "summary"), "failed"),
          executed: Boolean(protocol.executed),
          generatedAt: stringField(protocol, "generatedAt"),
        }
      : undefined,
    latestSmoke: smoke
      ? {
          ok: Boolean(smoke.ok),
          generatedAt: stringField(smoke, "generatedAt") || stringField(smoke, "startedAt"),
          accessMode: stringField(recordField(smoke, "health"), "accessMode") || "unknown",
          httpsConfigured: Boolean(recordField(smoke, "health").httpsConfigured),
          warning: stringField(recordField(smoke, "health"), "warning"),
        }
      : undefined,
    newUnexpectedFailures,
    feedback,
    dataLayer: getDataLayerStatus(),
  };
}

function isUnexpectedFailure(run: RunRecord) {
  const errorCode = String(run.errorCode || "").toUpperCase();
  if (run.validationPassed === false || UNEXPECTED_FAILURE_CODES.has(errorCode)) return true;
  if (EXPECTED_FAILURE_CODES.has(errorCode)) return false;
  return run.status === "failure";
}

async function readJSONIfExists(filePath: string): Promise<JSONRecord | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readJSONL<T>(filePath: string) {
  try {
    return (await fs.readFile(filePath, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function countBy<T>(items: T[], keyFor: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return Math.round(sorted[index]);
}

function recordField(record: JSONRecord | undefined, key: string): JSONRecord {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JSONRecord) : {};
}

function stringField(record: JSONRecord | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: JSONRecord | undefined, key: string) {
  const value = Number(record?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function trialWindowStart({ smoke, protocol }: { smoke?: JSONRecord; protocol?: JSONRecord }) {
  const candidates = [
    stringField(smoke, "startedAt"),
    stringField(protocol, "startedAt"),
    stringField(smoke, "generatedAt"),
    stringField(protocol, "generatedAt"),
  ].filter(Boolean);
  const valid = candidates
    .map((timestamp) => ({ timestamp: String(timestamp), ms: Date.parse(String(timestamp)) }))
    .filter((item) => Number.isFinite(item.ms))
    .sort((a, b) => a.ms - b.ms);
  return valid[0]?.timestamp;
}

function timestampAfter(timestamp: string | undefined, since: string) {
  const timestampMs = Date.parse(timestamp || "");
  const sinceMs = Date.parse(since);
  return Number.isFinite(timestampMs) && Number.isFinite(sinceMs) && timestampMs >= sinceMs;
}
