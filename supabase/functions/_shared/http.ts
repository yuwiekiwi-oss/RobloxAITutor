import { env } from "./env.ts";

export class HttpError extends Error {
  constructor(
    public status: number,
    /** Shown to the user, so keep it friendly Japanese. */
    public userMessage: string,
    public detail?: string,
  ) {
    super(detail ?? userMessage);
  }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = env.allowedOrigins();
  const allowOrigin = allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Wraps a handler with CORS preflight + uniform error responses. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    if (req.method !== "POST") return json(req, { error: "POST only" }, 405);
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.status >= 500) console.error(err.detail ?? err.userMessage);
        return json(req, { error: err.userMessage }, err.status);
      }
      console.error(err);
      return json(req, { error: "サーバーでエラーが起きました。少し待ってからもう一度ためしてね。" }, 500);
    }
  });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "リクエストの形が正しくありません。");
  }
}
