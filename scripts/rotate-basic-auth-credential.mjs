#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_FILE = ".env";
const DEFAULT_CREDENTIAL_PATH = "/opt/bilnd123-cad-agent-workspace/admin-credential.txt";
const DEFAULT_USER = "cad-admin";
const PASSWORD_BYTES = 30;

export async function rotateBasicAuthCredential(options = {}) {
  const envFile = options.envFile || process.env.STAGING_ENV_FILE || DEFAULT_ENV_FILE;
  const credentialPath =
    options.credentialPath ||
    process.env.V12_ADMIN_CREDENTIAL_PATH ||
    process.env.ADMIN_BOOTSTRAP_CREDENTIAL_PATH ||
    DEFAULT_CREDENTIAL_PATH;
  const user = stringValue(options.user || process.env.STAGING_BASIC_AUTH_USER || DEFAULT_USER);
  const accessMode = stringValue(options.accessMode || process.env.STAGING_ACCESS_MODE || "http_restricted");
  const password = stringValue(options.password) || generateBasicAuthPassword();

  if (!user) {
    throw new Error("STAGING_BASIC_AUTH_USER is required.");
  }
  if (password.length < 16) {
    throw new Error("STAGING_BASIC_AUTH_PASSWORD must be at least 16 characters.");
  }
  if (!["http_restricted", "private_network_or_tunnel", "https"].includes(accessMode)) {
    throw new Error("STAGING_ACCESS_MODE must be http_restricted, private_network_or_tunnel, or https.");
  }

  await updateStagingEnvFile(envFile, {
    user,
    password,
    accessMode,
    credentialPath,
  });
  await writeBasicAuthCredentialFile(credentialPath, {
    user,
    password,
    accessMode,
  });

  return {
    ok: true,
    user,
    envFile: path.resolve(envFile),
    credentialPath: path.resolve(credentialPath),
    accessMode,
    passwordPresent: true,
    passwordGenerated: !stringValue(options.password),
    passwordDelivery: "server_file",
    rotationRequired: true,
  };
}

export async function updateStagingEnvFile(filePath, { user, password, accessMode, credentialPath } = {}) {
  const absolutePath = path.resolve(filePath);
  let text = "";
  try {
    text = await readFile(absolutePath, "utf8");
  } catch {
    text = "";
  }

  const lines = text.split(/\r?\n/);
  upsertEnvLine(lines, "STAGING_BASIC_AUTH_USER", user);
  upsertEnvLine(lines, "STAGING_BASIC_AUTH_PASSWORD", password);
  upsertEnvLine(lines, "STAGING_ACCESS_MODE", accessMode);
  upsertEnvLine(lines, "V12_ADMIN_PASSWORD_DELIVERY", "server_file");
  upsertEnvLine(lines, "V12_ADMIN_CREDENTIAL_PATH", credentialPath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${compactEnvLines(lines).join("\n")}\n`, "utf8");
  await chmod(absolutePath, 0o600);
}

export async function writeBasicAuthCredentialFile(filePath, { user, password, accessMode } = {}) {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    [
      "Temporary HTTP staging Basic Auth credential",
      `username: ${user}`,
      `password: ${password}`,
      `access_mode: ${accessMode}`,
      "rotation_required: yes",
      `generated_at: ${new Date().toISOString()}`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(absolutePath, 0o600);
}

export function generateBasicAuthPassword() {
  return `cad-${randomBytes(PASSWORD_BYTES).toString("base64url")}`;
}

function upsertEnvLine(lines, key, value) {
  if (!value) return;
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
}

function compactEnvLines(lines) {
  while (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--env-file" || arg === "--staging-env-file") options.envFile = args[++index];
    else if (arg === "--credential-path") options.credentialPath = args[++index];
    else if (arg === "--user") options.user = args[++index];
    else if (arg === "--password") options.password = args[++index];
    else if (arg === "--password-stdin") options.passwordStdin = true;
    else if (arg === "--access-mode") options.accessMode = args[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
  }
  return options;
}

async function readStdin() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    text += chunk;
  }
  return text.trim();
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/rotate-basic-auth-credential.mjs [options]",
      "",
      "Options:",
      "  --staging-env-file <path>   Server-only .env path. Defaults to .env",
      "  --credential-path <path>    Server-only credential file path",
      "  --user <name>               Basic Auth user. Defaults to cad-admin",
      "  --password-stdin            Read the new password from stdin",
      "  --password <value>          New password. Prefer --password-stdin on servers",
      "  --access-mode <mode>        http_restricted, private_network_or_tunnel, or https",
    ].join("\n"),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.passwordStdin) {
    options.password = await readStdin();
  }

  try {
    const result = await rotateBasicAuthCredential(options);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.name : "BasicAuthRotationError",
        message: error instanceof Error ? error.message : "Failed to rotate staging Basic Auth credentials.",
      }),
    );
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (entryPath && path.resolve(process.argv[1]) === entryPath) {
  main();
}
