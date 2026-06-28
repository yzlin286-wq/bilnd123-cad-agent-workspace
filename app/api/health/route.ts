import { promises as fs } from "node:fs";
import path from "node:path";
import { CAD_OUTPUT_ROOT } from "@/lib/cad/artifacts";
import { getDataLayerStatus } from "@/lib/server/data-layer";
import { isCADRunnerConfigured, isLLMConfigured } from "@/lib/server/runtime";

export const runtime = "nodejs";

const supportedTemplates = ["mounting_plate", "l_bracket"];
const accessModes = new Set(["https", "private_network_or_tunnel", "http_restricted", "unknown"]);

export async function GET() {
  const outputDirWritable = await canWriteOutputDir();
  const cadRunnerConfigured = isCADRunnerConfigured();
  const llmConfigured = isLLMConfigured();
  const httpsConfigured = isHttpsConfigured();
  const accessMode = parseStagingAccessMode();
  const warning = healthWarning({ nodeEnv: process.env.NODE_ENV, httpsConfigured });
  const dataLayer = await getDataLayerStatus();
  const auth = authPosture();

  return Response.json({
    ok: outputDirWritable,
    app: "ok",
    cadRunnerConfigured,
    llmConfigured,
    outputDirWritable,
    httpsConfigured,
    accessMode,
    warning,
    auth,
    dataLayer,
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

export function isHttpsConfigured({
  stagingDomain = process.env.STAGING_DOMAIN,
  stagingHttpsEnabled = process.env.STAGING_HTTPS_ENABLED,
} = {}) {
  return Boolean(stagingDomain?.trim() && stagingHttpsEnabled === "1");
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

export function authPosture({
  clerkSecretKey = process.env.CLERK_SECRET_KEY,
  clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  stagingBasicAuthUser = process.env.STAGING_BASIC_AUTH_USER,
  stagingBasicAuthPassword = process.env.STAGING_BASIC_AUTH_PASSWORD,
  devBypass = process.env.SAAS_DEV_AUTH_BYPASS,
  adminUserIds = process.env.SAAS_ADMIN_USER_IDS,
  adminEmails = process.env.SAAS_ADMIN_EMAILS,
} = {}) {
  return {
    clerkConfigured: Boolean(clerkSecretKey?.trim() && clerkPublishableKey?.trim()),
    basicAuthConfigured: Boolean(stagingBasicAuthUser?.trim() && stagingBasicAuthPassword?.trim()),
    devBypassEnabled: devBypass === "1",
    adminAllowlistConfigured: Boolean(adminUserIds?.trim() || adminEmails?.trim()),
  };
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
