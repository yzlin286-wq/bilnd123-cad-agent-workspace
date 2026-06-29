import { AgentRuntimeConfig } from "@/lib/server/runtime";
import { CAD_TEMPLATES, SUPPORTED_TEMPLATE_IDS } from "@/lib/cad/templates";

type ChatCompletionChoice = {
  message?: {
    content?: string;
  };
};

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[];
  error?: {
    message?: string;
  };
};

type ModelCallResult = {
  model: string;
  content: string;
};

type JSONSchema = {
  name: string;
  schema: Record<string, unknown>;
};

const ENGINEERING_SPEC_SCHEMA: JSONSchema = {
  name: "engineering_spec_response",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      engineeringSpec: {
        type: "object",
        additionalProperties: false,
        properties: engineeringSpecSchemaProperties(),
        required: ["partType", "material", "units"],
      },
    },
    required: ["engineeringSpec"],
  },
};

const SPEC_REVISION_SCHEMA: JSONSchema = {
  name: "engineering_spec_revision_response",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      specDelta: {
        type: "object",
        additionalProperties: false,
        properties: engineeringSpecSchemaProperties(),
      },
      engineeringSpec: {
        type: "object",
        additionalProperties: false,
        properties: engineeringSpecSchemaProperties(),
        required: ["partType", "material", "units"],
      },
    },
    anyOf: [{ required: ["specDelta"] }, { required: ["engineeringSpec"] }],
  },
};

const CUSTOM_BUILD123D_SCHEMA: JSONSchema = {
  name: "custom_build123d_response",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      engineeringSpec: {
        type: "object",
        additionalProperties: false,
        properties: {
          partType: { type: "string" },
          material: { type: "string" },
          units: { type: "string" },
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              source: { type: "string" },
              description: { type: "string" },
            },
            required: ["source", "description"],
          },
        },
        required: ["partType", "material", "units", "parameters"],
      },
    },
    required: ["engineeringSpec"],
  },
};

export async function callWorkstreamPlanner({
  prompt,
  config,
}: {
  prompt: string;
  config: AgentRuntimeConfig;
}): Promise<ModelCallResult> {
  if (!config.baseUrl || !config.apiKey || !config.primaryModel) {
    throw new Error("Real LLM runtime is not configured.");
  }

  const models = [config.primaryModel, config.downgradeModel].filter(
    (model, index, list): model is string => Boolean(model) && list.indexOf(model) === index,
  );

  const errors: string[] = [];
  for (const model of models) {
    try {
      const content = await callOpenAICompatibleModel({
        prompt,
        model,
        config,
        systemPrompt: `You are a CAD agent planner. Return only JSON with an engineeringSpec object. The CAD runner supports these exact partType values: ${SUPPORTED_TEMPLATE_IDS.join(", ")}. Use the closest supported template only when the requested object truly matches that template. Do not approximate an unsupported object as another template. Put template-specific dimensions in engineeringSpec.parameters and also include common flat fields when they naturally exist. Use millimeters unless the user explicitly asks otherwise. Do not generate fallback CAD code. Template catalog: ${templateCatalogPrompt()}`,
        jsonSchema: ENGINEERING_SPEC_SCHEMA,
      });
      if (!content.trim()) {
        throw new Error("The model returned empty content.");
      }
      return { model, content };
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All configured real model calls failed. ${errors.join(" | ")}`);
}

export async function callSpecRevisionPlanner({
  currentSpec,
  currentRevisionId,
  userPrompt,
  config,
}: {
  currentSpec: unknown;
  currentRevisionId: string;
  userPrompt: string;
  config: AgentRuntimeConfig;
}): Promise<ModelCallResult> {
  if (!config.baseUrl || !config.apiKey || !config.primaryModel) {
    throw new Error("Real LLM runtime is not configured.");
  }

  const prompt = JSON.stringify(
    {
      currentRevisionId,
      currentSpec,
      userPrompt,
      instruction:
        "Revise the existing CAD spec. Preserve every unchanged field from currentSpec. Prefer returning only specDelta with changed fields. engineeringSpec may be included for validation only. Do not treat the userPrompt as a brand new model.",
    },
    null,
    2,
  );
  const models = [config.primaryModel, config.downgradeModel].filter(
    (model, index, list): model is string => Boolean(model) && list.indexOf(model) === index,
  );

  const errors: string[] = [];
  for (const model of models) {
    try {
      const content = await callOpenAICompatibleModel({
        prompt,
        model,
        config,
        systemPrompt:
          `You revise an existing build123d engineering spec. Supported partType values: ${SUPPORTED_TEMPLATE_IDS.join(", ")}. Return JSON only. Prefer a specDelta containing only changed fields, including nested parameters when only template-specific values change. Preserve every unchanged field and every unchanged parameters value. Never reinterpret a revision instruction as a new part request.`,
        jsonSchema: SPEC_REVISION_SCHEMA,
      });
      if (!content.trim()) {
        throw new Error("The model returned empty content.");
      }
      return { model, content };
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All configured real model calls failed. ${errors.join(" | ")}`);
}

export async function callCustomBuild123dPlanner({
  prompt,
  config,
}: {
  prompt: string;
  config: AgentRuntimeConfig;
}): Promise<ModelCallResult> {
  if (!config.baseUrl || !config.apiKey || !config.primaryModel) {
    throw new Error("Real LLM runtime is not configured.");
  }

  const models = [config.primaryModel, config.downgradeModel].filter(
    (model, index, list): model is string => Boolean(model) && list.indexOf(model) === index,
  );

  const errors: string[] = [];
  for (const model of models) {
    try {
      const content = await callOpenAICompatibleModel({
        prompt,
        model,
        config,
        systemPrompt:
          "You generate restricted build123d source for internal CAD staging. Return JSON only with engineeringSpec.partType='custom_build123d'. Put source in engineeringSpec.parameters.source. The source must define build_part() and return a build123d Part or builder.part. Do not import modules, read files, write files, use network, use subprocess, or call export functions. Use only build123d primitives that will be provided by the runner. Do not generate fallback placeholder geometry. If the requested part cannot be faithfully modeled as a safe single build123d part, make build_part() raise ValueError('CUSTOM_CODEGEN_REJECTED: request is too complex for custom_build123d') so the run fails without artifacts.",
        jsonSchema: CUSTOM_BUILD123D_SCHEMA,
      });
      if (!content.trim()) {
        throw new Error("The model returned empty content.");
      }
      return { model, content };
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All configured real model calls failed. ${errors.join(" | ")}`);
}

async function callOpenAICompatibleModel({
  prompt,
  model,
  config,
  systemPrompt,
  jsonSchema,
}: {
  prompt: string;
  model: string;
  config: AgentRuntimeConfig;
  systemPrompt: string;
  jsonSchema: JSONSchema;
}) {
  const endpoint = `${config.baseUrl?.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model,
    temperature: 0.2,
    max_tokens: 1600,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: jsonSchema.name,
        strict: true,
        schema: jsonSchema.schema,
      },
    },
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  };
  let response = await postChatCompletion(endpoint, config.apiKey, body);

  if (await isResponseFormatUnsupported(response)) {
    response = await postChatCompletion(endpoint, config.apiKey, {
      ...body,
      response_format: { type: "json_object" },
    });
  }

  if (await isResponseFormatUnsupported(response)) {
    response = await postChatCompletion(endpoint, config.apiKey, withoutResponseFormat(body));
  }

  const text = await response.text();
  let payload: ChatCompletionResponse | null = null;
  try {
    payload = JSON.parse(text) as ChatCompletionResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error?.message ?? text.slice(0, 500) ?? response.statusText;
    throw new Error(message);
  }

  const content = payload?.choices?.[0]?.message?.content ?? text;
  assertValidJSON(content);
  return content;
}

function postChatCompletion(endpoint: string, apiKey: string | undefined, body: Record<string, unknown>) {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function isResponseFormatUnsupported(response: Response) {
  if (response.ok) return false;
  const text = await response.clone().text();
  return /response_format|json_schema|schema/i.test(text);
}

function withoutResponseFormat(body: Record<string, unknown>) {
  const plainBody = { ...body };
  delete plainBody.response_format;
  return plainBody;
}

function assertValidJSON(content: string) {
  const candidate = repairJSONCandidate(content);
  try {
    JSON.parse(candidate);
  } catch (error) {
    throw new Error(
      `Model did not return valid JSON. ${error instanceof Error ? error.message : "Unknown JSON parse error."}`,
    );
  }
}

export function repairJSONCandidate(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? content;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return candidate.trim();
  }
  return candidate
    .slice(firstBrace, lastBrace + 1)
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function engineeringSpecSchemaProperties() {
  const parameterProperties = Object.fromEntries(parameterKeys().map((key) => [key, { type: "number" }]));
  return {
    partType: { type: "string" },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: parameterProperties,
    },
    ...parameterProperties,
    material: { type: "string" },
    units: { type: "string" },
  };
}

function parameterKeys() {
  return [...new Set(CAD_TEMPLATES.flatMap((template) => template.parameters.map((parameter) => parameter.key)))];
}

function templateCatalogPrompt() {
  return CAD_TEMPLATES.map((template) => {
    const params = template.parameters.map((parameter) => parameter.key).join(", ");
    const aliases = template.aliases.join(", ");
    return `${template.id} (${template.title}; aliases: ${aliases}; parameters: ${params}; example: ${template.examplePrompt})`;
  }).join(" | ");
}
