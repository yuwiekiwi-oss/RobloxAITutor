// Comparing code a student typed with the code it should be. Pure module (web app + Edge Functions).
// Forgiving where it does not matter in Luau: indentation, spaces around symbols, comments,
// full-width letters typed with the Japanese IME on. Strict about everything else (names, case).

/** Code without its `--` comment (comments are optional to type). Strings are kept intact. */
export function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "-" && line[i + 1] === "-") return line.slice(0, i);
  }
  return line;
}

/** Comparable form of one line: NFKC (full-width → half-width), no comment, no spaces around symbols. */
export function normalizeLine(line: string): string {
  return stripComment(line.normalize("NFKC"))
    .replace(/\s+/g, " ")
    .replace(/\s*([^\w\s])\s*/g, "$1")
    .trim();
}

/** Same program text, line by line (blank and comment-only lines ignored). */
export function sameCode(a: string, b: string): boolean {
  const lines = (s: string) => s.split(/\r?\n/).map(normalizeLine).filter(Boolean).join("\n");
  return lines(a) === lines(b);
}
