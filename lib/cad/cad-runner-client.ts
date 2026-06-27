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

type QueueWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let activeRunnerCount = 0;
const runnerQueue: QueueWaiter[] = [];

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
  const config = getRuntimeConfig();
  const command = config.cadRunnerCommand;
  if (!command) {
    throw new CADRunnerNotConfiguredError();
  }

  return withCADRunnerSlot(config.cadRunnerTimeoutMs, config.cadMaxConcurrentRuns, async () => {
    const result = await runConfiguredCommand(
      command,
      {
        spec,
        outputDir: CAD_OUTPUT_ROOT,
      },
      config.cadRunnerTimeoutMs,
    );

    if (result.exitCode !== 0) {
      const runnerError = parseRunnerError(result.stderr);
      throw new Error(runnerError || `CAD runner exited with ${result.exitCode}`);
    }

    const payload = parseRunnerStdout(result.stdout);
    if (!payload.ok || !payload.artifacts?.manifest) {
      throw new Error(payload.error || "CAD runner did not return a manifest.");
    }

    return revisionFromManifest(path.resolve(payload.artifacts.manifest), prompt);
  });
}

async function withCADRunnerSlot<T>(timeoutMs: number, maxConcurrentRuns: number, task: () => Promise<T>) {
  await acquireRunnerSlot(timeoutMs, maxConcurrentRuns);
  try {
    return await task();
  } finally {
    releaseRunnerSlot(maxConcurrentRuns);
  }
}

function acquireRunnerSlot(timeoutMs: number, maxConcurrentRuns: number) {
  if (activeRunnerCount < maxConcurrentRuns) {
    activeRunnerCount += 1;
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const waiter: QueueWaiter = {
      resolve: () => {
        clearTimeout(waiter.timer);
        activeRunnerCount += 1;
        resolve();
      },
      reject,
      timer: setTimeout(() => {
        const index = runnerQueue.indexOf(waiter);
        if (index >= 0) runnerQueue.splice(index, 1);
        reject(new Error("CAD runner queue timed out. Please retry when the current job finishes."));
      }, timeoutMs),
    };
    runnerQueue.push(waiter);
  });
}

function releaseRunnerSlot(maxConcurrentRuns: number) {
  activeRunnerCount = Math.max(0, activeRunnerCount - 1);
  while (runnerQueue.length > 0 && activeRunnerCount < maxConcurrentRuns) {
    const waiter = runnerQueue.shift();
    waiter?.resolve();
  }
}

function runConfiguredCommand(command: string, body: unknown, timeoutMs: number) {
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
      stderr += `\nCAD runner timed out after ${timeoutMs} ms.`;
    }, timeoutMs);

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
