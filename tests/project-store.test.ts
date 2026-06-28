import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendProjectMessage,
  appendProjectRevision,
  createProject,
  getProject,
  listProjects,
  PROJECT_STORE_PATH,
  shouldUsePostgresStore,
} from "../lib/server/project-store";
import type { CADRevision } from "../lib/agent/spec";

test("project store persists messages, revisions, and artifact metadata without secrets", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-store-"));
  const storePath = path.join(tempRoot, "projects.json");
  const project = await createProject({
    prompt: "Make a plate api_key=secret-value",
    auth: { isAuthenticated: true, userId: "user_a", organizationId: "org_a", isAdmin: false },
    storePath,
  });

  await appendProjectMessage({
    projectId: project.id,
    role: "user",
    content: "Make a plate password=hunter2",
    route: "/api/agent/run",
    storePath,
  });
  await appendProjectRevision({
    projectId: project.id,
    revision: fakeRevision("rev001"),
    route: "/api/agent/run",
    storePath,
  });

  const stored = await getProject(project.id, storePath);
  const summaries = await listProjects({ storePath });
  const raw = await fs.readFile(storePath, "utf8");

  assert.equal(stored?.latestRevisionId, "rev001");
  assert.equal(stored?.ownerUserId, "user_a");
  assert.equal(stored?.organizationId, "org_a");
  assert.equal(stored?.messages.length, 2);
  assert.equal(stored?.revisions[0].artifacts[0].kind, "step");
  assert.equal(summaries[0].revisionCount, 1);
  assert.equal(raw.includes("secret-value"), false);
  assert.equal(raw.includes("hunter2"), false);

  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("project list filters by owner or organization", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-store-filter-"));
  const storePath = path.join(tempRoot, "projects.json");

  await createProject({
    prompt: "Owner project",
    auth: { isAuthenticated: true, userId: "user_a", organizationId: "org_a", isAdmin: false },
    storePath,
  });
  await createProject({
    prompt: "Other project",
    auth: { isAuthenticated: true, userId: "user_b", organizationId: "org_b", isAdmin: false },
    storePath,
  });

  const ownerProjects = await listProjects({
    storePath,
    auth: { isAuthenticated: true, userId: "user_a", organizationId: "org_a", isAdmin: false },
  });
  const adminProjects = await listProjects({
    storePath,
    auth: { isAuthenticated: true, userId: "admin", isAdmin: true },
  });

  assert.equal(ownerProjects.length, 1);
  assert.match(ownerProjects[0].title, /Owner/);
  assert.equal(adminProjects.length, 2);

  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("project store uses Postgres only for the default store path when DATABASE_URL is configured", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = "postgres://user:password@localhost:5432/cad_agent";
    assert.equal(shouldUsePostgresStore(PROJECT_STORE_PATH), true);
    assert.equal(shouldUsePostgresStore(path.join(os.tmpdir(), "projects.json")), false);
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});

function fakeRevision(id: string): CADRevision {
  return {
    id,
    prompt: "Make a plate token=raw-secret",
    createdAt: "2026-06-28T00:00:00.000Z",
    engineeringSpec: {
      partType: "mounting_plate",
      length: 120,
      width: 80,
      thickness: 4,
      holeDiameter: 4.5,
      edgeOffset: 10,
      chamfer: 1,
      material: "Aluminum 6061",
      units: "mm",
    },
    parameterManifest: [],
    artifacts: [
      {
        id: "artifact-id",
        kind: "step",
        label: "STEP model",
        name: "model.step",
        url: "/api/artifacts/artifact-id",
        bytes: 128,
        contentType: "model/step",
      },
    ],
    validation: { passed: true, checks: [] },
  };
}
