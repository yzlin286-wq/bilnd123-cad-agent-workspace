#!/usr/bin/env node

const baseUrl = requiredEnv("STAGING_BASE_URL").replace(/\/$/, "");
const authHeader = basicAuthHeader();

const initialPrompt = "Make a 120 x 80 x 4 mm mounting plate with four 4.5 mm holes, 10 mm edge offset, and 1 mm chamfer";
const revisionPrompt = "change thickness to 6 mm";

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

for (const kind of ["step", "stl", "validation"]) {
  const artifact = rev002.artifacts.find((item) => item.kind === kind);
  assert(artifact, `missing ${kind} artifact`);
  const response = await fetchURL(artifact.url);
  assert(response.status === 200, `${kind} download returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer()).byteLength;
  assert(bytes > 0, `${kind} download was empty`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      health: {
        cadRunnerConfigured: health.cadRunnerConfigured,
        llmConfigured: health.llmConfigured,
        outputDirWritable: health.outputDirWritable,
      },
      rev001: rev001.id,
      rev002: rev002.id,
      artifactCount: rev002.artifacts.length,
    },
    null,
    2,
  ),
);

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
