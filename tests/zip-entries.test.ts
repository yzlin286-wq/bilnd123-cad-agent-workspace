import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function loadZipModule() {
  const moduleUrl = pathToFileURL(path.resolve("scripts", "zip-entries.mjs")).href;
  return (await import(moduleUrl)) as {
    listZipEntries: (input: Uint8Array) => string[];
  };
}

test("listZipEntries reads package.zip central directory names", async () => {
  const { listZipEntries } = await loadZipModule();
  const zip = createEmptyZip(["model.step", "model.stl", "drawing.svg", "source.py", "spec.json", "validation.json", "manifest.json"]);

  assert.deepEqual(listZipEntries(zip), [
    "model.step",
    "model.stl",
    "drawing.svg",
    "source.py",
    "spec.json",
    "validation.json",
    "manifest.json",
  ]);
});

function createEmptyZip(names: string[]) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let localOffset = 0;

  for (const name of names) {
    const nameBuffer = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(0, 18);
    local.writeUInt32LE(0, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuffer.copy(local, 30);
    locals.push(local);

    const directory = Buffer.alloc(46 + nameBuffer.length);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt32LE(0, 12);
    directory.writeUInt32LE(0, 16);
    directory.writeUInt32LE(0, 20);
    directory.writeUInt32LE(0, 24);
    directory.writeUInt16LE(nameBuffer.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(localOffset, 42);
    nameBuffer.copy(directory, 46);
    central.push(directory);

    localOffset += local.length;
  }

  const centralDirectory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
}
