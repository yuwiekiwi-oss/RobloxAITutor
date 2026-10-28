import { type ClipboardEvent, type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { CodeEditor } from "../../components/Code";
import { Icon } from "../../components/Icon";
import { imagesFromDataTransfer, isAcceptedImage } from "../../lib/image";
import { LIMITS } from "../../lib/types";
import { TreePaste } from "./TreePaste";

export type PendingImage = { id: string; blob: Blob; previewUrl: string; path?: string };
export type Draft = {
  question: string;
  code: string;
  showCode: boolean;
  images: PendingImage[];
  /** Explorer tree pasted from Studio (see TreePaste). */
  tree: string | null;
  showTree: boolean;
};
export const emptyDraft = (): Draft => ({ question: "", code: "", showCode: false, images: [], tree: null, showTree: false });

const looksLikeLuau = (text: string) =>
  text.includes("\n") && /\b(local|function|end|then|game|script)\b/.test(text) && /\bend\b|[=()]/.test(text);

export function Composer({
  draft,
  setDraft,
  onAddImages,
  onSend,
  busy,
  compact,
}: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  onAddImages: (files: File[]) => void;
  onSend: () => void;
  busy: boolean;
  compact: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Paste images anywhere on the screen (Ctrl+V / Cmd+V).
  useEffect(() => {
    const onPaste = (e: globalThis.ClipboardEvent) => {
      if (e.defaultPrevented) return; // already taken by another field (e.g. the idea box)
      const images = imagesFromDataTransfer(e.clipboardData);
      if (images.length === 0) return;
      if (!e.clipboardData?.getData("text/plain")) e.preventDefault();
      onAddImages(images);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onAddImages]);

  // Drag & drop anywhere on the screen.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const images = imagesFromDataTransfer(e.dataTransfer);
      if (images.length) onAddImages(images);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [onAddImages]);

  // Auto-grow the question box.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 4, 200)}px`;
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, [draft.question, compact]);

  // If a student pastes code into the question box, move it into the code box.
  const onQuestionPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!draft.code.trim() && looksLikeLuau(text)) {
      e.preventDefault();
      setDraft((d) => ({ ...d, code: text, showCode: true }));
      setNote("コードは「📋 コード」の欄に入れておいたよ。");
      setTimeout(() => setNote(null), 4000);
    }
  };

  const removeImage = (id: string) =>
    setDraft((d) => {
      const img = d.images.find((i) => i.id === id);
      if (img && !img.path) URL.revokeObjectURL(img.previewUrl);
      return { ...d, images: d.images.filter((i) => i.id !== id) };
    });

  const canSend = !busy && Boolean(draft.question.trim() || draft.code.trim() || draft.images.length || draft.tree);

  return (
    <div className="composer-dock">
      <div className={`composer ${compact ? "is-compact" : ""}`}>
        <div className="composer-field">
          <textarea
            ref={textRef}
            className="composer-input"
            rows={compact ? 1 : 2}
            value={draft.question}
            maxLength={LIMITS.questionChars}
            onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))}
            onPaste={onQuestionPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
            placeholder={compact ? "AI先生に返事を書く…" : "AI先生に聞きたいことを書いてね"}
            aria-label="質問"
          />

          {draft.showCode && (
            <div className="code-panel">
              <div className="code-panel-head">
                <span className="code-tab"><i aria-hidden /> Script.lua</span>
                <button className="icon-btn icon-btn-sm" onClick={() => setDraft((d) => ({ ...d, showCode: false }))} aria-label="コード欄をしまう">
                  <Icon name="x" size={14} />
                </button>
              </div>
              <CodeEditor
                value={draft.code}
                onChange={(code) => setDraft((d) => ({ ...d, code }))}
                placeholder={"-- Roblox StudioのScriptをここに貼ってね\nlocal part = script.Parent"}
                autoFocus={!draft.code}
              />
            </div>
          )}

          {(draft.showTree || draft.tree) && (
            <TreePaste
              value={draft.tree}
              onChange={(tree) => setDraft((d) => ({ ...d, tree }))}
              onClose={() => setDraft((d) => ({ ...d, showTree: false }))}
            />
          )}

          {draft.images.length > 0 && (
            <div className="thumbs">
              {draft.images.map((img, i) => (
                <figure key={img.id} className="thumb">
                  <img src={img.previewUrl} alt={`追加したStudioの画面 ${i + 1}`} />
                  <button className="thumb-remove" onClick={() => removeImage(img.id)} aria-label="画像を消す" disabled={busy}>
                    <Icon name="x" size={12} />
                  </button>
                </figure>
              ))}
            </div>
          )}
        </div>

        {note && <div className="composer-note"><Icon name="check" size={14} /> {note}</div>}

        <div className="composer-bar">
          <button
            className={`tool ${draft.showCode || draft.code ? "is-on" : ""}`}
            onClick={() => setDraft((d) => ({ ...d, showCode: !d.showCode }))}
            aria-pressed={draft.showCode}
            aria-label="コードを貼る"
          >
            <Icon name="code" size={17} />
            <span className="tool-text">コードを貼る</span>
            {draft.code.trim() && !draft.showCode && <span className="tool-dot" />}
          </button>
          <button className="tool" onClick={() => fileRef.current?.click()} aria-label="Studioの画面を追加">
            <Icon name="image" size={17} />
            <span className="tool-text">Studioの画面</span>
            {draft.images.length > 0 && <span className="tool-count">{draft.images.length}</span>}
          </button>
          <button
            className={`tool ${draft.showTree || draft.tree ? "is-on" : ""}`}
            onClick={() => setDraft((d) => ({ ...d, showTree: !d.showTree }))}
            aria-pressed={draft.showTree}
            aria-label="Studioの構成を入れる"
          >
            <Icon name="tree" size={17} />
            <span className="tool-text">構成</span>
            {draft.tree && !draft.showTree && <span className="tool-dot" />}
          </button>
          <span className="composer-keys">
            <kbd>Ctrl</kbd>+<kbd>V</kbd> 画像　<kbd>Ctrl</kbd>+<kbd>Enter</kbd> 送信
          </span>
          <button className="btn btn-primary send" disabled={!canSend} onClick={onSend}>
            {busy ? "考え中…" : "AI先生に聞く"} <Icon name="send" size={17} />
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).filter(isAcceptedImage);
            if (files.length) onAddImages(files);
            e.target.value = "";
          }}
        />
      </div>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-target">
            <Icon name="image" size={40} />
            <p className="drop-title">ここにドロップ</p>
            <p className="drop-sub latin">PNG · JPG · WEBP</p>
          </div>
        </div>
      )}
    </div>
  );
}
