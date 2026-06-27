export type AgentRuntimeConfig = {
  baseUrl?: string;
  apiKey?: string;
  primaryModel?: string;
  downgradeModel?: string;
  cadRunnerCommand?: string;
  cadRunnerTimeoutMs: number;
  cadMaxConcurrentRuns: number;
  maxPromptChars: number;
  cadOutputRetentionHours: number;
  cadOutputMaxBytes?: number;
};

export function getRuntimeConfig(): AgentRuntimeConfig {
  return {
    baseUrl: process.env.CAD_AGENT_BASE_URL,
    apiKey: process.env.CAD_AGENT_API_KEY,
    primaryModel: process.env.CAD_AGENT_PRIMARY_MODEL,
    downgradeModel: process.env.CAD_AGENT_DOWNGRADE_MODEL,
    cadRunnerCommand: process.env.CAD_RUNNER_COMMAND,
    cadRunnerTimeoutMs: positiveInt(process.env.CAD_RUNNER_TIMEOUT_MS, 60_000),
    cadMaxConcurrentRuns: positiveInt(process.env.CAD_MAX_CONCURRENT_RUNS, 1),
    maxPromptChars: positiveInt(process.env.MAX_PROMPT_CHARS, 2_000),
    cadOutputRetentionHours: positiveInt(process.env.CAD_OUTPUT_RETENTION_HOURS, 72),
    cadOutputMaxBytes: optionalPositiveInt(process.env.CAD_OUTPUT_MAX_BYTES),
  };
}

export function missingLLMConfig(config = getRuntimeConfig()) {
  const missing: string[] = [];
  if (!config.baseUrl) missing.push("CAD_AGENT_BASE_URL");
  if (!config.apiKey) missing.push("CAD_AGENT_API_KEY");
  if (!config.primaryModel) missing.push("CAD_AGENT_PRIMARY_MODEL");
  return missing;
}

export function isLLMConfigured(config = getRuntimeConfig()) {
  return missingLLMConfig(config).length === 0;
}

export function isCADRunnerConfigured(config = getRuntimeConfig()) {
  return Boolean(config.cadRunnerCommand);
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function optionalPositiveInt(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}
