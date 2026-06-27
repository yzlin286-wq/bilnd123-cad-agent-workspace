#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PROTOCOL_PATH = path.resolve(process.cwd(), "docs", "STAGING_TEST_PROTOCOL.md");
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), "outputs", "protocol", "latest.json");

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
        category: cells[1],
        prompt: stripMarkdown(cells[2]),
        expectedResult: stripMarkdown(cells[3]),
      };
    })
    .filter((item) => Number.isFinite(item.id) && item.category && item.prompt);
}

export async function runStagingProtocol({
  protocolPath = DEFAULT_PROTOCOL_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  execute = false,
  baseUrl = process.env.STAGING_BASE_URL,
} = {}) {
  const protocol = await loadProtocol({ protocolPath });
  const startedAt = Date.now();
  const results = execute ? await executeProtocol(protocol, requiredBaseUrl(baseUrl)) : [];
  const payload = {
    generatedAt: new Date().toISOString(),
    executed: execute,
    count: protocol.length,
    protocol,
    results,
    durationMs: Date.now() - startedAt,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

async function executeProtocol(protocol, baseUrl) {
  const results = [];
  for (const item of protocol) {
    const startedAt = Date.now();
    try {
      const result = await executeProtocolItem(item, baseUrl);
      results.push({
        id: item.id,
        category: item.category,
        ok: result.ok,
        status: result.status,
        errorCode: result.errorCode,
        userMessage: result.userMessage,
        revisionId: result.revisionId,
        validationPassed: result.validationPassed,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      results.push({
        id: item.id,
        category: item.category,
        ok: false,
        status: "protocol_error",
        errorCode: "PROTOCOL_EXECUTION_FAILED",
        userMessage: error instanceof Error ? error.message : "Protocol execution failed.",
        durationMs: Date.now() - startedAt,
      });
    }
  }
  return results;
}

async function executeProtocolItem(item, baseUrl) {
  if (item.category === "revision") {
    const seed = await postSSE(baseUrl, "/api/agent/run", { prompt: seedPromptFor(item) });
    if (!seed.ok || !seed.revision) return seed;
    const revisionPrompt = extractRevisionPrompt(item.prompt);
    return postSSE(baseUrl, "/api/agent/revise", {
      currentSpec: seed.revision.engineeringSpec,
      currentRevisionId: seed.revision.id,
      userPrompt: revisionPrompt,
    });
  }

  return postSSE(baseUrl, "/api/agent/run", { prompt: item.prompt });
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
      ok: false,
      status: "http_error",
      errorCode: `HTTP_${response.status}`,
      userMessage: `Staging request returned HTTP ${response.status}.`,
    };
  }
  const text = await response.text();
  const events = parseSSE(text);
  const error = events.find((event) => event.type === "error");
  if (error) {
    return {
      ok: false,
      status: "agent_error",
      errorCode: error.code || "AGENT_ERROR",
      userMessage: error.userMessage || "The CAD agent returned an error.",
    };
  }
  const revision = events.filter((event) => event.type === "revision").at(-1)?.revision;
  return {
    ok: Boolean(revision?.validation?.passed),
    status: revision ? "revision" : "missing_revision",
    revisionId: revision?.id,
    validationPassed: Boolean(revision?.validation?.passed),
    revision,
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

function seedPromptFor(item) {
  const text = `${item.prompt} ${item.expectedResult}`.toLowerCase();
  if (text.includes("l bracket")) {
    return "Make a 90 x 60 x 40 mm L bracket, 5 mm thick, 5 mm holes, 12 mm edge offset, and 1 mm chamfer.";
  }
  return "Make a 120 x 80 x 4 mm mounting plate with four 4.5 mm holes, 10 mm edge offset, and 1 mm chamfer.";
}

function extractRevisionPrompt(prompt) {
  const match = prompt.match(/say:\s*(.+)$/i);
  return stripMarkdown(match?.[1] || prompt).replace(/\.\s*$/, "");
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

function parseArgs(argv) {
  const args = {
    protocolPath: DEFAULT_PROTOCOL_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    execute: false,
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
      console.log(JSON.stringify({ output: args.outputPath, executed: payload.executed, count: payload.count }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
