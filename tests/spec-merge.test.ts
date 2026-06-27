import assert from "node:assert/strict";
import test from "node:test";
import { mergeRevisionSpec } from "../lib/agent/spec-merge";
import type { EngineeringSpec } from "../lib/agent/spec";

const currentSpec: EngineeringSpec = {
  partType: "mounting_plate",
  length: 120,
  width: 80,
  thickness: 4,
  holeDiameter: 4.5,
  edgeOffset: 10,
  chamfer: 1,
  material: "Aluminum 6061",
  units: "mm",
};

test("revision merge applies only specDelta over currentSpec when both delta and engineeringSpec are present", () => {
  const merged = mergeRevisionSpec({
    currentSpec,
    specDelta: { thickness: 6 },
    engineeringSpec: {
      partType: "mounting_plate",
      length: 999,
      width: 999,
      thickness: 6,
      holeDiameter: 99,
      edgeOffset: 99,
      chamfer: 99,
      material: "Wrong material",
      units: "mm",
    },
  });

  assert.equal(merged.partType, "mounting_plate");
  assert.equal(merged.length, 120);
  assert.equal(merged.width, 80);
  assert.equal(merged.thickness, 6);
  assert.equal(merged.holeDiameter, 4.5);
  assert.equal(merged.edgeOffset, 10);
  assert.equal(merged.chamfer, 1);
  assert.equal(merged.material, "Aluminum 6061");
  assert.equal(merged.units, "mm");
});

test("revision merge uses engineeringSpec only when no specDelta is returned", () => {
  const merged = mergeRevisionSpec({
    currentSpec,
    engineeringSpec: {
      ...currentSpec,
      thickness: 6,
    },
  });

  assert.equal(merged.length, 120);
  assert.equal(merged.width, 80);
  assert.equal(merged.thickness, 6);
  assert.equal(merged.holeDiameter, 4.5);
  assert.equal(merged.edgeOffset, 10);
  assert.equal(merged.chamfer, 1);
});
