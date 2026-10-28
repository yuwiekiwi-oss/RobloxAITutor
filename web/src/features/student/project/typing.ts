// Checking a line the student typed by hand against the code line it should match.
// The comparison rules live in the shared module so the server grades code the same way.
import { normalizeLine, stripComment } from "../../../../../supabase/functions/_shared/codeMatch.ts";

export { normalizeLine, stripComment };

/** A line with nothing to type (blank or comment only) is skipped. */
export const needsTyping = (line: string) => normalizeLine(line) !== "";

export type TypingCheck = { ok: true } | { ok: false; matched: string };

/** ok, or how much of the line was right (to point at where it went wrong). */
export function checkTyped(typed: string, expected: string): TypingCheck {
  const a = normalizeLine(typed);
  const b = normalizeLine(expected);
  if (a === b) return { ok: true };
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return { ok: false, matched: b.slice(0, i) };
}
