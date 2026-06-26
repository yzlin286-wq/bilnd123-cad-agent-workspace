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
      const content = await callOpenAICompatibleModel({ prompt, model, config });
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
}: {
  prompt: string;
  model: string;
  config: AgentRuntimeConfig;
}) {
  const endpoint = `${config.baseUrl?.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1600,
      messages: [
        {
          role: "system",
          content:
            "You are a CAD agent planner. Return only JSON with an engineeringSpec object. Required engineeringSpec fields: length, width, thickness, holeDiameter, edgeOffset, chamfer, material, units. Use millimeters unless the user explicitly asks otherwise. Do not generate fallback CAD code.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

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

  return payload?.choices?.[0]?.message?.content ?? text;
}
