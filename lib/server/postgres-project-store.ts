import { randomUUID } from "node:crypto";
import type { CADArtifact, CADRevision, EngineeringSpec, ParameterManifestItem, ValidationReport } from "@/lib/agent/spec";
import type { ArtifactOwnership, StoredMessage, StoredProject, StoredProjectSummary, StoredRevision } from "@/lib/project/types";
import type { AuthContext } from "@/lib/server/auth";
import type { RunHistoryRoute } from "@/lib/server/run-history";
import { withPostgresTransaction, queryPostgres } from "@/lib/server/postgres";
import { ensureAuthPrincipal } from "@/lib/server/postgres-principal";
import { sanitizeStoredText, titleFromPrompt } from "@/lib/server/sanitize";

type ProjectRow = {
  id: string;
  owner_user_id: string | null;
  organization_id: string | null;
  title: string;
  latest_revision_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ProjectSummaryRow = ProjectRow & {
  revision_count: string | number;
  message_count: string | number;
  part_type: string | null;
};

type MessageRow = {
  id: string;
  role: "user" | "agent";
  content: string;
  route: RunHistoryRoute | null;
  revision_id: string | null;
  error_code: string | null;
  created_at: Date | string;
};

type RevisionRow = {
  id: string;
  prompt: string | null;
  engineering_spec: EngineeringSpec;
  parameter_manifest: ParameterManifestItem[];
  validation: ValidationReport | null;
  created_at: Date | string;
};

type ArtifactRow = {
  id: string;
  revision_id: string;
  kind: CADArtifact["kind"];
  label: string;
  name: string;
  url: string;
  bytes: string | number;
  content_type: string;
  created_at: Date | string;
  project_id?: string;
  project_title?: string;
  part_type?: string;
};

export async function listProjectsPostgres({ limit = 10, auth }: { limit?: number; auth?: AuthContext } = {}) {
  const filter = projectAccessFilter(auth, 1);
  const result = await queryPostgres<ProjectSummaryRow>(
    `select
       p.id, p.owner_user_id, p.organization_id, p.title, p.latest_revision_id, p.created_at, p.updated_at,
       (select count(*) from revisions r where r.project_id = p.id)::int as revision_count,
       (select count(*) from messages m where m.project_id = p.id)::int as message_count,
       latest.engineering_spec->>'partType' as part_type
     from projects p
     left join lateral (
       select r.engineering_spec
       from revisions r
       where r.project_id = p.id
       order by (r.id = p.latest_revision_id) desc, r.created_at desc
       limit 1
     ) latest on true
     ${filter.sql}
     order by p.updated_at desc
     limit $${filter.values.length + 1}`,
    [...filter.values, limit],
  );
  return result.rows.map(summaryFromRow);
}

export async function getProjectPostgres(projectId: string): Promise<StoredProject | undefined> {
  const projectResult = await queryPostgres<ProjectRow>(
    `select id, owner_user_id, organization_id, title, latest_revision_id, created_at, updated_at
     from projects
     where id = $1`,
    [projectId],
  );
  const project = projectResult.rows[0];
  if (!project) return undefined;

  const [messageResult, revisionResult, artifactResult] = await Promise.all([
    queryPostgres<MessageRow>(
      `select id, role, content, route, revision_id, error_code, created_at
       from messages
       where project_id = $1
       order by created_at asc`,
      [projectId],
    ),
    queryPostgres<RevisionRow>(
      `select id, prompt, engineering_spec, parameter_manifest, validation, created_at
       from revisions
       where project_id = $1
       order by created_at asc`,
      [projectId],
    ),
    queryPostgres<ArtifactRow>(
      `select id, revision_id, kind, label, name, url, bytes, content_type, created_at
       from artifacts
       where project_id = $1
       order by created_at asc`,
      [projectId],
    ),
  ]);

  const artifactsByRevision = new Map<string, CADArtifact[]>();
  for (const artifact of artifactResult.rows) {
    const items = artifactsByRevision.get(artifact.revision_id) ?? [];
    items.push(artifactFromRow(artifact));
    artifactsByRevision.set(artifact.revision_id, items);
  }

  return {
    id: project.id,
    ownerUserId: project.owner_user_id || "unknown-user",
    organizationId: project.organization_id || undefined,
    title: project.title,
    latestRevisionId: project.latest_revision_id || undefined,
    createdAt: iso(project.created_at),
    updatedAt: iso(project.updated_at),
    messages: messageResult.rows.map(messageFromRow),
    revisions: revisionResult.rows.map((revision) => revisionFromRow(revision, artifactsByRevision.get(revision.id) ?? [])),
  };
}

export async function createProjectPostgres({ prompt, auth }: { prompt: string; auth: AuthContext }) {
  return withPostgresTransaction(async (client) => {
    const now = new Date().toISOString();
    const ownerUserId = auth.userId || "unknown-user";
    await ensureAuthPrincipal(client, { ...auth, userId: ownerUserId });
    const project: StoredProject = {
      id: randomUUID(),
      ownerUserId,
      organizationId: auth.organizationId,
      title: titleFromPrompt(prompt),
      createdAt: now,
      updatedAt: now,
      messages: [],
      revisions: [],
    };
    await client.query(
      `insert into projects (id, owner_user_id, organization_id, title, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [project.id, project.ownerUserId, project.organizationId ?? null, project.title, project.createdAt, project.updatedAt],
    );
    return project;
  });
}

export async function appendProjectMessagePostgres({
  projectId,
  role,
  content,
  route,
  revisionId,
  errorCode,
}: {
  projectId?: string;
  role: StoredMessage["role"];
  content: string;
  route?: RunHistoryRoute;
  revisionId?: string;
  errorCode?: string;
}) {
  if (!projectId) return undefined;
  const message: StoredMessage = {
    id: randomUUID(),
    role,
    content: sanitizeStoredText(content, 1000),
    createdAt: new Date().toISOString(),
    route,
    revisionId,
    errorCode,
  };
  const result = await queryPostgres<{ id: string }>(
    `insert into messages (id, project_id, role, content, route, revision_id, error_code, created_at)
     select $1, id, $2, $3, $4, $5, $6, $7
     from projects
     where id = $8
     returning id`,
    [message.id, message.role, message.content, message.route ?? null, message.revisionId ?? null, message.errorCode ?? null, message.createdAt, projectId],
  );
  if (!result.rowCount) return undefined;
  await queryPostgres("update projects set updated_at = $1 where id = $2", [message.createdAt, projectId]);
  return message;
}

export async function appendProjectRevisionPostgres({
  projectId,
  revision,
  route,
}: {
  projectId?: string;
  revision: CADRevision;
  route?: RunHistoryRoute;
}) {
  if (!projectId) return undefined;
  return withPostgresTransaction(async (client) => {
    const projectExists = await client.query<{ id: string }>(
      `select id
       from projects
       where id = $1`,
      [projectId],
    );
    if (!projectExists.rowCount) return undefined;

    const storedRevision = toStoredRevision(revision);
    await client.query(
      `insert into revisions (id, project_id, prompt, engineering_spec, parameter_manifest, validation, created_at)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)
       on conflict (id) do update set
         prompt = excluded.prompt,
         engineering_spec = excluded.engineering_spec,
         parameter_manifest = excluded.parameter_manifest,
         validation = excluded.validation`,
      [
        storedRevision.id,
        projectId,
        storedRevision.prompt ?? null,
        JSON.stringify(storedRevision.engineeringSpec),
        JSON.stringify(storedRevision.parameterManifest),
        storedRevision.validation ? JSON.stringify(storedRevision.validation) : null,
        storedRevision.createdAt,
      ],
    );
    await client.query("delete from artifacts where revision_id = $1", [storedRevision.id]);
    for (const artifact of storedRevision.artifacts) {
      await client.query(
        `insert into artifacts (id, project_id, revision_id, kind, label, name, url, bytes, content_type)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set
           project_id = excluded.project_id,
           revision_id = excluded.revision_id,
           kind = excluded.kind,
           label = excluded.label,
           name = excluded.name,
           url = excluded.url,
           bytes = excluded.bytes,
           content_type = excluded.content_type`,
        [
          artifact.id,
          projectId,
          storedRevision.id,
          artifact.kind,
          artifact.label,
          artifact.name,
          artifact.url,
          artifact.bytes,
          artifact.contentType,
        ],
      );
    }
    const countResult = await client.query<{ revision_count: number }>(
      "select count(*)::int as revision_count from revisions where project_id = $1",
      [projectId],
    );
    const revisionCount = Number(countResult.rows[0]?.revision_count ?? 0);
    const updatedAt = new Date().toISOString();
    await client.query("update projects set latest_revision_id = $1, updated_at = $2 where id = $3", [
      storedRevision.id,
      updatedAt,
      projectId,
    ]);
    await client.query(
      `insert into messages (id, project_id, role, content, route, revision_id, created_at)
       values ($1, $2, 'agent', $3, $4, $5, $6)`,
      [randomUUID(), projectId, `${formatRevision(revisionCount)} ready for review.`, route ?? null, storedRevision.id, updatedAt],
    );
    return storedRevision;
  });
}

export async function findArtifactOwnershipPostgres(artifactId: string): Promise<ArtifactOwnership | undefined> {
  const result = await queryPostgres<{
    artifact_id: string;
    project_id: string;
    revision_id: string;
    owner_user_id: string | null;
    organization_id: string | null;
    artifact_kind: CADArtifact["kind"];
  }>(
    `select
       a.id as artifact_id,
       a.project_id,
       a.revision_id,
       p.owner_user_id,
       p.organization_id,
       a.kind as artifact_kind
     from artifacts a
     join projects p on p.id = a.project_id
     where a.id = $1`,
    [artifactId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    artifactId: row.artifact_id,
    projectId: row.project_id,
    revisionId: row.revision_id,
    ownerUserId: row.owner_user_id || "unknown-user",
    organizationId: row.organization_id || undefined,
    artifactKind: row.artifact_kind,
  };
}

export async function findProjectByRevisionIdPostgres(revisionId: string) {
  const result = await queryPostgres<{ project_id: string }>("select project_id from revisions where id = $1", [revisionId]);
  const projectId = result.rows[0]?.project_id;
  return projectId ? getProjectPostgres(projectId) : undefined;
}

export async function recentArtifactsPostgres({
  auth,
  limit = 8,
}: {
  auth?: AuthContext;
  limit?: number;
} = {}) {
  const filter = projectAccessFilter(auth, 1, "p");
  const result = await queryPostgres<ArtifactRow>(
    `select
       a.id, a.revision_id, a.kind, a.label, a.name, a.url, a.bytes, a.content_type, a.created_at,
       p.id as project_id,
       p.title as project_title,
       r.engineering_spec->>'partType' as part_type
     from artifacts a
     join projects p on p.id = a.project_id
     join revisions r on r.id = a.revision_id
     ${filter.sql}
     order by a.created_at desc
     limit $${filter.values.length + 1}`,
    [...filter.values, limit],
  );
  return result.rows.map((row) => ({
    ...artifactFromRow(row),
    projectId: row.project_id || "",
    projectTitle: row.project_title || "",
    revisionId: row.revision_id,
    createdAt: iso(row.created_at),
    partType: row.part_type || undefined,
  }));
}

function summaryFromRow(row: ProjectSummaryRow): StoredProjectSummary {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id || "unknown-user",
    organizationId: row.organization_id || undefined,
    title: row.title,
    latestRevisionId: row.latest_revision_id || undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    revisionCount: Number(row.revision_count ?? 0),
    messageCount: Number(row.message_count ?? 0),
    partType: row.part_type || undefined,
  };
}

function messageFromRow(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: iso(row.created_at),
    route: row.route || undefined,
    revisionId: row.revision_id || undefined,
    errorCode: row.error_code || undefined,
  };
}

function revisionFromRow(row: RevisionRow, artifacts: CADArtifact[]): StoredRevision {
  return {
    id: row.id,
    prompt: row.prompt || undefined,
    createdAt: iso(row.created_at),
    engineeringSpec: row.engineering_spec,
    parameterManifest: row.parameter_manifest || [],
    artifacts,
    validation: row.validation || undefined,
  };
}

function artifactFromRow(row: ArtifactRow): CADArtifact {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    name: row.name,
    url: row.url,
    bytes: Number(row.bytes ?? 0),
    contentType: row.content_type,
  };
}

function toStoredRevision(revision: CADRevision): StoredRevision {
  return {
    ...revision,
    prompt: revision.prompt ? sanitizeStoredText(revision.prompt, 1000) : undefined,
    artifacts: revision.artifacts.map((artifact) => ({ ...artifact })),
  };
}

function formatRevision(index: number) {
  return `Rev ${String(index).padStart(3, "0")}`;
}

function projectAccessFilter(auth: AuthContext | undefined, startIndex: number, alias = "p") {
  if (!auth || auth.isAdmin) return { sql: "", values: [] as string[] };
  const clauses: string[] = [];
  const values: string[] = [];
  if (auth.userId) {
    values.push(auth.userId);
    clauses.push(`${alias}.owner_user_id = $${startIndex + values.length - 1}`);
  }
  if (auth.organizationId) {
    values.push(auth.organizationId);
    clauses.push(`${alias}.organization_id = $${startIndex + values.length - 1}`);
  }
  if (!clauses.length) return { sql: "where false", values };
  return { sql: `where (${clauses.join(" or ")})`, values };
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
