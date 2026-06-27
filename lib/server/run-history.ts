import { promises as fs } from "node:fs";
import path from "node:path";
import type { CADRevision } from "@/lib/agent/spec";

const RUN_LOG_PATH = path.resolve(process.cwd(), "logs", "runs.jsonl");
const MAX_PROMPT_LOG_CHARS = 300;

export type RunHistoryRoute = "/api/agent/run" | "/api/agent/revise" | "/api/cad/rebuild";

export async function appendRunHistory(entry: {
  route: RunHistoryRoute;
  runId: string;
  prompt?: string;
  model?: string;
  status: "success" | "failure";
  durationMs: number;
  revision?: CADRevision;
  errorCode?: string;
  userId?: string;
  organizationId?: string;
  projectId?: string;
}) {
  const record = {
    timestamp: new Date().toISOString(),
    route: entry.route,
    runId: entry.runId,
    revisionId: entry.revision?.id,
    projectId: entry.projectId,
    userId: entry.userId,
    organizationId: entry.organizationId,
    partType: entry.revision?.engineeringSpec.partType,
    model: entry.model,
    status: entry.status,
    durationMs: Math.round(entry.durationMs),
    artifactCount: entry.revision?.artifacts.length,
    validationPassed: entry.revision?.validation?.passed,
    errorCode: entry.errorCode,
    prompt: truncatePrompt(entry.prompt),
  };
  await fs.mkdir(path.dirname(RUN_LOG_PATH), { recursive: true });
  await fs.appendFile(RUN_LOG_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

function truncatePrompt(prompt: string | undefined) {
  if (!prompt) return undefined;
  if (prompt.length <= MAX_PROMPT_LOG_CHARS) return prompt;
  return `${prompt.slice(0, MAX_PROMPT_LOG_CHARS)}...`;
}
