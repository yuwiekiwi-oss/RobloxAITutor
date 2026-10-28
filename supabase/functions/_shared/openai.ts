// Minimal OpenAI Responses API client (POST /v1/responses) with Structured Outputs.
// Docs: https://developers.openai.com/api/docs/guides/structured-outputs

import { env, type ImageDetail, type ReasoningEffort } from "./env.ts";

export type InputContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: ImageDetail };

export type InputMessage = {
  role: "user" | "assistant" | "developer";
  content: string | InputContentPart[];
};

export type StructuredRequest = {
  model: string;
  instructions: string;
  input: InputMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  reasoningEffort: ReasoningEffort;
  maxOutputTokens: number;
};

export class OpenAIError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

type ResponsesApiResult = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  model?: string;
  error?: { message?: string } | null;
  output?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string; refusal?: string }>;
  }>;
  usage?: Record<string, unknown>;
};

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

export async function createStructuredResponse<T>(
  req: StructuredRequest,
): Promise<{ data: T; model: string; usage?: Record<string, unknown> }> {
  const body = {
    model: req.model,
    instructions: req.instructions,
    input: req.input,
    reasoning: { effort: req.reasoningEffort },
    max_output_tokens: req.maxOutputTokens,
    store: false,
    text: {
      format: { type: "json_schema", name: req.schemaName, strict: true, schema: req.schema },
    },
  };

  let res: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(`${env.openaiBaseUrl()}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.ok || !RETRYABLE.has(res.status) || attempt === 1) break;
    await new Promise((r) => setTimeout(r, 1200));
  }

  const result = (await res!.json().catch(() => ({}))) as ResponsesApiResult;
  if (!res!.ok) {
    throw new OpenAIError(result.error?.message ?? `OpenAI request failed (${res!.status})`, res!.status);
  }
  if (result.status === "incomplete") {
    throw new OpenAIError(`OpenAI response incomplete: ${result.incomplete_details?.reason ?? "unknown"}`);
  }

  let text = "";
  for (const item of result.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "refusal") throw new OpenAIError(`OpenAI refused: ${part.refusal ?? ""}`);
      if (part.type === "output_text") text += part.text ?? "";
    }
  }
  if (!text) throw new OpenAIError("OpenAI returned no output_text");

  try {
    return { data: JSON.parse(text) as T, model: result.model ?? req.model, usage: result.usage };
  } catch {
    throw new OpenAIError("OpenAI output was not valid JSON");
  }
}
