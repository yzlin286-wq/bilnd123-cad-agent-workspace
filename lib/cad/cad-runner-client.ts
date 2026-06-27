import { spawn } from "node:child_process";
import path from "node:path";
import { CAD_OUTPUT_ROOT, revisionFromManifest } from "@/lib/cad/artifacts";
import { getRuntimeConfig } from "@/lib/server/runtime";
import type { CADRevision, EngineeringSpec } from "@/lib/agent/spec";

type CADRunnerStdout = {
  ok: boolean;
  runDir?: string;
  artifacts?: {
    manifest?: string;
  };
  error?: string;
};

export class CADRunnerNotConfiguredError extends Error {
  constructor() {
    super("CAD runner command is not configured.");
    this.name = "CADRunnerNotConfiguredError";
  }
}

export async function runCADKernel({
  spec,
  prompt,
}: {
  spec: EngineeringSpec;
  prompt?: string;
}): Promise<CADRevision> {
  const command = getRuntimeConfig().cadRunnerCommand;
  if (!command) {
    throw new CADRunnerNotConfiguredError();
  }

  const result = await runConfiguredCommand(command, {
    spec,
    outputDir: CAD_OUTPUT_ROOT,
  });

  if (result.exitCode !== 0) {
    const runnerError = parseRunnerError(result.stderr);
    throw new Error(runnerError || `CAD runner exited with ${result.exitCode}`);
  }

  const payload = parseRunnerStdout(result.stdout);
  if (!payload.ok || !payload.artifacts?.manifest) {
    throw new Error(payload.error || "CAD runner did not return a manifest.");
  }

  return revisionFromManifest(path.resolve(payload.artifacts.manifest), prompt);
}

function runConfiguredCommand(command: string, body: unknown) {
  return new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      stderr += "\nCAD runner timed out after 60 seconds.";
    }, 60_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
    child.stdin.write(JSON.stringify(body));
    child.stdin.end();
  });
}

function parseRunnerStdout(stdout: string) {
  const lastLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!lastLine) {
    throw new Error("CAD runner produced no JSON output.");
  }
  return JSON.parse(lastLine) as CADRunnerStdout;
}

function parseRunnerError(stderr: string) {
  const lastLine = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!lastLine) return "";
  try {
    const payload = JSON.parse(lastLine) as CADRunnerStdout;
    return payload.error ?? lastLine;
  } catch {
    return lastLine;
  }
}
