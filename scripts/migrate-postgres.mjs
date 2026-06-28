#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.log(JSON.stringify({ ok: true, migrated: false, reason: "DATABASE_URL is not configured." }));
  process.exit(0);
}

const schemaPath = path.resolve(process.cwd(), "db", "schema.sql");
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  ssl: shouldUseSSL(databaseUrl) ? { rejectUnauthorized: false } : undefined,
});

try {
  const sql = await readFile(schemaPath, "utf8");
  await pool.query(sql);
  console.log(JSON.stringify({ ok: true, migrated: true, schema: "db/schema.sql" }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, migrated: false, error: error instanceof Error ? error.name : "MigrationError" }));
  process.exitCode = 1;
} finally {
  await pool.end();
}

function shouldUseSSL(connectionString) {
  if (process.env.DATABASE_SSL === "1") return true;
  try {
    return new URL(connectionString).searchParams.get("sslmode") === "require";
  } catch {
    return false;
  }
}
