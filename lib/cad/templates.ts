import templateData from "@/cad_templates.json";

export type CADTemplateParameter = {
  key: string;
  label: string;
  unit?: string;
  default: number | string;
  min?: number;
  max?: number;
};

export type CADTemplateDefinition = {
  id: string;
  title: string;
  category: string;
  description: string;
  examplePrompt: string;
  aliases: string[];
  parameters: CADTemplateParameter[];
};

export const CAD_TEMPLATES = templateData as CADTemplateDefinition[];
export const SUPPORTED_TEMPLATE_IDS = CAD_TEMPLATES.map((template) => template.id);
export const SUPPORTED_TEMPLATE_ID_SET = new Set(SUPPORTED_TEMPLATE_IDS);
export const SUPPORTED_TEMPLATE_TEXT = SUPPORTED_TEMPLATE_IDS.join(", ");

export function templateById(id: string | undefined) {
  return CAD_TEMPLATES.find((template) => template.id === id);
}

export function templateExamplePrompts(limit = 6) {
  return CAD_TEMPLATES.slice(0, limit).map((template) => template.examplePrompt);
}

export function templatesByCategory() {
  return CAD_TEMPLATES.reduce<Record<string, CADTemplateDefinition[]>>((groups, template) => {
    groups[template.category] = [...(groups[template.category] ?? []), template];
    return groups;
  }, {});
}
