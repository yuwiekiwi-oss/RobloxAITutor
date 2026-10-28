import { useEffect, useState } from "react";
import { CodeBlock } from "../../components/Code";
import { Icon } from "../../components/Icon";
import { RichText } from "../../components/RichText";
import { useSignedUrls } from "../../components/useSignedUrls";
import { useApi } from "../../lib/api";
import { formatClock } from "../../lib/time";
import type { LessonSummaryRow, MessageRow, QuizAttempt } from "../../lib/types";
import { HINT_LABELS } from "../student/Messages";
import { MasteryPanel } from "./MasteryPanel";
import type { StudentRow } from "./TeacherDashboard";
import { stageLabel } from "../student/project/stages";

const INTENT_TAG: Record<string, string> = { more_hint: "もっとくわしく", confused: "よくわからない", solved: "できた！" };
const PROGRESS_TAG: Record<string, string> = {
  new_problem: "新しい問題",
  still_stuck: "つまずき中",
  progressing: "前進",
  solved: "解決",
  chatting: "雑談",
};

export function StudentDetail({
  row,
  onClose,
  onChanged,
}: {
  row: StudentRow;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const api = useApi();
  const { student, session, messages, attempts, status, lesson, lessonNo, project } = row;
  const [summary, setSummary] = useState<LessonSummaryRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session?.status === "ended") api.getSummary(session.id).then(setSummary).catch(() => {});
    else setSummary(null);
  }, [api, session?.id, session?.status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const endOrRegenerate = (regenerate: boolean) =>
    run(regenerate ? "まとめを作り直し中…" : "授業を終了してまとめを作成中…", async () => {
      const res = await api.endSession({ sessionId: session!.id, regenerate });
      if (res.summary) setSummary(res.summary);
      if (res.summaryError) setError(res.summaryError);
    });

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${student.display_name}の詳細`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={`drawer-head level-${status.level}`}>
          <div>
            <span className="s-status"><i />{status.label}</span>
            <h2>{student.display_name}</h2>
            <p className="drawer-meta">
              {lesson && <span className="s-lesson-no">L{String(lessonNo).padStart(2, "0")}</span>}
              <span>{lesson?.title ?? "自由制作"}</span>
              {session && <span>· {formatClock(session.started_at)} 開始</span>}
            </p>
            {session?.goal_note && <p className="drawer-goal">目標「{session.goal_note}」</p>}
          </div>
          <button className="t-btn t-btn-ghost" onClick={onClose} aria-label="閉じる">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="drawer-body">
          {status.reasons.length > 0 && (
            <ul className={`drawer-reasons ${status.level}`}>{status.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          )}
          {session?.current_problem && session.status === "active" && (
            <div className="drawer-note">
              <span className="t-eyebrow">AIメモ · いま取り組んでいること</span>
              <p>{session.current_problem}</p>
            </div>
          )}

          <div className="drawer-actions">
            {session?.help_requested_at && (
              <button
                className="t-btn t-btn-primary"
                disabled={Boolean(busy)}
                onClick={() => run("…", async () => {
                  await api.setHelp(session.id, false);
                })}
              >
                <Icon name="check" size={16} /> 対応した（呼び出しを消す）
              </button>
            )}
            {session?.status === "active" && (
              <button className="t-btn t-btn-danger" disabled={Boolean(busy)} onClick={() => endOrRegenerate(false)}>
                <Icon name="flag" size={16} /> 授業を終了してまとめ作成
              </button>
            )}
            {session?.status === "ended" && (
              <button className="t-btn" disabled={Boolean(busy)} onClick={() => endOrRegenerate(true)}>
                <Icon name="refresh" size={16} /> {summary ? "まとめを作り直す" : "まとめを作成"}
              </button>
            )}
            {busy && <span className="muted">{busy}</span>}
          </div>
          {error && <div className="t-banner t-banner-error">{error}</div>}

          {summary && (
            <section className="drawer-summary">
              <span className="t-eyebrow">保護者向けまとめ（AI作成）</span>
              <p className="drawer-summary-made">{summary.created_today}</p>
              <p>{summary.parent_summary}</p>
            </section>
          )}

          {project && (
            <section className="drawer-project">
              <span className="t-eyebrow">作品</span>
              <p className="drawer-project-title">
                {project.title ?? project.idea}
                <span className={`s-stage stage-${project.stage}`}>{stageLabel(project.stage)}</span>
              </p>
              {"understanding" in project.plan && project.plan.understanding && (
                <p className="drawer-project-plan">「{project.plan.understanding}」</p>
              )}
              <p className="muted">
                生徒が見せたもの：{[
                  project.idea_images?.length ? `画像${project.idea_images.length}枚` : null,
                  project.explorer_tree ? "Studioの構成" : null,
                ].filter(Boolean).join("・") || "文章だけ"}
              </p>
              <p className="muted">
                関所で答えを見た回数：{project.assisted_count}回
                {project.run_failed_at && project.stage === "run" && "・「動かない」と報告中"}
              </p>
            </section>
          )}

          <MasteryPanel studentId={student.id} />

          <section className="log">
            <h3>
              会話ログ <span>{messages.length}</span>
            </h3>
            {messages.length === 0 && <p className="muted">まだAI先生とのやりとりはありません。</p>}
            <ol className="timeline">
              {messages.map((m) => (
                <LogItem key={m.id} message={m} attempts={attempts.filter((a) => a.message_id === m.id)} />
              ))}
            </ol>
          </section>
        </div>
      </aside>
    </div>
  );
}

function LogItem({ message: m, attempts }: { message: MessageRow; attempts: QuizAttempt[] }) {
  const paths = m.attachments?.map((a) => a.path) ?? [];
  const urls = useSignedUrls(paths);
  return (
    <li className={`log-item ${m.role}`}>
      <div className="log-meta">
        <b>{m.role === "student" ? "生徒" : "AI先生"}</b>
        <span className="log-time">{formatClock(m.created_at)}</span>
        {m.intent && INTENT_TAG[m.intent] && <span className="tag">{INTENT_TAG[m.intent]}</span>}
        {m.role === "tutor" && m.hint_level !== null && (
          <span className={`tag hint-${m.hint_level}`}>Lv{m.hint_level} {HINT_LABELS[m.hint_level]}</span>
        )}
        {m.meta?.progress && <span className="tag subtle">{PROGRESS_TAG[m.meta.progress] ?? m.meta.progress}</span>}
      </div>
      <div className="log-content">
        {m.role === "tutor" ? <RichText text={m.message} /> : m.message && <p>{m.message}</p>}
        {m.code && <CodeBlock code={m.code} maxHeight={260} />}
        {paths.length > 0 && (
          <div className="log-images">
            {paths.map((p) => urls[p] && (
              <a key={p} href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="Studioのスクリーンショット" /></a>
            ))}
          </div>
        )}
        {m.meta?.check && (
          <div className="log-check">
            <Icon name="target" size={14} />
            <span>{m.meta.check.question}</span>
            <b>
              {attempts.length === 0
                ? "未回答"
                : attempts.some((a) => a.is_correct)
                ? `正解（${attempts.length}回目）`
                : `不正解 ${attempts.length}回`}
            </b>
          </div>
        )}
      </div>
    </li>
  );
}
