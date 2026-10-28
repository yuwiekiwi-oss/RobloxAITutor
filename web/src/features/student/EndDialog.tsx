import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { Loader } from "../../components/Loader";

export function EndDialog({ onCancel, onEnd }: { onCancel: () => void; onEnd: (completed: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const end = async (completed: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await onEnd(completed);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal glass" role="dialog" aria-modal="true" aria-labelledby="end-title" onClick={(e) => e.stopPropagation()}>
        {busy ? (
          <div className="modal-busy">
            <Loader label="まとめを作成中" />
            <p>今日のまとめを作っているよ…</p>
          </div>
        ) : (
          <>
            <h2 id="end-title">今日の授業をおわる？</h2>
            <p className="modal-sub">今日の目標は、できたかな？</p>
            <div className="modal-choices">
              <button className="end-choice is-done" onClick={() => end(true)}>
                <span className="end-choice-icon"><Icon name="check" size={22} /></span>
                <span className="end-choice-title">できた！</span>
                <span className="end-choice-sub">目標まで作れた</span>
              </button>
              <button className="end-choice" onClick={() => end(false)}>
                <span className="end-choice-icon"><Icon name="clock" size={22} /></span>
                <span className="end-choice-title">まだとちゅう</span>
                <span className="end-choice-sub">次回つづきから</span>
              </button>
            </div>
            {error && <p className="error-text">{error}</p>}
            <button className="link-btn" onClick={onCancel}>授業にもどる</button>
          </>
        )}
      </div>
    </div>
  );
}
