import { promises as fs } from "node:fs";
import path from "node:path";
import { CAD_OUTPUT_ROOT } from "@/lib/cad/artifacts";
import { isCADRunnerConfigured, isLLMConfigured } from "@/lib/server/runtime";

export const runtime = "nodejs";

const supportedTemplates = ["mounting_plate", "l_bracket"];

export async function GET() {
  const outputDirWritable = await canWriteOutputDir();
  const cadRunnerConfigured = isCADRunnerConfigured();
  const llmConfigured = isLLMConfigured();
  const httpsConfigured = Boolean(process.env.STAGING_DOMAIN?.trim());
  const warning =
    process.env.NODE_ENV === "production" && !httpsConfigured
      ? "Staging is running without HTTPS domain; restrict access."
      : undefined;

  return Response.json({
    ok: outputDirWritable,
    app: "ok",
    cadRunnerConfigured,
    llmConfigured,
    outputDirWritable,
    httpsConfigured,
    warning,
    supportedTemplates,
  });
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
