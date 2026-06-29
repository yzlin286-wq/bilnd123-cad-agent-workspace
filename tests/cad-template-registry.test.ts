import assert from "node:assert/strict";
import test from "node:test";
import { CAD_TEMPLATES, SUPPORTED_TEMPLATE_IDS, templateById } from "../lib/cad/templates";

test("CAD template registry exposes the 20 common mechanical templates", () => {
  assert.equal(CAD_TEMPLATES.length, 20);
  for (const id of [
    "mounting_plate",
    "l_bracket",
    "simple_enclosure",
    "round_flange",
    "stepped_shaft",
    "spur_gear",
    "helical_spring",
    "bearing_mount_block",
  ]) {
    assert.equal(SUPPORTED_TEMPLATE_IDS.includes(id), true, `${id} missing`);
    assert.ok(templateById(id)?.examplePrompt);
  }

  const spring = templateById("helical_spring");
  assert.ok(spring?.aliases.includes("螺旋弹簧"));
  assert.ok(spring?.aliases.includes("弹簧"));
});
