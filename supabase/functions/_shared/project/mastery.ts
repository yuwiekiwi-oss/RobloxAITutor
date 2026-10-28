// Pure rules: how a block is presented, given what the student has already learned.
// "初めて見るものは教える。2回目からは思い出させる。できるものは自分で書かせる。"
import { BLANK_TOKEN, type BlockMode } from "../contracts.ts";

const FORGET_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_WRITE_BLOCKS = 2;
export const MAX_BLANK_BLOCKS = 2;

/** A concept not used for a long time is treated as "learned once" so it comes back as a blank (review). */
export function effectiveLevel(level: number, lastSeenAt: string | null, now = Date.now()): number {
  if (level >= 2 && lastSeenAt && now - Date.parse(lastSeenAt) > FORGET_AFTER_MS) return 1;
  return level;
}

export type BlockPlan = { concepts: string[]; hasValidBlank: boolean };

export function decideModes(blocks: BlockPlan[], levels: Record<string, number>): BlockMode[] {
  const modes: BlockMode[] = blocks.map((b) => {
    if (b.concepts.length === 0) return "explain";
    const min = Math.min(...b.concepts.map((c) => levels[c] ?? 0));
    if (min <= 0) return "explain";
    if (min === 1) return b.hasValidBlank ? "blank" : "explain";
    if (min === 2) return "write";
    return "given";
  });

  // Keep one project light: at most 2 "write" and 2 "blank" blocks; extra ones step down.
  let writes = 0;
  let blanks = 0;
  return modes.map((m, i) => {
    if (m === "write" && ++writes > MAX_WRITE_BLOCKS) m = blocks[i].hasValidBlank ? "blank" : "explain";
    if (m === "blank" && ++blanks > MAX_BLANK_BLOCKS) m = "explain";
    return m;
  });
}

/**
 * Validates the AI's blank candidate and returns the code with 【？】, or null if unusable.
 * The target must appear exactly once and be the correct choice.
 */
export function makeBlank(
  code: string,
  blank: { target: string; choices: string[]; answer_index: number } | null | undefined,
): string | null {
  if (!blank) return null;
  const target = blank.target?.trim();
  if (!target || target.length > 60 || code.includes(BLANK_TOKEN)) return null;
  if (blank.choices?.[blank.answer_index]?.trim() !== target) return null;
  const first = code.indexOf(target);
  if (first < 0 || code.indexOf(target, first + target.length) >= 0) return null;
  return code.slice(0, first) + BLANK_TOKEN + code.slice(first + target.length);
}
