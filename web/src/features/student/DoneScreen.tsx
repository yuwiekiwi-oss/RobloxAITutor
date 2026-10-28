import { Brand } from "../../components/Brand";
import { Icon } from "../../components/Icon";
import { RobotHero } from "../../components/TutorAvatar";
import type { EndSessionResponse } from "../../lib/types";

export function DoneScreen({
  name,
  result,
  onRestart,
  onSignOut,
}: {
  name: string;
  result: EndSessionResponse;
  onRestart: () => void;
  onSignOut: () => void;
}) {
  const s = result.summary;
  const m = s?.metrics;
  const stats = m
    ? [
      { v: m.questions, u: "回", k: "AI先生に質問" },
      { v: m.projects_completed ?? 0, u: "個", k: "完成した作品" },
      m.tests_total
        ? { v: `${m.tests_solved ?? 0}/${m.tests_total}`, u: "", k: "コードのテスト" }
        : { v: m.typed_lines ?? 0, u: "行", k: "打ちこんだコード" },
      { v: m.minutes, u: "分", k: "がんばった時間" },
    ]
    : [];

  return (
    <div className="done">
      <header className="topbar">
        <Brand />
      </header>
      <main className="done-main">
        <section className="done-hero">
          <p className="eyebrow">LESSON COMPLETE</p>
          <h1 className="done-title">
            おつかれさま、
            <br />
            <span>{name}さん！</span>
          </h1>
          {stats.length > 0 && (
            <dl className="done-stats glass">
              {stats.map((st) => (
                <div key={st.k}>
                  <dt>{st.k}</dt>
                  <dd>
                    {st.v}
                    <small>{st.u}</small>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <RobotHero className="done-art" celebrate />

        <section className="done-notes">
          {s && s.learned.length > 0 && (
            <>
              <p className="done-label">今日学んだこと</p>
              <ul className="done-learned">
                {s.learned.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </>
          )}
          {s?.next_lesson && (
            <p className="done-next">
              <span className="done-next-label">次回</span>
              {s.next_lesson}
            </p>
          )}
          {result.summaryError && <p className="muted">{result.summaryError}</p>}
          <div className="done-actions">
            <button className="btn btn-primary btn-lg" onClick={onRestart}>
              新しいレッスンをはじめる <Icon name="send" />
            </button>
            <button className="btn btn-ghost" onClick={onSignOut}>
              <Icon name="logout" size={16} /> ログアウト
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
