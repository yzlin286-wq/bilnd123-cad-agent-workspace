#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUTPUT = "outputs/reports/v12-admin-verify.json";

export function evaluateAdminVerification({
  clerkSecretConfigured,
  clerkPublishableConfigured,
  adminEmail,
  user,
  allowedAdminEmails = [],
  allowedAdminUserIds = [],
  error,
} = {}) {
  const normalizedEmail = normalizeEmail(adminEmail);
  const primaryEmail = normalizeEmail(user?.primaryEmailAddress?.emailAddress || firstEmail(user));
  const publicRole = metadataRole(user?.publicMetadata);
  const privateRole = metadataRole(user?.privateMetadata);
  const adminByMetadata = publicRole === "admin" || privateRole === "admin";
  const adminByEmail = Boolean(normalizedEmail && allowedAdminEmails.map(normalizeEmail).includes(normalizedEmail));
  const adminByUserId = Boolean(user?.id && allowedAdminUserIds.includes(user.id));
  const adminAuthorized = adminByMetadata || adminByEmail || adminByUserId;

  const checks = [];
  add(checks, "clerk_secret_configured", clerkSecretConfigured === true, "CLERK_SECRET_KEY must be configured.");
  add(
    checks,
    "clerk_publishable_configured",
    clerkPublishableConfigured === true,
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be configured.",
  );
  add(checks, "admin_email_declared", Boolean(normalizedEmail), "ADMIN_BOOTSTRAP_EMAIL or V12_ADMIN_EMAIL must be declared.");
  add(checks, "clerk_lookup_succeeded", !error, "The Clerk Backend API lookup must succeed.");
  add(checks, "admin_user_found", Boolean(user?.id), "The declared admin email must exist in Clerk.");
  add(checks, "admin_primary_email_matches", Boolean(normalizedEmail && primaryEmail === normalizedEmail), "The Clerk user email must match.");
  add(checks, "admin_user_not_banned", user?.banned === false, "The admin user must not be banned.");
  add(checks, "admin_user_not_locked", user?.locked === false, "The admin user must not be locked.");
  add(checks, "admin_password_enabled", user?.passwordEnabled === true, "The admin user must have password login enabled.");
  add(checks, "admin_authorized", adminAuthorized, "The admin user must be authorized by metadata or admin allowlist.");

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    adminEmail: normalizedEmail,
    userId: user?.id || "",
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    evidence: {
      userFound: Boolean(user?.id),
      primaryEmail,
      passwordEnabled: user?.passwordEnabled === true,
      banned: user?.banned === true,
      locked: user?.locked === true,
      publicRole,
      privateRole,
      adminByMetadata,
      adminByEmail,
      adminByUserId,
      adminAuthorized,
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = options.output || DEFAULT_OUTPUT;
  const adminEmail = normalizeEmail(options.adminEmail || process.env.ADMIN_BOOTSTRAP_EMAIL || process.env.V12_ADMIN_EMAIL);
  const clerkSecret = process.env.CLERK_SECRET_KEY?.trim();
  const clerkPublishable = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const allowedAdminEmails = envList("SAAS_ADMIN_EMAILS");
  const allowedAdminUserIds = envList("SAAS_ADMIN_USER_IDS");

  let user;
  let error;
  if (clerkSecret && adminEmail) {
    try {
      const { createClerkClient } = await import("@clerk/backend");
      const clerk = createClerkClient({ secretKey: clerkSecret });
      const result = await clerk.users.getUserList({ emailAddress: [adminEmail], limit: 1 });
      user = result.data?.[0];
    } catch (caught) {
      error = caught instanceof Error ? caught.name : "ClerkAdminLookupError";
    }
  }

  const result = evaluateAdminVerification({
    clerkSecretConfigured: Boolean(clerkSecret),
    clerkPublishableConfigured: Boolean(clerkPublishable),
    adminEmail,
    user,
    allowedAdminEmails,
    allowedAdminUserIds,
    error,
  });

  await writeJson(output, result);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") options.output = args[++index];
    else if (arg === "--admin-email") options.adminEmail = args[++index];
  }
  return options;
}

async function writeJson(filePath, data) {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function firstEmail(user) {
  return Array.isArray(user?.emailAddresses) ? user.emailAddresses[0]?.emailAddress : "";
}

function metadataRole(metadata) {
  return metadata && typeof metadata === "object" && typeof metadata.role === "string" ? metadata.role : "";
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function envList(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function add(checks, id, ok, message) {
  checks.push({ id, ok: Boolean(ok), message });
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (entryPath && path.resolve(process.argv[1]) === entryPath) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.name : "AdminVerifyError",
        message: "Admin verification failed before completion.",
      }),
    );
    process.exitCode = 1;
  });
}
