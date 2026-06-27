import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { CAD_OUTPUT_ROOT, revisionFromManifest } from "../lib/cad/artifacts";

test("revisionFromManifest rejects a manifest outside the CAD output root", async () => {
  const outside = path.resolve(CAD_OUTPUT_ROOT, "..", "outside-manifest.json");
  await fs.writeFile(outside, "{}", "utf8");
  await assert.rejects(() => revisionFromManifest(outside), /escapes output root/);
  await fs.rm(outside, { force: true });
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
