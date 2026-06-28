#!/usr/bin/env node

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const secretKey = requiredEnv("CLERK_SECRET_KEY");
const email = requiredEnv("ADMIN_BOOTSTRAP_EMAIL").toLowerCase();
const password = requiredEnv("ADMIN_BOOTSTRAP_PASSWORD");
const firstName = process.env.ADMIN_BOOTSTRAP_FIRST_NAME || "CAD";
const lastName = process.env.ADMIN_BOOTSTRAP_LAST_NAME || "Admin";
const credentialPath = process.env.ADMIN_BOOTSTRAP_CREDENTIAL_PATH;
const envFile = process.env.ADMIN_BOOTSTRAP_ENV_FILE;

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

  if (currentUser) {
    user = await clerk.users.updateUserMetadata(currentUser.id, {
      publicMetadata: { ...(currentUser.publicMetadata || {}), ...metadata },
      privateMetadata: { ...(currentUser.privateMetadata || {}), ...metadata },
    });
    if (process.env.ADMIN_BOOTSTRAP_RESET_PASSWORD === "1") {
      user = await clerk.users.updateUser(currentUser.id, {
        password,
        signOutOfOtherSessions: true,
      });
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
  }

  if (envFile) {
    await ensureAdminEmailInEnvFile(envFile, email);
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

async function ensureAdminEmailInEnvFile(filePath, adminEmail) {
  const absolutePath = path.resolve(filePath);
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
  const merged = [...new Set([...existingEmails, adminEmail])].join(",");
  if (existingIndex >= 0) {
    lines[existingIndex] = `SAAS_ADMIN_EMAILS=${merged}`;
  } else {
    lines.push(`SAAS_ADMIN_EMAILS=${merged}`);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${lines.filter((line, index) => line || index < lines.length - 1).join("\n")}\n`, "utf8");
  await chmod(absolutePath, 0o600);
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
