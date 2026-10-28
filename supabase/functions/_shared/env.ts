// Runtime configuration for Edge Functions. Model names are never hard-coded:
// set TUTOR_MODEL (and optionally SUMMARY_MODEL) with `supabase secrets set`.

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export type ImageDetail = "low" | "high" | "original" | "auto";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return Deno.env.get(name)?.trim() || undefined;
}

/** New Supabase key env vars are JSON dictionaries; legacy ones are plain strings. */
function supabaseKey(legacyNames: string[], dictName: string): string {
  for (const name of legacyNames) {
    const value = optional(name);
    if (value) return value;
  }
  const dict = optional(dictName);
  if (dict) {
    try {
      const keys = JSON.parse(dict) as Record<string, string>;
      const value = keys.default ?? Object.values(keys)[0];
      if (value) return value;
    } catch {
      // fall through
    }
  }
  throw new Error(`Missing Supabase key (${[...legacyNames, dictName].join(" / ")})`);
}

export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  serviceKey: () =>
    supabaseKey(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"], "SUPABASE_SECRET_KEYS"),

  openaiApiKey: () => required("OPENAI_API_KEY"),
  openaiBaseUrl: () => optional("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",

  tutorModel: () => required("TUTOR_MODEL"),
  summaryModel: () => optional("SUMMARY_MODEL") ?? required("TUTOR_MODEL"),
  tutorReasoningEffort: () => (optional("TUTOR_REASONING_EFFORT") ?? "low") as ReasoningEffort,
  summaryReasoningEffort: () => (optional("SUMMARY_REASONING_EFFORT") ?? "low") as ReasoningEffort,
  tutorImageDetail: () => (optional("TUTOR_IMAGE_DETAIL") ?? "high") as ImageDetail,

  /** LINE Login channel (LINE Developers console) for the parent page. */
  lineChannelId: () => required("LINE_CHANNEL_ID"),
  lineChannelSecret: () => required("LINE_CHANNEL_SECRET"),

  /** Comma separated list. Empty = allow any origin (auth is via bearer token, not cookies). */
  allowedOrigins: () =>
    (optional("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
};
