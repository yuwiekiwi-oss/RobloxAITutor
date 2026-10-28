import { useCallback, useEffect, useMemo, useState } from "react";
import { SchoolLogo } from "../../components/Brand";
import { Icon } from "../../components/Icon";
import { type Classroom, useApi } from "../../lib/api";
import { formatClock, relativeTime } from "../../lib/time";
import type { Profile } from "../../lib/types";
import { computeStatus, LEVEL_ORDER, type StatusLevel, summarizeActivity } from "./statusRules";
import { StudentDetail } from "./StudentDetail";
import { stageLabel } from "../student/project/stages";
import "./teacher.css";

const POLL_MS = 15_000;

export type StudentRow = ReturnType<typeof buildRows>[number];

function buildRows(data: Classroom, now: number) {
  return data.students
    .map((student) => {
      const session = data.sessions.find((s) => s.student_id === student.id) ?? null;
      const messages = session ? data.messages.filter((m) => m.session_id === session.id) : [];
      const attempts = session ? data.attempts.filter((a) => a.session_id === session.id) : [];
      const lessonIndex = data.lessons.findIndex((l) => l.id === session?.lesson_id);
      const project = session ? data.projects.find((p) => p.session_id === session.id) ?? null : null;
      return {
        student,
        session,
        messages,
        attempts,
        lesson: lessonIndex >= 0 ? data.lessons[lessonIndex] : null,
        lessonNo: lessonIndex + 1,
        hasSummary: session ? data.summaryIds.has(session.id) : false,
        project,
        status: computeStatus(session, messages, attempts, now, project),
        activity: summarizeActivity(messages, attempts),
        hintTrail: messages.filter((m) => m.role === "tutor").map((m) => m.hint_level ?? 0),
      };
    })
    .sort((a, b) =>
      LEVEL_ORDER[a.status.level] - LEVEL_ORDER[b.status.level] ||
      a.student.display_name.localeCompare(b.student.display_name, "ja")
    );
}

const LEVELS: { level: StatusLevel; label: string }[] = [
  { level: "red", label: "サポート推奨" },
  { level: "yellow", label: "少し苦戦中" },
  { level: "green", label: "順調" },
  { level: "idle", label: "授業外" },
];

function HintTrail({ trail }: { trail: number[] }) {
  const last = trail.slice(-14);
  return (
    <div className="trail" aria-label={`ヒントレベルの推移：${last.join("、") || "なし"}`}>
      <span className="trail-label">HINT</span>
      <span className="trail-bars">
        {last.length === 0 && <span className="trail-empty">—</span>}
        {last.map((lv, i) => (
          <i key={i} className={`lv-${lv}`} style={{ height: `${4 + lv * 4}px` }} />
        ))}
      </span>
    </div>
  );
}

export function TeacherDashboard({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const api = useApi();
  const [data, setData] = useState<Classroom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await api.loadClassroom(profile.id));
      setError(null);
      setNow(Date.now());
      setUpdatedAt(new Date().toISOString());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [api, profile.id]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const rows = useMemo(() => (data ? buildRows(data, now) : []), [data, now]);
  const counts: Record<StatusLevel, number> = { red: 0, yellow: 0, green: 0, idle: 0 };
  for (const r of rows) counts[r.status.level]++;
  const active = rows.filter((r) => r.session?.status === "active");
  const urgent = rows.filter((r) => r.status.level === "red");
  const selected = rows.find((r) => r.student.id === selectedId) ?? null;
  const bulkRunning = Boolean(bulk?.startsWith("まとめ作成中"));

  const endAll = async () => {
    if (!window.confirm(`授業中の${active.length}人の授業を終了して、保護者向けのまとめを作成します。よろしいですか？`)) return;
    let failed = 0;
    for (let i = 0; i < active.length; i++) {
      setBulk(`まとめ作成中… ${i + 1} / ${active.length}`);
      try {
        const res = await api.endSession({ sessionId: active[i].session!.id });
        if (!res.summary) failed++;
      } catch {
        failed++;
      }
    }
    setBulk(failed ? `${failed}人のまとめ作成に失敗しました。カードから作り直せます。` : null);
    await load();
  };

  return (
    <div className="theme-light teacher">
      <header className="t-header">
        <div className="t-title">
          <SchoolLogo size={42} />
          <div>
            <p className="t-school">ミスタージョーンズ<b>金町校</b></p>
            <h1>
              先生ダッシュボード <span>{profile.display_name}</span>
            </h1>
          </div>
        </div>
        <div className="t-actions">
          <span className="t-updated">
            <span className={`t-live ${refreshing ? "is-refreshing" : ""}`} />
            {updatedAt ? `${formatClock(updatedAt)} 更新 · 15秒ごと` : "読みこみ中…"}
          </span>
          <button className="t-btn" onClick={load} aria-label="今すぐ更新">
            <Icon name="refresh" size={16} />
          </button>
          <button className="t-btn t-btn-danger" disabled={active.length === 0 || bulkRunning} onClick={endAll}>
            <Icon name="flag" size={16} />
            全員の授業を終了
          </button>
          <button className="t-btn t-btn-ghost" onClick={onSignOut}>
            <Icon name="logout" size={16} />
          </button>
        </div>
      </header>

      <section className="t-summary" aria-label="状態の内訳">
        {LEVELS.map(({ level, label }) => (
          <div key={level} className={`t-stat ${level} ${counts[level] > 0 ? "has" : ""}`}>
            <span className="t-stat-label"><i />{label}</span>
            <span className="t-stat-num">{counts[level]}</span>
          </div>
        ))}
        <div className="t-stat total">
          <span className="t-stat-label">在籍</span>
          <span className="t-stat-num">{rows.length}</span>
        </div>
      </section>

      {urgent.length > 0 && (
        <section className="t-urgent" aria-label="今すぐ助けに行く生徒">
          <span className="t-urgent-title"><Icon name="alert" size={16} /> 今すぐ</span>
          <div className="t-urgent-list">
            {urgent.map((r) => (
              <button key={r.student.id} className="t-urgent-item" onClick={() => setSelectedId(r.student.id)}>
                <b>{r.student.display_name}</b>
                <span>{r.status.reasons[0]}</span>
                <Icon name="arrowUpRight" size={14} />
              </button>
            ))}
          </div>
        </section>
      )}

      {bulk && <div className="t-banner">{bulk}</div>}
      {error && <div className="t-banner t-banner-error">{error}</div>}

      {data && rows.length === 0 && (
        <div className="t-empty">担当の生徒がまだいません。<code>scripts/create-users.mjs</code> で生徒を登録してください。</div>
      )}

      <main className="t-grid">
        {rows.map((r, idx) => (
          <button
            key={r.student.id}
            className={`s-card level-${r.status.level} ${r.session?.help_requested_at ? "is-calling" : ""}`}
            style={{ animationDelay: `${idx * 40}ms` }}
            onClick={() => setSelectedId(r.student.id)}
          >
            <div className="s-top">
              <span className="s-status"><i />{r.status.label}</span>
              {r.session && (
                <span className="s-time">
                  <Icon name="clock" size={13} />
                  {relativeTime(r.session.last_activity_at, now)}
                </span>
              )}
            </div>

            <div className="s-name">{r.student.display_name}</div>

            {r.session ? (
              <>
                <div className="s-lesson">
                  {r.lesson && <span className="s-lesson-no">L{String(r.lessonNo).padStart(2, "0")}</span>}
                  <span className="s-lesson-title">{r.lesson?.title ?? "自由制作"}</span>
                </div>
                {r.project ? (
                  <div className="s-project">
                    <span className="s-project-title">{r.project.title ?? r.project.idea}</span>
                    <span className={`s-stage stage-${r.project.stage}`}>{stageLabel(r.project.stage)}</span>
                  </div>
                ) : (
                  <div className="s-now">
                    <span>現在</span>
                    <b>{r.activity.concept ?? "—"}</b>
                  </div>
                )}

                {r.status.reasons.length > 0 && (
                  <ul className="s-reasons">
                    {r.status.reasons.map((x) => <li key={x}>{x}</li>)}
                  </ul>
                )}

                <dl className="s-metrics">
                  <div>
                    <dt>質問</dt>
                    <dd>{r.activity.questions}</dd>
                  </div>
                  <div>
                    <dt>ヒント</dt>
                    <dd>
                      {r.activity.hintsUsed}
                      {r.activity.maxHint > 0 && <small>max Lv{r.activity.maxHint}</small>}
                    </dd>
                  </div>
                  <div>
                    <dt>理解チェック</dt>
                    <dd>
                      {r.activity.checksSolved}
                      <small>/{r.activity.checksTotal}</small>
                    </dd>
                  </div>
                </dl>
                <HintTrail trail={r.hintTrail} />

                {r.activity.lastQuestion && <p className="s-quote">{r.activity.lastQuestion}</p>}
                {r.session.status === "ended" && (
                  <div className={`s-summary ${r.hasSummary ? "ok" : "missing"}`}>
                    <Icon name={r.hasSummary ? "check" : "alert"} size={14} />
                    {r.hasSummary ? "保護者向けまとめ作成済み" : "まとめ未作成 — 開いて作成"}
                  </div>
                )}
              </>
            ) : (
              <p className="s-none">今日はまだ授業を始めていません</p>
            )}
          </button>
        ))}
      </main>

      {selected && <StudentDetail row={selected} onClose={() => setSelectedId(null)} onChanged={load} />}
    </div>
  );
}
