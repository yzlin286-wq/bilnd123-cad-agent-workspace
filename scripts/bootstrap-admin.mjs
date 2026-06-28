#!/usr/bin/env node

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const secretKey = requiredEnv("CLERK_SECRET_KEY");
  const email = requiredEnv("ADMIN_BOOTSTRAP_EMAIL").toLowerCase();
  const password = requiredEnv("ADMIN_BOOTSTRAP_PASSWORD");
  const firstName = process.env.ADMIN_BOOTSTRAP_FIRST_NAME || "CAD";
  const lastName = process.env.ADMIN_BOOTSTRAP_LAST_NAME || "Admin";
  const credentialPath = process.env.ADMIN_BOOTSTRAP_CREDENTIAL_PATH;
  const envFile = process.env.ADMIN_BOOTSTRAP_ENV_FILE;
  const shouldSetExistingUserPassword = process.env.ADMIN_BOOTSTRAP_RESET_PASSWORD !== "0";

  if (password.length < 12) {
    fail("ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters.");
  }

  try {
    const { createClerkClient } = await import("@clerk/backend");
    const clerk = createClerkClient({ secretKey });
    const existing = await clerk.users.getUserList({ emailAddress: [email], limit: 1 });
    const currentUser = existing.data?.[0];
    const metadata = { role: "admin" };
    let user;
    let created = false;
    let passwordUpdated = false;

    if (currentUser) {
      user = await clerk.users.updateUserMetadata(currentUser.id, {
        publicMetadata: { ...(currentUser.publicMetadata || {}), ...metadata },
        privateMetadata: { ...(currentUser.privateMetadata || {}), ...metadata },
      });
      if (shouldSetExistingUserPassword) {
        user = await clerk.users.updateUser(currentUser.id, {
          password,
          signOutOfOtherSessions: true,
        });
        passwordUpdated = true;
      }
    } else {
      user = await clerk.users.createUser({
        emailAddress: [email],
        password,
        firstName,
        lastName,
        publicMetadata: metadata,
        privateMetadata: metadata,
      });
      created = true;
      passwordUpdated = true;
    }

    if (envFile) {
      await updateAdminHandoffEnvFile(envFile, { adminEmail: email, credentialPath });
    }
    if (credentialPath) {
      await writeCredentialFile(credentialPath, email, password);
    }

    console.log(
      JSON.stringify({
        ok: true,
        created,
        userId: user.id,
        email,
        role: "admin",
        passwordUpdated,
        passwordDeliveredToFile: Boolean(credentialPath),
        envFileUpdated: Boolean(envFile),
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.name : "ClerkBootstrapError",
        message: "Admin bootstrap failed. Check Clerk credentials and email/password policy.",
      }),
    );
    process.exitCode = 1;
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`${name} is required.`);
  }
  return value;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: "BOOTSTRAP_CONFIG_ERROR", message }));
  process.exit(1);
}

export async function updateAdminHandoffEnvFile(filePath, { adminEmail, credentialPath } = {}) {
  const absolutePath = path.resolve(filePath);
  const normalizedAdminEmail = String(adminEmail || "").trim().toLowerCase();
  let text = "";
  try {
    text = await readFile(absolutePath, "utf8");
  } catch {
    text = "";
  }
  const lines = text.split(/\r?\n/);
  const existingIndex = lines.findIndex((line) => line.startsWith("SAAS_ADMIN_EMAILS="));
  const existingEmails =
    existingIndex >= 0
      ? lines[existingIndex]
          .slice("SAAS_ADMIN_EMAILS=".length)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  const merged = [...new Set([...existingEmails, normalizedAdminEmail].filter(Boolean))].join(",");
  upsertEnvLine(lines, "SAAS_ADMIN_EMAILS", merged);
  upsertEnvLine(lines, "ADMIN_BOOTSTRAP_EMAIL", normalizedAdminEmail);
  upsertEnvLine(lines, "V12_ADMIN_EMAIL", normalizedAdminEmail);
  if (credentialPath) {
    upsertEnvLine(lines, "ADMIN_BOOTSTRAP_CREDENTIAL_PATH", credentialPath);
    upsertEnvLine(lines, "V12_ADMIN_PASSWORD_DELIVERY", "server_file");
    upsertEnvLine(lines, "V12_ADMIN_CREDENTIAL_PATH", credentialPath);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${lines.filter((line, index) => line || index < lines.length - 1).join("\n")}\n`, "utf8");
  await chmod(absolutePath, 0o600);
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

async function writeCredentialFile(filePath, adminEmail, adminPassword) {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    [
      "CAD Agent staging admin credential",
      `email=${adminEmail}`,
      `password=${adminPassword}`,
      "rotation_required=yes",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(absolutePath, 0o600);
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (entryPath && path.resolve(process.argv[1]) === entryPath) {
  main();
}
