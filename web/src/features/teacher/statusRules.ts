// Explainable, rule-based "who needs help" status for the teacher dashboard.
// Every status comes with the human-readable reasons that triggered it.
import type { LessonSession, MessageRow, ProjectRow, QuizAttempt } from "../../lib/types";

export const THRESHOLDS = {
  idleYellowMin: 8,
  idleRedMin: 20,
  stuckYellow: 2,
  stuckRed: 3,
  wrongSameCheckRed: 2,
  strongHintLevel: 3,
  runFailedRedMin: 5,
  stageStuckYellowMin: 15,
  assistedYellow: 2,
} as const;

const STAGE_NAME: Record<string, string> = {
  plan: "決める", build: "打ちこむ", predict: "予想する", run: "動かす", explore: "テスト", tweak: "いじる",
};

export type StatusLevel = "red" | "yellow" | "green" | "idle";

export type StudentStatus = {
  level: StatusLevel;
  label: string;
  reasons: string[];
};

export type StudentActivity = {
  hintsUsed: number;
  maxHint: number;
  latestHint: number | null;
  questions: number;
  checksTotal: number;
  checksSolved: number;
  stuckStreak: number;
  lastQuestion: string | null;
  concept: string | null;
};

/** Trailing run of tutor turns that reported the student still stuck on the same problem. */
export function stuckStreak(tutorMessages: Pick<MessageRow, "meta">[]): number {
  let n = 0;
  for (let i = tutorMessages.length - 1; i >= 0; i--) {
    if (tutorMessages[i].meta?.progress !== "still_stuck") break;
    n++;
  }
  return n;
}

export function summarizeActivity(messages: MessageRow[], attempts: QuizAttempt[]): StudentActivity {
  const tutor = messages.filter((m) => m.role === "tutor");
  const student = messages.filter((m) => m.role === "student");
  const levels = tutor.map((m) => m.hint_level ?? 0);
  const checkIds = new Set(attempts.map((a) => a.message_id));
  const solvedIds = new Set(attempts.filter((a) => a.is_correct).map((a) => a.message_id));
  const lastAsk = [...student].reverse().find((m) => m.intent === "ask" || !m.intent);
  return {
    hintsUsed: levels.filter((l) => l >= 1).length,
    maxHint: levels.length ? Math.max(...levels) : 0,
    latestHint: tutor.length ? tutor[tutor.length - 1].hint_level : null,
    questions: student.length,
    checksTotal: checkIds.size,
    checksSolved: solvedIds.size,
    stuckStreak: stuckStreak(tutor),
    lastQuestion: lastAsk ? lastAsk.message || (lastAsk.code ? "（コードを送信）" : "（画像を送信）") : null,
    concept: [...tutor].reverse().find((m) => m.meta?.concept)?.meta.concept ?? null,
  };
}

export function computeStatus(
  session: LessonSession | null,
  messages: MessageRow[],
  attempts: QuizAttempt[],
  now = Date.now(),
  project: ProjectRow | null = null,
): StudentStatus {
  if (!session) return { level: "idle", label: "授業外", reasons: [] };
  if (session.status === "ended") return { level: "idle", label: "授業終了", reasons: [] };

  const red: string[] = [];
  const yellow: string[] = [];
  const activity = summarizeActivity(messages, attempts);

  if (session.help_requested_at) red.push("先生を呼んでいます");

  // Same understanding check answered wrong repeatedly (and not solved yet).
  const byCheck = new Map<string, QuizAttempt[]>();
  for (const a of attempts) byCheck.set(a.message_id, [...(byCheck.get(a.message_id) ?? []), a]);
  for (const list of byCheck.values()) {
    if (list.some((a) => a.is_correct)) continue;
    const wrong = list.length;
    if (wrong >= THRESHOLDS.wrongSameCheckRed) red.push(`同じ理解チェックで${wrong}回まちがえています`);
    else if (wrong > 0) yellow.push("理解チェックをまちがえました");
  }

  if (activity.stuckStreak >= THRESHOLDS.stuckRed) red.push(`同じ問題で${activity.stuckStreak}回つまずいています`);
  else if (activity.stuckStreak >= THRESHOLDS.stuckYellow) yellow.push(`同じ問題で${activity.stuckStreak}回つまずいています`);

  if ((activity.latestHint ?? 0) >= THRESHOLDS.strongHintLevel) {
    yellow.push(`強めのヒント（Lv${activity.latestHint}）を使っています`);
  }

  // Build-first project rules
  if (project && !["done", "abandoned"].includes(project.stage)) {
    const mins = (iso: string) => Math.floor((now - Date.parse(iso)) / 60_000);
    if (project.stage === "run" && project.run_failed_at) {
      const m = mins(project.run_failed_at);
      if (m >= THRESHOLDS.runFailedRedMin) red.push(`作品が動かない（${m}分）`);
      else yellow.push("作品が動かないと報告しました");
    }
    if (project.assisted_count >= THRESHOLDS.assistedYellow) {
      yellow.push(`関所で答えを見て進んだ（${project.assisted_count}回）`);
    }
    const stuck = mins(project.stage_changed_at);
    if (stuck >= THRESHOLDS.stageStuckYellowMin && !(project.stage === "run" && project.run_failed_at)) {
      yellow.push(`「${STAGE_NAME[project.stage] ?? project.stage}」で${stuck}分止まっています`);
    }
  }

  const idle = Math.floor((now - Date.parse(session.last_activity_at)) / 60_000);
  if (idle >= THRESHOLDS.idleRedMin) red.push(`${idle}分間うごきがありません`);
  else if (idle >= THRESHOLDS.idleYellowMin) yellow.push(`${idle}分間AI先生とのやりとりがありません`);

  if (red.length) return { level: "red", label: "先生のサポート推奨", reasons: [...red, ...yellow] };
  if (yellow.length) return { level: "yellow", label: "少し苦戦中", reasons: yellow };
  return { level: "green", label: "順調", reasons: [] };
}

export const LEVEL_ORDER: Record<StatusLevel, number> = { red: 0, yellow: 1, green: 2, idle: 3 };
