import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | undefined;

export type PostgresHealth = {
  configured: boolean;
  connected: boolean;
  schemaReady: boolean;
  error?: string;
};

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
    return { configured: false, connected: false, schemaReady: false };
  }
  try {
    const result = await queryPostgres<{ exists: boolean }>(
      "select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'projects') as exists",
    );
    return {
      configured: true,
      connected: true,
      schemaReady: Boolean(result.rows[0]?.exists),
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      schemaReady: false,
      error: error instanceof Error ? error.name : "PostgresError",
    };
  }
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
