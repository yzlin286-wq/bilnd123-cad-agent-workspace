import type { EngineeringSpec } from "./spec";

export function mergeRevisionSpec({
  currentSpec,
  specDelta,
  engineeringSpec,
}: {
  currentSpec: EngineeringSpec;
  specDelta?: unknown;
  engineeringSpec?: unknown;
}) {
  const delta = isRecord(specDelta) ? specDelta : {};
  if (Object.keys(delta).length > 0) {
    return normalizeSpec({ ...currentSpec, ...delta });
  }

  if (isRecord(engineeringSpec)) {
    return normalizeSpec({ ...currentSpec, ...engineeringSpec });
  }

  throw new Error("AI model returned neither a specDelta nor an engineeringSpec.");
}

export function normalizeSpec(raw: Record<string, unknown>): EngineeringSpec {
  return {
    partType: String(raw.partType ?? raw.part_type ?? "mounting_plate"),
    length: number(raw.length, "length"),
    height: optionalNumber(raw.height, "height"),
    width: number(raw.width, "width"),
    thickness: number(raw.thickness, "thickness"),
    holeDiameter: number(raw.holeDiameter ?? raw.hole_diameter ?? raw.holeDia, "holeDiameter"),
    edgeOffset: number(raw.edgeOffset ?? raw.edge_offset, "edgeOffset"),
    chamfer: number(raw.chamfer ?? 0, "chamfer"),
    material: String(raw.material ?? "Aluminum 6061"),
    units: String(raw.units ?? "mm"),
  };
}

function optionalNumber(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  return number(value, field);
}

function number(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Engineering spec is missing numeric ${field}.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
