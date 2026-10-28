import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { useApi } from "../../lib/api";
import type { SavedTree } from "../../lib/types";
import { parseTree, TREE_COMMAND, treeSize, treeStats } from "../../../../supabase/functions/_shared/studioTree.ts";
import { CopyButton } from "./project/ProjectCode";

const dateLabel = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/**
 * "Studioの構成を入れる": pick a tree used before (big cards), or add a new one:
 * copy a one-line command → run it in Studio's Command Bar → copy what the Output window shows →
 * paste it here. No plugin needed. Every tree used is saved for next time.
 */
export function TreePaste({ value, onChange, onClose }: {
  value: string | null;
  onChange: (tree: string | null) => void;
  onClose?: () => void;
}) {
  const api = useApi();
  const [saved, setSaved] = useState<SavedTree[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [raw, setRaw] = useState("");
  const [bad, setBad] = useState(false);
  const [place, setPlace] = useState<string | null>(null);

  useEffect(() => {
    if (value) return;
    let alive = true;
    api.listSavedTrees().then((list) => alive && setSaved(list)).catch(() => alive && setSaved([]));
    return () => {
      alive = false;
    };
  }, [api, value]);

  const use = (tree: string, name: string | null) => {
    setPlace(name);
    onChange(tree);
    // Remember it (or mark it as used again) for next time; failing to save never blocks the student.
    api.saveTree(tree, name).catch(() => {});
  };

  const remove = async (t: SavedTree) => {
    if (!window.confirm(`「${t.place ?? "この構成"}」を消す？\n（Studioの中身は消えないよ）`)) return;
    try {
      await api.deleteSavedTree(t.id);
      setSaved((list) => (list ?? []).filter((x) => x.id !== t.id));
    } catch {
      // Could not delete: keep the card; nothing else depends on it.
    }
  };

  if (value) {
    return (
      <div className="tree-ok">
        <Icon name="tree" size={17} />
        <span><b>{place ? `「${place}」の構成` : "Studioの構成"}</b>を読みこんだよ（{treeSize(value)}行）</span>
        <button className="link-btn" onClick={() => { onChange(null); setRaw(""); setAdding(false); }}>えらびなおす</button>
      </div>
    );
  }

  const read = (text: string) => {
    setRaw(text);
    const parsed = parseTree(text);
    setBad(Boolean(text.trim()) && !parsed);
    if (parsed) use(parsed.tree, parsed.place);
  };

  const hasSaved = Boolean(saved?.length);
  const showSteps = adding || saved?.length === 0;

  return (
    <div className="tree-paste">
      <div className="tree-paste-head">
        <Icon name="tree" size={18} />
        <p className="tree-paste-title">Studioの構成をAI先生に見せる</p>
        {onClose && (
          <button className="icon-btn icon-btn-sm" onClick={onClose} aria-label="とじる"><Icon name="x" size={14} /></button>
        )}
      </div>

      {hasSaved && !adding && (
        <>
          <p className="tree-pick-lead">前に使った構成をえらんでね</p>
          <div className="tree-cards">
            {saved!.map((t, i) => {
              const s = treeStats(t.tree);
              return (
                <div key={t.id} className="tree-card-wrap">
                <button className="tree-card" onClick={() => use(t.tree, t.place)}>
                  <span className="tree-card-icon"><Icon name="tree" size={22} /></span>
                  <span className="tree-card-name">{t.place ?? `構成 ${saved!.length - i}`}</span>
                  <span className="tree-card-meta">
                    <span className="tree-pill">パーツ {s.parts}こ</span>
                    <span className="tree-pill">スクリプト {s.scripts}こ</span>
                  </span>
                  <span className="tree-card-date">{dateLabel(t.last_used_at)}に使ったよ</span>
                </button>
                <button
                  className="tree-card-delete"
                  onClick={() => remove(t)}
                  aria-label={`${t.place ?? "この構成"}を消す`}
                  title="消す"
                >
                  <Icon name="x" size={14} />
                </button>
                </div>
              );
            })}
            <button className="tree-card is-new" onClick={() => setAdding(true)}>
              <span className="tree-card-icon"><Icon name="code" size={22} /></span>
              <span className="tree-card-name">新しく入れる</span>
              <span className="tree-card-meta">Studioでコマンドを使う</span>
            </button>
          </div>
        </>
      )}

      {showSteps && (
        <>
          {hasSaved && (
            <button className="link-btn tree-back" onClick={() => setAdding(false)}>← 前に使った構成にもどる</button>
          )}
          <ol className="tree-steps">
            <li>
              <span className="latin">1</span>
              <div>
                <p>このボタンでコマンドをコピーする</p>
                <CopyButton text={TREE_COMMAND} label="コマンドをコピー" />
              </div>
            </li>
            <li>
              <span className="latin">2</span>
              <p>
                Studioの <b>［スクリプト］タブ →［コマンドバー］</b> を開いて、<kbd>Ctrl</kbd>+<kbd>V</kbd> で貼りつけて <kbd>Enter</kbd>
                <span className="muted tree-note">
                  見つからないときは <kbd>Ctrl</kbd>+<kbd>9</kbd> か、上の［ウィンドウ］→［スクリプト］→［コマンドバー］。
                  Enter で動かないときは <kbd>Ctrl</kbd>+<kbd>Enter</kbd>。Studioの中身は何も変わらないよ。
                </span>
              </p>
            </li>
            <li>
              <span className="latin">3</span>
              <div className="tree-step-wide">
                <p><b>［出力］</b>（［スクリプト］タブ →［出力］）に出た文字を <b>START</b> の行から <b>END</b> の行までえらんでコピーして、ここに貼る</p>
                <textarea
                  className="input tree-input"
                  rows={3}
                  value={raw}
                  onChange={(e) => read(e.target.value)}
                  placeholder="=== AI-SENSEI TREE START ===&#10;Workspace (Workspace)&#10;  …&#10;=== AI-SENSEI TREE END ==="
                  spellCheck={false}
                  aria-label="Studioの出力を貼る"
                />
                {bad && <p className="error-text">「START」の行が見つからないよ。START から END まで、全部コピーしてね。</p>}
              </div>
            </li>
          </ol>
        </>
      )}

      {saved === null && <p className="muted tree-pick-lead">読みこみ中…</p>}
    </div>
  );
}
