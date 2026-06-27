export type DataLayerStatus = {
  mode: "postgres_ready" | "dev_json_fallback";
  projectStore: string;
  migrationPath: string;
  productionReady: boolean;
  todo?: string;
};

export function getDataLayerStatus(): DataLayerStatus {
  if (process.env.DATABASE_URL?.trim()) {
    return {
      mode: "postgres_ready",
      projectStore: "postgres",
      migrationPath: "db/schema.sql",
      productionReady: true,
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
