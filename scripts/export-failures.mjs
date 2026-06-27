#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRunHistory } from "./summarize-runs.mjs";

const DEFAULT_LOG_PATH = path.resolve(process.cwd(), "logs", "runs.jsonl");
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), "outputs", "failures", "failures.json");
const DEFAULT_MAX_PROMPT_CHARS = 160;

export async function exportFailures({
  logPath = DEFAULT_LOG_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  maxPromptChars = DEFAULT_MAX_PROMPT_CHARS,
} = {}) {
  const runs = await readRunHistory(logPath);
  const failures = runs
    .filter((run) => run.status === "failure")
    .map((run) => ({
      timestamp: run.timestamp,
      route: run.route,
      errorCode: run.errorCode || "UNKNOWN",
      partType: run.partType,
      durationMs: Number.isFinite(Number(run.durationMs)) ? Number(run.durationMs) : undefined,
      prompt: sanitizePrompt(run.prompt, maxPromptChars),
    }));

  const payload = {
    exportedAt: new Date().toISOString(),
    source: path.basename(logPath),
    count: failures.length,
    failures,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export function sanitizePrompt(prompt, maxPromptChars = DEFAULT_MAX_PROMPT_CHARS) {
  if (!prompt) return undefined;
  const sanitized = String(prompt)
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted-api-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=-]+/gi, "Basic [redacted]")
    .replace(/(password|api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length <= maxPromptChars) return sanitized;
  return `${sanitized.slice(0, maxPromptChars)}...`;
}

function parseArgs(argv) {
  const args = {
    logPath: DEFAULT_LOG_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--log") {
      args.logPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--output") {
      args.outputPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--max-prompt-chars") {
      args.maxPromptChars = Number(argv[index + 1]);
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
  exportFailures(args)
    .then((payload) => {
      console.log(JSON.stringify({ output: args.outputPath, count: payload.count }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
