import type { RobloxContext } from "../lib/types";

/**
 * Where a RobloxContext comes from.
 *
 * v1.5: `manualContextSource` — the student types a question, pastes code, adds screenshots.
 * v2:   a Studio Plugin / MCP source can fill projectTree, currentScript and errors
 *       automatically, and `mergeContexts` combines it with what the student typed.
 *
 * The AI Tutor (Edge Function `tutor`) only ever receives a RobloxContext, so adding a
 * source never touches tutor logic.
 */
export interface RobloxContextSource<Input> {
  readonly kind: NonNullable<RobloxContext["source"]>;
  collect(input: Input): Promise<RobloxContext>;
}

/** Later contexts fill in fields the earlier ones left empty; questions are joined. */
export function mergeContexts(...contexts: RobloxContext[]): RobloxContext {
  const out: RobloxContext = { question: "" };
  for (const c of contexts) {
    out.question = [out.question, c.question].filter((q) => q.trim()).join("\n");
    out.code ??= c.code;
    out.projectTree ??= c.projectTree;
    out.currentScript ??= c.currentScript;
    out.screenshots = [...(out.screenshots ?? []), ...(c.screenshots ?? [])];
    out.errors = [...(out.errors ?? []), ...(c.errors ?? [])];
    out.source ??= c.source;
  }
  if (!out.screenshots?.length) delete out.screenshots;
  if (!out.errors?.length) delete out.errors;
  return out;
}
