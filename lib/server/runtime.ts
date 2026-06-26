export type AgentRuntimeConfig = {
  baseUrl?: string;
  apiKey?: string;
  primaryModel?: string;
  downgradeModel?: string;
  cadRunnerCommand?: string;
};

export function getRuntimeConfig(): AgentRuntimeConfig {
  return {
    baseUrl: process.env.CAD_AGENT_BASE_URL,
    apiKey: process.env.CAD_AGENT_API_KEY,
    primaryModel: process.env.CAD_AGENT_PRIMARY_MODEL,
    downgradeModel: process.env.CAD_AGENT_DOWNGRADE_MODEL,
    cadRunnerCommand: process.env.CAD_RUNNER_COMMAND,
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
