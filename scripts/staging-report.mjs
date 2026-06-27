#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRunHistory } from "./classify-runs.mjs";
import { summarizeProtocolResults } from "./run-staging-protocol.mjs";
import { summarizeRunHistory } from "./summarize-runs.mjs";

const DEFAULT_LOG_PATH = path.resolve(process.cwd(), "logs", "runs.jsonl");
const DEFAULT_SMOKE_PATH = path.resolve(process.cwd(), "outputs", "smoke", "latest.json");
const DEFAULT_PROTOCOL_PATH = path.resolve(process.cwd(), "outputs", "protocol", "latest.json");
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), "outputs", "reports", "staging-report.md");

export async function generateStagingReport({
  logPath = DEFAULT_LOG_PATH,
  smokePath = DEFAULT_SMOKE_PATH,
  protocolPath = DEFAULT_PROTOCOL_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  since,
} = {}) {
  const [summary, classification, smokeRecord, protocolRecord] = await Promise.all([
    summarizeRunHistory({ logPath }),
    classifyRunHistory({ logPath }),
    readJSONRecordIfExists(smokePath),
    readJSONRecordIfExists(protocolPath),
  ]);
  const smoke = smokeRecord?.payload;
  const protocol = protocolRecord?.payload;
  const effectiveSince = since || trialWindowStart({ smoke, protocol });
  const newClassification = effectiveSince ? await classifyRunHistory({ logPath, since: effectiveSince }) : undefined;
  const markdown = renderReport({
    summary,
    classification,
    smoke,
    smokeUpdatedAt: smokeRecord?.updatedAt,
    protocol,
    protocolUpdatedAt: protocolRecord?.updatedAt,
    newClassification,
    since: effectiveSince,
    generatedAt: new Date().toISOString(),
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown, "utf8");
  return {
    outputPath,
    summary,
    classification,
    smokePresent: Boolean(smoke),
    protocolPresent: Boolean(protocol),
    since: effectiveSince,
    newUnexpectedFailureCount: newClassification?.unexpectedFailureCount,
  };
}

export function renderReport({
  summary,
  classification,
  smoke,
  smokeUpdatedAt,
  protocol,
  protocolUpdatedAt,
  newClassification,
  since,
  generatedAt,
}) {
  const lines = [
    "# Staging Observation Report",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Run Summary",
    "",
    `- Total runs: ${summary.totalRuns}`,
    `- Success count: ${summary.successCount}`,
    `- Failure count: ${summary.failureCount}`,
    `- Validation pass rate: ${formatPercent(summary.validationPassRate)}`,
    `- Average duration: ${summary.averageDurationMs} ms`,
    `- P95 duration: ${summary.p95DurationMs} ms`,
    "",
    "### Runs By Route",
    "",
    ...mapCounts(summary.runsByRoute),
    "",
    "### Runs By Part Type",
    "",
    ...mapCounts(summary.runsByPartType),
    "",
    "## Failure Classification",
    "",
    `- Failure runs: ${classification.failureRuns}`,
    `- Expected failures: ${classification.expectedFailureCount}`,
    `- Unexpected failures: ${classification.unexpectedFailureCount}`,
    `- Expected vs unexpected failure ratio: ${formatFailureRatio(classification.expectedFailureCount, classification.unexpectedFailureCount)}`,
    "",
    "### Expected By Reason",
    "",
    ...mapCounts(classification.expectedByReason),
    "",
    "### Unexpected By Reason",
    "",
    ...mapCounts(classification.unexpectedByReason),
    "",
    "### Recent Unexpected Failures",
    "",
    ...recentUnexpectedLines(classification.recentUnexpectedFailures),
    "",
    "## Latest Smoke",
    "",
    ...smokeLines(smoke, smokeUpdatedAt, generatedAt),
    "",
    "## Latest Protocol",
    "",
    ...protocolLines(protocol, protocolUpdatedAt, generatedAt),
    "",
    "## New Unexpected Since Window",
    "",
    ...newUnexpectedLines(newClassification, since),
    "",
    "## Action Items",
    "",
    ...actionItemLines({ classification, smoke, protocol }),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function readJSONRecordIfExists(filePath) {
  try {
    const [text, stats] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
    return {
      payload: JSON.parse(text),
      updatedAt: stats.mtime.toISOString(),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function mapCounts(counts) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return ["- none"];
  return entries.map(([key, value]) => `- ${key}: ${value}`);
}

function recentUnexpectedLines(items) {
  if (!items?.length) return ["- none"];
  return items.map((item) =>
    `- ${item.timestamp || "unknown"} | ${item.route || "unknown"} | ${item.reason || item.errorCode || "UNKNOWN"} | ${item.partType || "unknown"} | ${item.durationMs ?? "n/a"} ms`,
  );
}

function smokeLines(smoke, smokeUpdatedAt, generatedAt) {
  if (!smoke) return ["- No smoke output found. Run `npm run smoke:staging -- --output outputs/smoke/latest.json`."];
  const smokeTimestamp = smoke.generatedAt || smokeUpdatedAt;
  return [
    `- OK: ${Boolean(smoke.ok)}`,
    `- Latest smoke passed: ${Boolean(smoke.ok)}`,
    `- Last smoke age: ${formatAge(smokeTimestamp, generatedAt)}`,
    `- Duration: ${smoke.durationMs ?? "n/a"} ms`,
    `- HTTPS configured: ${Boolean(smoke.health?.httpsConfigured)}`,
    `- Access mode: ${smoke.health?.accessMode || "unknown"}`,
    `- Warning: ${smoke.health?.warning || "none"}`,
    `- Rev001: ${smoke.rev001?.id || "missing"} | validation ${Boolean(smoke.rev001?.validationPassed)}`,
    `- Rev002: ${smoke.rev002?.id || "missing"} | validation ${Boolean(smoke.rev002?.validationPassed)}`,
    `- Artifact downloads: ${smoke.artifactDownloads?.length ?? 0}`,
  ];
}

function protocolLines(protocol, protocolUpdatedAt, generatedAt) {
  if (!protocol) {
    return ["- No protocol output found. Run `npm run staging:protocol -- --execute --output outputs/protocol/latest.json`."];
  }
  const summary = protocol.summary || summarizeProtocolResults(protocol.protocol || [], protocol.results || [], Boolean(protocol.executed));
  const protocolTimestamp = protocol.generatedAt || protocolUpdatedAt;
  return [
    `- Executed: ${Boolean(protocol.executed)}`,
    `- Latest protocol run age: ${formatAge(protocolTimestamp, generatedAt)}`,
    `- Protocol total: ${summary.total ?? 0}`,
    `- Protocol passed: ${summary.passed ?? 0}`,
    `- Protocol failed: ${summary.failed ?? 0}`,
    `- Expected failure cases passed: ${summary.expectedFailureCasesPassed ?? 0}`,
    `- Failed expected: ${summary.expectedFailures ?? 0}`,
    `- Failed unexpected: ${summary.unexpectedFailures ?? 0}`,
    "",
    "### Protocol Failures",
    "",
    ...protocolFailureLines(protocol.results || []),
  ];
}

function protocolFailureLines(results) {
  const failures = results.filter((result) => !result.ok);
  if (!failures.length) return ["- none"];
  return failures.map((item) =>
    `- case ${item.id} | ${item.category || "unknown"} | ${item.failureClass || "unknown"} | ${item.status || "unknown"} | ${item.errorCode || "UNKNOWN"} | expected: ${item.expectedResult || "n/a"}`,
  );
}

function newUnexpectedLines(newClassification, since) {
  if (!since || !newClassification) return ["- Since: unavailable", "- New unexpected failures: unknown"];
  return [
    `- Since: ${since}`,
    `- New total runs: ${newClassification.totalRuns}`,
    `- New failure runs: ${newClassification.failureRuns}`,
    `- New expected failures: ${newClassification.expectedFailureCount}`,
    `- New unexpected failures: ${newClassification.unexpectedFailureCount}`,
    "",
    "### New Recent Unexpected Failures",
    "",
    ...recentUnexpectedLines(newClassification.recentUnexpectedFailures),
  ];
}

function actionItemLines({ classification, smoke, protocol }) {
  const items = [];
  if (classification.unexpectedFailureCount > 0) {
    items.push("Triage historical unexpected failures using `docs/FAILURE_TRIAGE.md`, then convert reproducible cases into tests.");
  }
  if (!smoke) {
    items.push("Run staging smoke and persist it with `npm run smoke:staging -- --output outputs/smoke/latest.json`.");
  } else if (!smoke.ok) {
    items.push("Investigate the latest failed smoke before inviting more internal testers.");
  }
  const protocolSummary = protocol?.summary || (protocol ? summarizeProtocolResults(protocol.protocol || [], protocol.results || [], Boolean(protocol.executed)) : undefined);
  if (!protocol) {
    items.push("Run the staging protocol with `npm run staging:protocol -- --execute --output outputs/protocol/latest.json`.");
  } else if ((protocolSummary?.failed ?? 0) > 0) {
    items.push("Triage protocol failures before continuing the 48-72 hour internal trial.");
  }
  if (smoke?.health?.httpsConfigured === false) {
    items.push("Restrict access or enable HTTPS before broad internal trial traffic.");
  }
  if (!items.length) return ["- none"];
  return items.map((item) => `- ${item}`);
}

function trialWindowStart({ smoke, protocol }) {
  const candidates = [smoke?.startedAt, protocol?.startedAt, smoke?.generatedAt, protocol?.generatedAt].filter(Boolean);
  const valid = candidates
    .map((timestamp) => ({ timestamp, ms: Date.parse(timestamp) }))
    .filter((item) => Number.isFinite(item.ms))
    .sort((a, b) => a.ms - b.ms);
  return valid[0]?.timestamp;
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatFailureRatio(expectedCount, unexpectedCount) {
  const total = expectedCount + unexpectedCount;
  if (!total) return "n/a (0 failures)";
  return `expected ${formatPercent(expectedCount / total)} / unexpected ${formatPercent(unexpectedCount / total)}`;
}

function formatAge(timestamp, generatedAt) {
  if (!timestamp) return "unknown";
  const then = Date.parse(timestamp);
  const now = Date.parse(generatedAt);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return "unknown";
  const ageMs = Math.max(0, now - then);
  const minutes = Math.floor(ageMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function parseArgs(argv) {
  const args = {
    logPath: DEFAULT_LOG_PATH,
    smokePath: DEFAULT_SMOKE_PATH,
    protocolPath: DEFAULT_PROTOCOL_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    since: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--log") {
      args.logPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--smoke") {
      args.smokePath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--protocol") {
      args.protocolPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--output") {
      args.outputPath = path.resolve(argv[index + 1]);
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
  generateStagingReport(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(
        JSON.stringify(
          {
            output: result.outputPath,
            smokePresent: result.smokePresent,
            protocolPresent: result.protocolPresent,
            since: result.since,
            newUnexpectedFailureCount: result.newUnexpectedFailureCount,
          },
          null,
          2,
        ),
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
