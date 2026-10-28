import type { RobloxContext } from "../lib/types";
import type { RobloxContextSource } from "./RobloxContextSource";

/** What the student entered in the composer. Screenshots are already uploaded to Storage. */
export type ManualDraft = {
  question: string;
  code: string;
  screenshotPaths: string[];
  /** Explorer tree the student pasted from Studio's Output (TREE_COMMAND). */
  tree?: string | null;
};

export const manualContextSource: RobloxContextSource<ManualDraft> = {
  kind: "manual",
  async collect({ question, code, screenshotPaths, tree }) {
    const ctx: RobloxContext = { question: question.trim(), source: "manual" };
    if (code.trim()) ctx.code = code.replace(/\s+$/, "");
    if (screenshotPaths.length) ctx.screenshots = screenshotPaths;
    if (tree?.trim()) ctx.projectTree = tree;
    return ctx;
  },
};
