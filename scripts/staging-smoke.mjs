#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { listZipEntries } from "./zip-entries.mjs";

const baseUrl = requiredEnv("STAGING_BASE_URL").replace(/\/$/, "");
const authHeader = basicAuthHeader();
const args = parseArgs(process.argv.slice(2));
const startedAtIso = new Date().toISOString();
const startedAt = Date.now();

const initialPrompt = "Make a 120 x 80 x 4 mm mounting plate with four 4.5 mm holes, 10 mm edge offset, and 1 mm chamfer";
const revisionPrompt = "change thickness to 6 mm";
const requiredPackageEntries = ["model.step", "model.stl", "drawing.svg", "source.py", "spec.json", "validation.json", "manifest.json"];

const health = await getJSON("/api/health");
assert(health.app === "ok", "health app check failed");
assert(Array.isArray(health.supportedTemplates) && health.supportedTemplates.includes("mounting_plate"), "health templates missing mounting_plate");

const runEvents = await postSSE("/api/agent/run", { prompt: initialPrompt });
const rev001 = lastEvent(runEvents, "revision")?.revision;
assert(rev001, "initial run did not emit a revision");
assert(rev001.validation?.passed, "initial run validation did not pass");
assert(rev001.engineeringSpec.partType === "mounting_plate", "initial run did not produce mounting_plate");

const reviseEvents = await postSSE("/api/agent/revise", {
  currentSpec: rev001.engineeringSpec,
  currentRevisionId: rev001.id,
  userPrompt: revisionPrompt,
});
const rev002 = lastEvent(reviseEvents, "revision")?.revision;
assert(rev002, "revision run did not emit a revision");
assert(rev002.validation?.passed, "revision validation did not pass");
assert(rev002.engineeringSpec.thickness === 6, "revision did not set thickness to 6 mm");
for (const key of ["length", "width", "holeDiameter", "edgeOffset", "chamfer"]) {
  assert(
    rev002.engineeringSpec[key] === rev001.engineeringSpec[key],
    `revision changed ${key}: ${rev001.engineeringSpec[key]} -> ${rev002.engineeringSpec[key]}`,
  );
}

const artifactDownloads = [];
for (const kind of ["step", "stl", "validation", "package"]) {
  const artifact = rev002.artifacts.find((item) => item.kind === kind);
  assert(artifact, `missing ${kind} artifact`);
  const response = await fetchURL(artifact.url);
  assert(response.status === 200, `${kind} download returned ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  assert(body.byteLength > 0, `${kind} download was empty`);
  const download = {
    kind,
    name: artifact.name,
    url: artifact.url,
    status: response.status,
    bytes: body.byteLength,
  };
  if (kind === "package") {
    const entries = listZipEntries(body);
    for (const requiredEntry of requiredPackageEntries) {
      assert(entries.includes(requiredEntry), `package.zip missing ${requiredEntry}`);
    }
    download.zipEntries = entries;
  }
  artifactDownloads.push(download);
}

const result = {
  ok: true,
  startedAt: startedAtIso,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  health: {
    cadRunnerConfigured: health.cadRunnerConfigured,
    llmConfigured: health.llmConfigured,
    outputDirWritable: health.outputDirWritable,
    httpsConfigured: health.httpsConfigured,
    accessMode: health.accessMode,
    warning: health.warning,
  },
  rev001: revisionSummary(rev001),
  rev002: revisionSummary(rev002),
  artifactDownloads,
};

if (args.outputPath) {
  await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
  await fs.writeFile(args.outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(result, null, 2));

function revisionSummary(revision) {
  return {
    id: revision.id,
    validationPassed: Boolean(revision.validation?.passed),
    artifactCount: revision.artifacts.length,
    artifacts: revision.artifacts.map((artifact) => ({
      kind: artifact.kind,
      name: artifact.name,
      url: artifact.url,
      bytes: artifact.bytes,
    })),
    spec: {
      partType: revision.engineeringSpec.partType,
      length: revision.engineeringSpec.length,
      height: revision.engineeringSpec.height,
      width: revision.engineeringSpec.width,
      thickness: revision.engineeringSpec.thickness,
      holeDiameter: revision.engineeringSpec.holeDiameter,
      edgeOffset: revision.engineeringSpec.edgeOffset,
      chamfer: revision.engineeringSpec.chamfer,
      units: revision.engineeringSpec.units,
    },
  };
}

async function getJSON(path) {
  const response = await fetchURL(path);
  assert(response.ok, `${path} returned ${response.status}`);
  return response.json();
}

async function postSSE(path, body) {
  const response = await fetchURL(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  const text = await response.text();
  const events = [];
  for (const chunk of text.split("\n\n")) {
    const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    const event = JSON.parse(dataLine.slice(5).trim());
    if (event.type === "error") {
      throw new Error(event.userMessage || event.message || "SSE error");
    }
    events.push(event);
  }
  return events;
}

function lastEvent(events, type) {
  return events.filter((event) => event.type === type).at(-1);
}

function fetchURL(pathOrUrl, init = {}) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
  return fetch(url, { ...init, headers: { ...authHeader, ...(init.headers ?? {}) } });
}

function basicAuthHeader() {
  const user = process.env.STAGING_BASIC_AUTH_USER;
  const password = process.env.STAGING_BASIC_AUTH_PASSWORD;
  if (!user || !password) return {};
  return {
    Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") {
      parsed.outputPath = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return parsed;
}
