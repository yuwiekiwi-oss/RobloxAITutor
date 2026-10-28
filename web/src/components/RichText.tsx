// Renders the tutor's reply: paragraphs, "- " lists, **bold**, `inline code`, ```lua blocks.
// Builds React elements directly (no innerHTML).
import type { ReactNode } from "react";
import { CodeBlock } from "./Code";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`\n]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const tok = m[0];
    out.push(
      tok.startsWith("**") ? <strong key={i}>{tok.slice(2, -2)}</strong> : <code key={i} className="inline-code">{tok.slice(1, -1)}</code>,
    );
    last = i + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const parts = text.split(/```[a-zA-Z]*\n?([\s\S]*?)(?:```|$)/g);
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) {
      blocks.push(<CodeBlock key={`c${idx}`} code={part.replace(/\n$/, "")} />);
      return;
    }
    const paragraphs = part.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    paragraphs.forEach((p, j) => {
      const lines = p.split("\n");
      if (lines.every((l) => /^\s*([-・*]|\d+[.)])\s+/.test(l))) {
        blocks.push(
          <ul key={`l${idx}-${j}`}>
            {lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-・*]|\d+[.)])\s+/, ""))}</li>)}
          </ul>,
        );
      } else {
        blocks.push(
          <p key={`p${idx}-${j}`}>
            {lines.map((l, k) => (
              <span key={k}>
                {k > 0 && <br />}
                {inline(l)}
              </span>
            ))}
          </p>,
        );
      }
    });
  });
  return <div className="rich-text">{blocks}</div>;
}
