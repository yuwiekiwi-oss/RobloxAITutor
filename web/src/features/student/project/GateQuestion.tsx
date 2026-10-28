import { useState } from "react";
import { Icon } from "../../../components/Icon";
import type { GateResult } from "../../../lib/types";

/**
 * A short multiple-choice gate. The student cannot move on until it is resolved
 * (correct, or revealed after two wrong answers — which is recorded).
 */
export function GateQuestion({
  label,
  question,
  choices,
  onAnswer,
  onContinue,
  continueLabel = "次へ",
}: {
  label: string;
  question: string;
  choices: string[];
  onAnswer: (choice: number) => Promise<GateResult>;
  onContinue: () => void;
  continueLabel?: string;
}) {
  const [wrong, setWrong] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<GateResult | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (i: number) => {
    setBusy(i);
    setError(null);
    try {
      const r = await onAnswer(i);
      if (r.resolved) setResult(r);
      if (!r.correct && !r.already) setWrong((w) => new Set(w).add(i));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resolved = Boolean(result?.resolved);
  return (
    <section className={`gate glass ${resolved ? (result?.correct ? "is-correct" : "is-revealed") : ""}`}>
      <header className="gate-head">
        <span className="gate-label"><Icon name="target" size={15} /> {label}</span>
        {!resolved && wrong.size > 0 && <span className="gate-status">あと1回で答えが見られるよ</span>}
        {resolved && <span className="gate-status">{result?.correct ? "正解！" : "答えを見よう"}</span>}
      </header>
      <p className="gate-question">{question}</p>
      <div className="check-choices">
        {choices.map((c, i) => {
          const isAnswer = resolved && i === result?.answer_index;
          const isWrong = wrong.has(i) && !isAnswer;
          return (
            <button
              key={i}
              className={`choice ${isAnswer ? "is-correct" : ""} ${isWrong ? "is-wrong" : ""} ${busy === i ? "is-busy" : ""}`}
              disabled={busy !== null || resolved || isWrong}
              onClick={() => answer(i)}
            >
              <span className="choice-key">{isAnswer ? <Icon name="check" size={14} /> : isWrong ? <Icon name="x" size={14} /> : "ABCD"[i]}</span>
              <span className="choice-text">{c}</span>
            </button>
          );
        })}
      </div>
      {!resolved && wrong.size > 0 && <p className="check-feedback ng">おしい！ もう一度考えてみよう。</p>}
      {resolved && (
        <div className="gate-result">
          <p className={`check-feedback ${result?.correct ? "ok" : "ng"}`}>
            <b>{result?.correct ? "正解！" : "正解はこれ。"}</b>
            {result?.explanation}
          </p>
          <button className="btn btn-primary" onClick={onContinue}>
            {continueLabel} <Icon name="send" size={16} />
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
