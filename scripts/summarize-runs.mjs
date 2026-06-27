#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LOG_PATH = path.resolve(process.cwd(), "logs", "runs.jsonl");

export async function readRunHistory(logPath = DEFAULT_LOG_PATH) {
  try {
    const text = await fs.readFile(logPath, "utf8");
    return parseRunHistory(text);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function parseRunHistory(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function summarizeRuns(runs) {
  const durations = runs.map((run) => Number(run.durationMs)).filter((duration) => Number.isFinite(duration));
  const validationRuns = runs.filter((run) => typeof run.validationPassed === "boolean");
  const validationPassCount = validationRuns.filter((run) => run.validationPassed).length;

  return {
    totalRuns: runs.length,
    successCount: runs.filter((run) => run.status === "success").length,
    failureCount: runs.filter((run) => run.status === "failure").length,
    validationPassRate: ratio(validationPassCount, validationRuns.length),
    validationPassCount,
    validationCheckedCount: validationRuns.length,
    averageDurationMs: average(durations),
    p95DurationMs: percentile(durations, 0.95),
    failuresByErrorCode: countBy(
      runs.filter((run) => run.status === "failure"),
      (run) => run.errorCode || "UNKNOWN",
    ),
    runsByRoute: countBy(runs, (run) => run.route || "unknown"),
    runsByPartType: countBy(runs, (run) => run.partType || "unknown"),
  };
}

export async function summarizeRunHistory({ logPath = DEFAULT_LOG_PATH } = {}) {
  const runs = await readRunHistory(logPath);
  return summarizeRuns(runs);
}

function countBy(items, keyFor) {
  return items.reduce((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return Math.round(sorted[index]);
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function parseArgs(argv) {
  const args = { logPath: DEFAULT_LOG_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--log") {
      args.logPath = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  summarizeRunHistory(parseArgs(process.argv.slice(2)))
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
