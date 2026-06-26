import { spawn } from "node:child_process";
import { getRuntimeConfig } from "@/lib/server/runtime";

export const runtime = "nodejs";

type CADRunRequest = {
  spec?: unknown;
  source?: string;
};

export async function POST(request: Request) {
  const config = getRuntimeConfig();
  if (!config.cadRunnerCommand) {
    return Response.json(
      {
        error: "CAD runner is not configured",
        detail:
          "Set CAD_RUNNER_COMMAND to a real build123d runner. The API will not synthesize CAD files as a fallback.",
        missing: ["CAD_RUNNER_COMMAND"],
        noFallbackPolicy: {
          directCodeGenerationFallback: false,
          allowedFallback: "real LLM model downgrade only before CAD execution",
        },
      },
      { status: 503 },
    );
  }

  let body: CADRunRequest;
  try {
    body = (await request.json()) as CADRunRequest;
  } catch {
    return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const result = await runConfiguredCADRunner(config.cadRunnerCommand, body);
  return Response.json(result, { status: result.exitCode === 0 ? 200 : 500 });
}

function runConfiguredCADRunner(command: string, body: CADRunRequest) {
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
