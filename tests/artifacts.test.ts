import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { CAD_OUTPUT_ROOT, contentTypeFor, revisionFromManifest } from "../lib/cad/artifacts";

test("revisionFromManifest rejects a manifest outside the CAD output root", async () => {
  const outside = path.resolve(CAD_OUTPUT_ROOT, "..", "outside-manifest.json");
  await assert.rejects(() => revisionFromManifest(outside), /escapes output root/);
});

test("revisionFromManifest rejects artifact paths that escape the CAD output root", async () => {
  const runDir = path.join(CAD_OUTPUT_ROOT, `path-test-${Date.now()}`);
  await fs.mkdir(runDir, { recursive: true });
  const manifestPath = path.join(runDir, "manifest.json");
  const escapedValidationPath = path.resolve(CAD_OUTPUT_ROOT, "..", "escaped-validation.json");

  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      revisionId: "path-test",
      createdAt: new Date().toISOString(),
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
          kind: "validation",
          label: "Validation report",
          name: "validation.json",
          path: escapedValidationPath,
          bytes: 2,
        },
      ],
    }),
    "utf8",
  );

  await assert.rejects(() => revisionFromManifest(manifestPath), /escapes output root/);
  await fs.rm(runDir, { recursive: true, force: true });
});

test("revisionFromManifest exposes package.zip artifacts from the manifest", async () => {
  const runDir = path.join(CAD_OUTPUT_ROOT, `package-test-${Date.now()}`);
  await fs.mkdir(runDir, { recursive: true });
  const validationPath = path.join(runDir, "validation.json");
  const packagePath = path.join(runDir, "package.zip");
  const manifestPath = path.join(runDir, "manifest.json");

  await fs.writeFile(validationPath, JSON.stringify({ passed: true, checks: [] }), "utf8");
  await fs.writeFile(packagePath, "zip-bytes", "utf8");
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      revisionId: "package-test",
      createdAt: new Date().toISOString(),
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
          kind: "validation",
          label: "Validation report",
          name: "validation.json",
          path: validationPath,
          bytes: 27,
        },
        {
          kind: "package",
          label: "Complete artifact package",
          name: "package.zip",
          path: packagePath,
          bytes: 9,
        },
      ],
    }),
    "utf8",
  );

  const revision = await revisionFromManifest(manifestPath);
  const packageArtifact = revision.artifacts.find((artifact) => artifact.kind === "package");

  assert.equal(packageArtifact?.name, "package.zip");
  assert.equal(packageArtifact?.contentType, "application/zip");
  assert.equal(contentTypeFor(packagePath), "application/zip");
  await fs.rm(runDir, { recursive: true, force: true });
});
