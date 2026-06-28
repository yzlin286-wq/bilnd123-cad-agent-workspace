import { checkPostgresHealth, isPostgresConfigured } from "@/lib/server/postgres";

export type DataLayerStatus = {
  mode: "postgres" | "dev_json_fallback";
  projectStore: string;
  migrationPath: string;
  productionReady: boolean;
  connected?: boolean;
  schemaReady?: boolean;
  requiredTables?: string[];
  missingTables?: string[];
  todo?: string;
};

export async function getDataLayerStatus(): Promise<DataLayerStatus> {
  if (isPostgresConfigured()) {
    const health = await checkPostgresHealth();
    return {
      mode: "postgres",
      projectStore: "postgres",
      migrationPath: "db/schema.sql",
      productionReady: health.connected && health.schemaReady,
      connected: health.connected,
      schemaReady: health.schemaReady,
      requiredTables: health.requiredTables,
      missingTables: health.missingTables,
      todo: health.connected && health.schemaReady ? undefined : "Run npm run db:migrate and verify DATABASE_URL.",
    };
  }
  return {
    mode: "dev_json_fallback",
    projectStore: "logs/projects.json",
    migrationPath: "db/schema.sql",
    productionReady: false,
    todo: "Provision Postgres/Supabase and wire the repository adapter before claiming production SaaS persistence.",
  };
}
