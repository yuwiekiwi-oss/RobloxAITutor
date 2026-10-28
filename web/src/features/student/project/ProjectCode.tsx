import { useState } from "react";
import { Highlighted } from "../../../components/Code";
import { Icon } from "../../../components/Icon";
import { BLANK_TOKEN, type ProjectBlockRow } from "../../../lib/types";

/** Code with the 【？】 slot rendered as a glowing blank. */
export function CodeWithBlank({ code, filled }: { code: string; filled?: string | null }) {
  const parts = code.split(BLANK_TOKEN);
  return (
    <pre className="code-block pcode">
      <code>
        {parts.map((part, i) => (
          <span key={i}>
            <Highlighted code={part} />
            {i < parts.length - 1 && <mark className={`blank-slot ${filled ? "is-filled" : ""}`}>{filled ?? "？"}</mark>}
          </span>
        ))}
      </code>
    </pre>
  );
}

/** The whole project code, one segment per block; the current block is lit, the rest dimmed. */
export function SegmentedCode({ blocks, current }: { blocks: ProjectBlockRow[]; current?: number }) {
  return (
    <pre className="code-block pcode segmented">
      <code>
        {blocks.map((b) => (
          <span
            key={b.idx}
            className={`seg ${current === undefined ? "" : current === b.idx ? "is-current" : "is-dim"}`}
          >
            {b.code ? <Highlighted code={b.code} /> : <span className="tok-comment">-- ✏ ここは自分で書く部分</span>}
          </span>
        ))}
      </code>
    </pre>
  );
}

export function CopyButton({ text, label = "コードをコピー" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-primary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          // Clipboard blocked: the code is still visible to select by hand.
        }
      }}
    >
      <Icon name={done ? "check" : "code"} size={17} />
      {done ? "コピーしたよ！" : label}
    </button>
  );
}
