import type { EngineeringSpec } from "./spec";
import { templateById } from "@/lib/cad/templates";

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
    return normalizeSpec(mergeSpecRecords(currentSpec, delta));
  }

  if (isRecord(engineeringSpec)) {
    return normalizeSpec(mergeSpecRecords(currentSpec, engineeringSpec));
  }

  throw new Error("AI model returned neither a specDelta nor an engineeringSpec.");
}

export function normalizeSpec(raw: Record<string, unknown>): EngineeringSpec {
  const partType = String(raw.partType ?? raw.part_type ?? "mounting_plate");
  const rawParameters = isRecord(raw.parameters) ? raw.parameters : {};
  const template = templateById(partType);
  const parameters: Record<string, number | string | boolean> = {};
  for (const parameter of template?.parameters ?? []) {
    const value = raw[parameter.key] ?? rawParameters[parameter.key] ?? parameter.default;
    parameters[parameter.key] = typeof parameter.default === "number" ? number(value, parameter.key) : String(value);
  }
  for (const [key, value] of Object.entries(rawParameters)) {
    if (parameters[key] === undefined && (typeof value === "number" || typeof value === "string" || typeof value === "boolean")) {
      parameters[key] = value;
    }
  }

  return {
    partType,
    parameters,
    ...parameters,
    length: number(raw.length ?? parameters.length ?? parameters.outerDiameter ?? parameters.diameter ?? 1, "length"),
    height: optionalNumber(raw.height ?? parameters.height, "height"),
    width: number(raw.width ?? parameters.width ?? parameters.outerDiameter ?? parameters.diameter ?? 1, "width"),
    thickness: number(raw.thickness ?? parameters.thickness ?? parameters.width ?? parameters.wireDiameter ?? 1, "thickness"),
    holeDiameter: number(
      raw.holeDiameter ?? raw.hole_diameter ?? raw.holeDia ?? parameters.holeDiameter ?? parameters.boreDiameter ?? parameters.innerDiameter ?? 1,
      "holeDiameter",
    ),
    edgeOffset: number(raw.edgeOffset ?? raw.edge_offset ?? parameters.edgeOffset ?? 1, "edgeOffset"),
    chamfer: number(raw.chamfer ?? parameters.chamfer ?? 0, "chamfer"),
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

function mergeSpecRecords(currentSpec: EngineeringSpec, patch: Record<string, unknown>) {
  const currentParameters = isRecord(currentSpec.parameters) ? currentSpec.parameters : {};
  const patchParameters = isRecord(patch.parameters) ? patch.parameters : {};
  const parameters: Record<string, unknown> = {
    ...currentParameters,
    ...patchParameters,
  };
  for (const [key, value] of Object.entries(patch)) {
    if (!["partType", "material", "units", "parameters"].includes(key)) {
      parameters[key] = value;
    }
  }
  const merged: Record<string, unknown> = {
    ...currentSpec,
    ...patch,
    parameters,
  };
  for (const [key, value] of Object.entries(parameters)) {
    merged[key] = value;
  }
  return merged;
}
