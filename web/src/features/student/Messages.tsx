import { useState } from "react";
import { CodeBlock } from "../../components/Code";
import { Icon } from "../../components/Icon";
import { RichText } from "../../components/RichText";
import { TutorAvatar } from "../../components/TutorAvatar";
import { useSignedUrls } from "../../components/useSignedUrls";
import type { CheckAnswerResult, MessageRow, QuizAttempt } from "../../lib/types";

export const HINT_LABELS = ["考えてみよう", "考え方のヒント", "使う機能のヒント", "コードの一部", "コード例"];

export function HintMeter({ level }: { level: number }) {
  return (
    <span className={`hint-meter lv-${level}`} title={`ヒントレベル ${level} / 4`}>
      <span className="hint-studs" aria-hidden>
        {[1, 2, 3, 4].map((n) => <i key={n} className={n <= level ? "on" : ""} />)}
      </span>
      <span className="hint-code latin">{level === 0 ? "THINK" : `HINT ${level}`}</span>
      <span className="hint-label">{HINT_LABELS[level]}</span>
    </span>
  );
}

function CollapsibleCode({ code }: { code: string }) {
  const lines = code.split("\n").length;
  const [open, setOpen] = useState(lines <= 10);
  return (
    <div className={`attached-code ${open ? "" : "is-collapsed"}`}>
      <div className="attached-code-head">
        <span><Icon name="code" size={14} /> Script</span>
        <span>{lines} lines</span>
      </div>
      <CodeBlock code={code} maxHeight={open ? undefined : 168} />
      {lines > 10 && (
        <button className="attached-code-toggle" onClick={() => setOpen(!open)}>
          {open ? "たたむ" : "全部見る"}
        </button>
      )}
    </div>
  );
}

export function StudentBubble({ message, localImages }: { message: MessageRow; localImages?: string[] }) {
  const paths = message.attachments?.map((a) => a.path) ?? [];
  const signed = useSignedUrls(paths);
  const images = localImages ?? paths.map((p) => signed[p]).filter(Boolean);

  return (
    <div className="msg msg-student">
      <div className="student-card">
        <span className="who">あなた</span>
        {message.message && <p className="student-text">{message.message}</p>}
        {message.code && <CollapsibleCode code={message.code} />}
        {images.length > 0 && (
          <div className="student-images">
            {images.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer">
                <img src={src} alt={`送ったStudioの画面 ${i + 1}`} />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ThinkingBubble() {
  return (
    <div className="msg msg-tutor">
      <TutorAvatar thinking />
      <div className="tutor-body">
        <div className="thinking glass">
          <span className="scan" aria-hidden />
          AI先生が考えているよ
        </div>
      </div>
    </div>
  );
}

type QuickActions = { onMoreHint: () => void; onConfused: () => void; onSolved: () => void; maxed: boolean };

export function TutorBubble({
  message,
  attempts,
  onAnswer,
  quickActions,
}: {
  message: MessageRow;
  attempts: QuizAttempt[];
  onAnswer: (choice: number) => Promise<CheckAnswerResult>;
  quickActions?: QuickActions;
}) {
  return (
    <div className="msg msg-tutor">
      <TutorAvatar />
      <div className="tutor-body">
        <div className="tutor-card glass">
          <div className="tutor-head">
            <span className="tutor-name">AI先生</span>
            {message.hint_level !== null && <HintMeter level={message.hint_level} />}
          </div>
          <div className="tutor-text">
            <RichText text={message.message} />
          </div>
        </div>
        {message.meta?.check && <CheckCard message={message} attempts={attempts} onAnswer={onAnswer} />}
        {quickActions && (
          <div className="quick-actions" role="group" aria-label="AI先生への返事">
            {!quickActions.maxed && (
              <button className="quick" onClick={quickActions.onMoreHint}>
                <Icon name="bulb" size={16} /> もっとくわしく
              </button>
            )}
            <button className="quick" onClick={quickActions.onConfused}>
              <Icon name="question" size={16} /> よくわからない
            </button>
            <button className="quick quick-solved" onClick={quickActions.onSolved}>
              <Icon name="check" size={16} /> できた！
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckCard({
  message,
  attempts,
  onAnswer,
}: {
  message: MessageRow;
  attempts: QuizAttempt[];
  onAnswer: (choice: number) => Promise<CheckAnswerResult>;
}) {
  const check = message.meta.check!;
  const solved = attempts.some((a) => a.is_correct);
  const wrong = new Set(attempts.filter((a) => !a.is_correct).map((a) => a.choice_index));
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (i: number) => {
    setBusy(i);
    setError(null);
    try {
      await onAnswer(i);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`check glass ${solved ? "is-solved" : ""}`} aria-label="理解チェック">
      <header className="check-head">
        <span className="check-label"><Icon name="target" size={15} /> 理解チェック</span>
        <span className="check-status">
          {solved ? "クリア！" : wrong.size > 0 ? "もう一回" : `${check.choices.length}択クイズ`}
        </span>
      </header>
      <p className="check-question">{check.question}</p>
      <div className="check-choices">
        {check.choices.map((c, i) => {
          const isAnswer = solved && i === check.answer_index;
          const isWrong = wrong.has(i);
          return (
            <button
              key={i}
              className={`choice ${isAnswer ? "is-correct" : ""} ${isWrong ? "is-wrong" : ""} ${busy === i ? "is-busy" : ""}`}
              disabled={busy !== null || solved || isWrong}
              onClick={() => answer(i)}
            >
              <span className="choice-key">{isAnswer ? <Icon name="check" size={14} /> : isWrong ? <Icon name="x" size={14} /> : "ABCD"[i]}</span>
              <span className="choice-text">{c}</span>
            </button>
          );
        })}
      </div>
      {solved && <p className="check-feedback ok"><b>正解！</b>{check.explanation}</p>}
      {!solved && wrong.size > 0 && (
        <p className="check-feedback ng">おしい。もう一度考えてみよう。わからなければAI先生に聞いてもOK。</p>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
