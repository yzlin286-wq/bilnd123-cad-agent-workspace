export type WorkstreamStatus = "pending" | "running" | "done" | "failed";

export type WorkstreamStep = {
  id: string;
  label: string;
  status: WorkstreamStatus;
  detail?: string;
};

export type EngineeringSpec = {
  partType: "mounting_plate" | "l_bracket" | string;
  length: number;
  height?: number;
  width: number;
  thickness: number;
  holeDiameter: number;
  edgeOffset: number;
  chamfer: number;
  material: string;
  units: "mm" | "inch" | string;
};

export type ParameterManifestItem = {
  key: keyof EngineeringSpec | string;
  label: string;
  value: number | string;
  unit?: string;
  min?: number;
  max?: number;
};

export type CADArtifactKind =
  | "step"
  | "stl"
  | "drawingSvg"
  | "source"
  | "spec"
  | "validation"
  | "manifest"
  | "log";

export type CADArtifact = {
  id: string;
  kind: CADArtifactKind;
  label: string;
  name: string;
  url: string;
  bytes: number;
  contentType: string;
};

export type ValidationCheck = {
  name: string;
  expected: number | string;
  actual: number | string;
  passed: boolean;
};

export type ValidationReport = {
  passed: boolean;
  checks: ValidationCheck[];
  metrics?: Record<string, unknown>;
};

export type CADRevision = {
  id: string;
  prompt?: string;
  createdAt: string;
  engineeringSpec: EngineeringSpec;
  parameterManifest: ParameterManifestItem[];
  artifacts: CADArtifact[];
  validation?: ValidationReport;
};

export const WORKSTREAM_TEMPLATE: WorkstreamStep[] = [
  { id: "understand", label: "Understanding request", status: "pending" },
  { id: "spec", label: "Creating engineering spec", status: "pending" },
  { id: "source", label: "Writing build123d model", status: "pending" },
  { id: "kernel", label: "Running CAD kernel", status: "pending" },
  { id: "step", label: "Exporting STEP", status: "pending" },
  { id: "preview", label: "Rendering preview mesh", status: "pending" },
  { id: "validation", label: "Validating geometry", status: "pending" },
  { id: "package", label: "Packaging files", status: "pending" },
];
