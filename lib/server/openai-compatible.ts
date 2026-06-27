import { AgentRuntimeConfig } from "@/lib/server/runtime";

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
        properties: {
          length: { type: "number" },
          width: { type: "number" },
          thickness: { type: "number" },
          holeDiameter: { type: "number" },
          edgeOffset: { type: "number" },
          chamfer: { type: "number" },
          material: { type: "string" },
          units: { type: "string" },
        },
        required: ["length", "width", "thickness", "holeDiameter", "edgeOffset", "chamfer", "material", "units"],
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
        properties: {
          length: { type: "number" },
          width: { type: "number" },
          thickness: { type: "number" },
          holeDiameter: { type: "number" },
          edgeOffset: { type: "number" },
          chamfer: { type: "number" },
          material: { type: "string" },
          units: { type: "string" },
        },
      },
      engineeringSpec: {
        type: "object",
        additionalProperties: false,
        properties: {
          length: { type: "number" },
          width: { type: "number" },
          thickness: { type: "number" },
          holeDiameter: { type: "number" },
          edgeOffset: { type: "number" },
          chamfer: { type: "number" },
          material: { type: "string" },
          units: { type: "string" },
        },
        required: ["length", "width", "thickness", "holeDiameter", "edgeOffset", "chamfer", "material", "units"],
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
        systemPrompt:
          "You are a CAD agent planner. Return only JSON with an engineeringSpec object. Required engineeringSpec fields: length, width, thickness, holeDiameter, edgeOffset, chamfer, material, units. Use millimeters unless the user explicitly asks otherwise. Do not generate fallback CAD code.",
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
        "Revise the existing CAD spec. Preserve every unchanged field from currentSpec. Return an updated engineeringSpec plus an optional specDelta. Do not treat the userPrompt as a brand new model.",
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
          "You revise an existing build123d mounting plate engineering spec. Return JSON only. Preserve unchanged dimensions, holeDiameter, edgeOffset, chamfer, material, and units. Never reinterpret a revision instruction as a new part request.",
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

  if (!response.ok && (await response.clone().text()).match(/response_format|json_schema|schema/i)) {
    response = await postChatCompletion(endpoint, config.apiKey, {
      ...body,
      response_format: { type: "json_object" },
    });
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
