// Validation of an incoming RobloxContext + resolving screenshot paths to image data.
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { LIMITS, type RobloxContext } from "../contracts.ts";
import { HttpError } from "../http.ts";
import { cleanTree } from "../studioTree.ts";

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.slice(0, max) : undefined;

/**
 * Normalizes untrusted input. Screenshot paths must live in the caller's own folder for
 * this session, so a student can never make the tutor read someone else's images.
 */
export function sanitizeContext(raw: unknown, studentId: string, sessionId: string): RobloxContext {
  if (!raw || typeof raw !== "object") throw new HttpError(400, "送る内容が空っぽみたい。");
  const r = raw as Record<string, unknown>;

  const prefix = `${studentId}/${sessionId}/`;
  const screenshots = Array.isArray(r.screenshots)
    ? r.screenshots.filter((p): p is string =>
      typeof p === "string" && p.startsWith(prefix) && !p.includes("..") && p.length < 300
    )
    : [];
  if (screenshots.length > LIMITS.screenshotsPerMessage) {
    throw new HttpError(400, `画像は1回に${LIMITS.screenshotsPerMessage}枚までにしてね。`);
  }

  const cs = r.currentScript as Record<string, unknown> | undefined;
  const context: RobloxContext = {
    question: (typeof r.question === "string" ? r.question : "").slice(0, LIMITS.questionChars),
    code: str(r.code, LIMITS.codeChars),
    screenshots,
    projectTree: cleanTree(r.projectTree) ?? undefined,
    currentScript: cs && typeof cs.source === "string"
      ? { path: str(cs.path, 300), source: cs.source.slice(0, LIMITS.codeChars) }
      : undefined,
    errors: Array.isArray(r.errors)
      ? r.errors.filter((e): e is string => typeof e === "string").slice(0, 20).map((e) => e.slice(0, 1000))
      : undefined,
    source: r.source === "studio-plugin" || r.source === "mcp" ? r.source : "manual",
  };

  if (!context.question.trim() && !context.code && screenshots.length === 0 && !context.projectTree) {
    throw new HttpError(400, "質問・コード・画像のどれかを入れてね。");
  }
  return context;
}

/** Downloads screenshots with the service role and returns data URLs (works without public URLs). */
export async function resolveScreenshots(db: SupabaseClient, paths: string[]): Promise<string[]> {
  return await Promise.all(
    paths.map(async (path) => {
      const { data, error } = await db.storage.from("screenshots").download(path);
      if (error || !data) throw new HttpError(400, "画像を読みこめませんでした。もう一度貼ってみてね。", error?.message);
      const mime = data.type && data.type.startsWith("image/") ? data.type : "image/jpeg";
      return `data:${mime};base64,${encodeBase64(new Uint8Array(await data.arrayBuffer()))}`;
    }),
  );
}
