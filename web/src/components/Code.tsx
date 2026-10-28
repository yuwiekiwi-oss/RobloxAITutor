import { type KeyboardEvent, useMemo, useRef } from "react";
import { tokenizeLuau } from "../lib/luau";

export function Highlighted({ code }: { code: string }) {
  const tokens = useMemo(() => tokenizeLuau(code), [code]);
  return (
    <>
      {tokens.map((t, i) =>
        t.type === "text" ? t.text : (
          <span key={i} className={`tok-${t.type}`}>
            {t.text}
          </span>
        )
      )}
    </>
  );
}

export function CodeBlock({ code, maxHeight }: { code: string; maxHeight?: number }) {
  return (
    <pre className="code-block" style={maxHeight ? { maxHeight } : undefined}>
      <code>
        <Highlighted code={code} />
      </code>
    </pre>
  );
}

/**
 * Lightweight code editor: a transparent textarea over a highlighted <pre>.
 * Tab inserts a tab (Roblox Studio indents with tabs).
 */
export function CodeEditor({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const lines = value.split("\n").length;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: end } = el;
    const next = value.slice(0, s) + "\t" + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => el.setSelectionRange(s + 1, s + 1));
  };

  return (
    <div className="code-editor">
      <div className="code-editor-gutter" aria-hidden>
        {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <div className="code-editor-body">
        <pre ref={preRef} aria-hidden className="code-editor-highlight">
          <code>
            <Highlighted code={value} />
            {"\n"}
          </code>
        </pre>
        <textarea
          className="code-editor-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            if (preRef.current) {
              preRef.current.scrollTop = e.currentTarget.scrollTop;
              preRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          autoFocus={autoFocus}
          aria-label="Luauコード"
        />
      </div>
    </div>
  );
}
