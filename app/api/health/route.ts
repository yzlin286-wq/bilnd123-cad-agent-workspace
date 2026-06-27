import { promises as fs } from "node:fs";
import path from "node:path";
import { CAD_OUTPUT_ROOT } from "@/lib/cad/artifacts";
import { isCADRunnerConfigured, isLLMConfigured } from "@/lib/server/runtime";

export const runtime = "nodejs";

const supportedTemplates = ["mounting_plate", "l_bracket"];
const accessModes = new Set(["https", "private_network_or_tunnel", "http_restricted", "unknown"]);

export async function GET() {
  const outputDirWritable = await canWriteOutputDir();
  const cadRunnerConfigured = isCADRunnerConfigured();
  const llmConfigured = isLLMConfigured();
  const httpsConfigured = Boolean(process.env.STAGING_DOMAIN?.trim());
  const accessMode = parseStagingAccessMode();
  const warning = healthWarning({ nodeEnv: process.env.NODE_ENV, httpsConfigured });

  return Response.json({
    ok: outputDirWritable,
    app: "ok",
    cadRunnerConfigured,
    llmConfigured,
    outputDirWritable,
    httpsConfigured,
    accessMode,
    warning,
    supportedTemplates,
  });
}

export function parseStagingAccessMode(value = process.env.STAGING_ACCESS_MODE) {
  const configured = value?.trim();
  if (configured && accessModes.has(configured)) {
    return configured;
  }
  return "unknown";
}

export function healthWarning({
  nodeEnv = process.env.NODE_ENV,
  httpsConfigured,
}: {
  nodeEnv?: string;
  httpsConfigured: boolean;
}) {
  return nodeEnv === "production" && !httpsConfigured
    ? "Staging is running without HTTPS domain; restrict access."
    : undefined;
}

async function canWriteOutputDir() {
  try {
    await fs.mkdir(CAD_OUTPUT_ROOT, { recursive: true });
    const probe = path.join(CAD_OUTPUT_ROOT, `.health-${process.pid}-${Date.now()}`);
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}
