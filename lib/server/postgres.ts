import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | undefined;

export type PostgresHealth = {
  configured: boolean;
  connected: boolean;
  schemaReady: boolean;
  requiredTables: string[];
  missingTables: string[];
  error?: string;
};

export const REQUIRED_POSTGRES_TABLES = ["projects", "messages", "revisions", "artifacts", "feedback", "usage_events"] as const;

export function isPostgresConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPostgresPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      ssl: shouldUseSSL(connectionString) ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function queryPostgres<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return getPostgresPool().query<T>(text, values);
}

export async function withPostgresTransaction<T>(callback: (client: pg.PoolClient) => Promise<T>) {
  const client = await getPostgresPool().connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function checkPostgresHealth(): Promise<PostgresHealth> {
  if (!isPostgresConfigured()) {
    return {
      configured: false,
      connected: false,
      schemaReady: false,
      requiredTables: [...REQUIRED_POSTGRES_TABLES],
      missingTables: [...REQUIRED_POSTGRES_TABLES],
    };
  }
  try {
    const result = await queryPostgres<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name = any($1::text[])`,
      [[...REQUIRED_POSTGRES_TABLES]],
    );
    const presentTables = result.rows.map((row) => row.table_name);
    const missingTables = missingRequiredPostgresTables(presentTables);
    return {
      configured: true,
      connected: true,
      schemaReady: missingTables.length === 0,
      requiredTables: [...REQUIRED_POSTGRES_TABLES],
      missingTables,
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      schemaReady: false,
      requiredTables: [...REQUIRED_POSTGRES_TABLES],
      missingTables: [...REQUIRED_POSTGRES_TABLES],
      error: error instanceof Error ? error.name : "PostgresError",
    };
  }
}

export function missingRequiredPostgresTables(presentTables: Iterable<string>) {
  const present = new Set([...presentTables].map((table) => table.trim().toLowerCase()).filter(Boolean));
  return REQUIRED_POSTGRES_TABLES.filter((table) => !present.has(table));
}

function shouldUseSSL(connectionString: string) {
  if (process.env.DATABASE_SSL === "1") return true;
  try {
    const url = new URL(connectionString);
    return url.searchParams.get("sslmode") === "require";
  } catch {
    return false;
  }
}
