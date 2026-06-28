import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { CAD_OUTPUT_ROOT, artifactIdFromPath } from "../lib/cad/artifacts";
import { adminRouteAccess, canAccessProject, getRequestAuthContext } from "../lib/server/auth";
import { GET as getArtifact } from "../app/api/artifacts/[id]/route";

const PROJECT_STORE_PATH = path.resolve(process.cwd(), "logs", "projects.json");

test("project access allows owners, org members, and admins only", () => {
  const project = { ownerUserId: "user_owner", organizationId: "org_a" };

  assert.equal(canAccessProject({ isAuthenticated: true, userId: "user_owner", isAdmin: false }, project), true);
  assert.equal(canAccessProject({ isAuthenticated: true, userId: "user_b", organizationId: "org_a", isAdmin: false }, project), true);
  assert.equal(canAccessProject({ isAuthenticated: true, userId: "user_b", organizationId: "org_b", isAdmin: false }, project), false);
  assert.equal(canAccessProject({ isAuthenticated: true, userId: "admin", isAdmin: true }, project), true);
});

test("admin route access allows only authenticated admins", () => {
  assert.equal(adminRouteAccess({ isAuthenticated: false, isAdmin: false }), "sign_in");
  assert.equal(adminRouteAccess({ isAuthenticated: true, userId: "member", isAdmin: false }), "forbidden");
  assert.equal(adminRouteAccess({ isAuthenticated: true, userId: "admin", isAdmin: true }), "allow");
  assert.equal(
    adminRouteAccess({ isAuthenticated: true, userId: "org-owner", organizationRole: "owner", isAdmin: false }),
    "allow",
  );
  assert.equal(adminRouteAccess({ isAuthenticated: true, email: "admin@example.com", isAdmin: false }), "forbidden");
});

test("artifact download requires auth and project ownership", async () => {
  const envSnapshot = snapshotEnv([
    "CLERK_SECRET_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "STAGING_BASIC_AUTH_USER",
    "STAGING_BASIC_AUTH_PASSWORD",
    "SAAS_DEV_AUTH_BYPASS",
    "SAAS_DEV_USER_ID",
    "SAAS_DEV_ORG_ID",
    "SAAS_DEV_ADMIN",
    "DATABASE_URL",
  ]);
  const previousStore = await readIfExists(PROJECT_STORE_PATH);
  const runDir = path.join(CAD_OUTPUT_ROOT, `authz-test-${Date.now()}`);
  await fs.mkdir(runDir, { recursive: true });
  const artifactPath = path.join(runDir, "model.step");
  await fs.writeFile(artifactPath, "step-bytes", "utf8");
  const artifactId = artifactIdFromPath(artifactPath);

  try {
    clearAuthEnv();
    await writeProjectStore({ artifactId, ownerUserId: "allowed-user", organizationId: "allowed-org" });
    const unauth = await getArtifact(new Request(`http://test/api/artifacts/${artifactId}`), {
      params: Promise.resolve({ id: artifactId }),
    });
    assert.equal(unauth.status, 401);

    process.env.SAAS_DEV_AUTH_BYPASS = "1";
    process.env.SAAS_DEV_USER_ID = "allowed-user";
    process.env.SAAS_DEV_ORG_ID = "allowed-org";
    process.env.SAAS_DEV_ADMIN = "0";
    await writeProjectStore({ artifactId, ownerUserId: "other-user", organizationId: "other-org" });
    const forbidden = await getArtifact(new Request(`http://test/api/artifacts/${artifactId}`), {
      params: Promise.resolve({ id: artifactId }),
    });
    assert.equal(forbidden.status, 403);

    await writeProjectStore({ artifactId, ownerUserId: "allowed-user", organizationId: "other-org" });
    const allowed = await getArtifact(new Request(`http://test/api/artifacts/${artifactId}`), {
      params: Promise.resolve({ id: artifactId }),
    });
    assert.equal(allowed.status, 200);
  } finally {
    restoreEnv(envSnapshot);
    if (previousStore === undefined) {
      await fs.rm(PROJECT_STORE_PATH, { force: true });
    } else {
      await fs.mkdir(path.dirname(PROJECT_STORE_PATH), { recursive: true });
      await fs.writeFile(PROJECT_STORE_PATH, previousStore, "utf8");
    }
    await fs.rm(runDir, { recursive: true, force: true });
  }
});

test("Basic Auth is not a SaaS identity once Clerk is configured", async () => {
  const envSnapshot = snapshotEnv([
    "CLERK_SECRET_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "STAGING_BASIC_AUTH_USER",
    "STAGING_BASIC_AUTH_PASSWORD",
    "SAAS_DEV_AUTH_BYPASS",
  ]);
  try {
    process.env.CLERK_SECRET_KEY = "sk_test_fake";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_fake";
    process.env.STAGING_BASIC_AUTH_USER = "cad";
    process.env.STAGING_BASIC_AUTH_PASSWORD = "secret";
    delete process.env.SAAS_DEV_AUTH_BYPASS;

    const header = `Basic ${Buffer.from("cad:secret").toString("base64")}`;
    const auth = await getRequestAuthContext(new Request("http://test/app/projects", { headers: { authorization: header } }));

    assert.equal(auth.isAuthenticated, false);
    assert.equal(auth.source, undefined);
  } finally {
    restoreEnv(envSnapshot);
  }
});

async function writeProjectStore({
  artifactId,
  ownerUserId,
  organizationId,
}: {
  artifactId: string;
  ownerUserId: string;
  organizationId: string;
}) {
  await fs.mkdir(path.dirname(PROJECT_STORE_PATH), { recursive: true });
  await fs.writeFile(
    PROJECT_STORE_PATH,
    `${JSON.stringify(
      {
        version: 1,
        projects: [
          {
            id: "project-authz",
            ownerUserId,
            organizationId,
            title: "Authz project",
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z",
            latestRevisionId: "rev-authz",
            messages: [],
            revisions: [
              {
                id: "rev-authz",
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
                    id: artifactId,
                    kind: "step",
                    label: "STEP model",
                    name: "model.step",
                    url: `/api/artifacts/${artifactId}`,
                    bytes: 10,
                    contentType: "model/step",
                  },
                ],
                validation: { passed: true, checks: [] },
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function readIfExists(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function clearAuthEnv() {
  for (const name of [
    "CLERK_SECRET_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "STAGING_BASIC_AUTH_USER",
    "STAGING_BASIC_AUTH_PASSWORD",
    "SAAS_DEV_AUTH_BYPASS",
    "SAAS_DEV_USER_ID",
    "SAAS_DEV_ORG_ID",
    "SAAS_DEV_ADMIN",
    "DATABASE_URL",
  ]) {
    delete process.env[name];
  }
}

function snapshotEnv(names: string[]) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
