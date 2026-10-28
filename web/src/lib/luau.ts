// Tiny Luau tokenizer for syntax highlighting (no editor library needed).

export type TokenType = "comment" | "string" | "number" | "keyword" | "builtin" | "func" | "text";
export type Token = { type: TokenType; text: string };

const KEYWORDS = new Set(
  "and break continue do else elseif end false for function if in local nil not or repeat return then true until while export type typeof"
    .split(" "),
);
const BUILTINS = new Set(
  "game workspace script Instance Vector3 Vector2 CFrame Color3 BrickColor UDim2 UDim Enum TweenInfo task math string table print warn error pcall require tick os coroutine Players"
    .split(" "),
);

// Order matters: long comments/strings first.
const PATTERN =
  /(--\[(=*)\[[\s\S]*?(?:\]\2\]|$))|(--[^\n]*)|(\[(=*)\[[\s\S]*?(?:\]\5\]|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b0[xX][0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

export function tokenizeLuau(source: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  const push = (type: TokenType, text: string) => {
    if (!text) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.type === type && type === "text") prev.text += text;
    else tokens.push({ type, text });
  };

  for (const m of source.matchAll(PATTERN)) {
    const index = m.index ?? 0;
    push("text", source.slice(last, index));
    const text = m[0];
    if (m[1] || m[3]) push("comment", text);
    else if (m[4] || m[6]) push("string", text);
    else if (m[7]) push("number", text);
    else if (m[8]) {
      const after = source.slice(index + text.length).match(/^\s*\(/);
      if (KEYWORDS.has(text)) push("keyword", text);
      else if (BUILTINS.has(text)) push("builtin", text);
      else if (after) push("func", text);
      else push("text", text);
    }
    last = index + text.length;
  }
  push("text", source.slice(last));
  return tokens;
}
