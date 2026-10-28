// Measured values (実測値) for a lesson session. Pure function — the AI never produces these.
import type { MessageRow, SessionMetrics } from "../contracts.ts";

export type AttemptRow = { message_id: string; is_correct: boolean; created_at: string };

export type ConceptUpEvent = { concept_id: string; level_before: number; level_after: number; kind: string };

/** Highest level reached per concept in this session, only for real level-ups (not teacher overrides). */
export function conceptsUp(events: ConceptUpEvent[], names: Record<string, string>): { name: string; level: number }[] {
  const best = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "teacher_set" || e.level_after <= e.level_before) continue;
    best.set(e.concept_id, Math.max(best.get(e.concept_id) ?? 0, e.level_after));
  }
  return [...best].map(([id, level]) => ({ name: names[id] ?? id, level }));
}

export function computeMetrics(
  session: { started_at: string; ended_at: string | null; completed: boolean | null },
  messages: Pick<MessageRow, "role" | "hint_level">[],
  attempts: AttemptRow[],
  extras: { projectsCompleted?: number; conceptsUp?: { name: string; level: number }[] } = {},
): SessionMetrics {
  const end = session.ended_at ? Date.parse(session.ended_at) : Date.now();
  const minutes = Math.max(0, Math.round((end - Date.parse(session.started_at)) / 60_000));

  const tutor = messages.filter((m) => m.role === "tutor");
  const hintLevels = tutor.map((m) => m.hint_level ?? 0);

  const byCheck = new Map<string, AttemptRow[]>();
  for (const a of [...attempts].sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    byCheck.set(a.message_id, [...(byCheck.get(a.message_id) ?? []), a]);
  }
  const checks = [...byCheck.values()];

  return {
    minutes,
    questions: messages.filter((m) => m.role === "student").length,
    hints_used: hintLevels.filter((l) => l >= 1).length,
    max_hint_level: hintLevels.length ? Math.max(...hintLevels) : 0,
    checks_total: checks.length,
    checks_correct_first_try: checks.filter((c) => c[0]?.is_correct).length,
    checks_solved: checks.filter((c) => c.some((a) => a.is_correct)).length,
    completed: session.completed,
    projects_completed: extras.projectsCompleted ?? 0,
    concepts_up: extras.conceptsUp ?? [],
  };
}

export type ProjectForMetrics = { id: string; title: string | null; idea: string; stage: string; quiz: unknown };
export type BlockForMetrics = { project_id: string; idx: number; mode: string; code: string | null; build_done: boolean };
export type ProjectAttemptForMetrics = { project_id: string; item: string; correct: boolean; assisted: boolean; created_at: string };

const codeLines = (code: string) => code.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).length;

/** Measured values from the project work of a session (typing, writing, code test). */
export function projectMetrics(
  projects: ProjectForMetrics[],
  blocks: BlockForMetrics[],
  attempts: ProjectAttemptForMetrics[],
): Pick<SessionMetrics, "tests_total" | "tests_first_try" | "tests_solved" | "typed_lines" | "written_by_self" | "works"> {
  const sorted = [...attempts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const byItem = new Map<string, ProjectAttemptForMetrics[]>();
  for (const a of sorted) byItem.set(`${a.project_id}|${a.item}`, [...(byItem.get(`${a.project_id}|${a.item}`) ?? []), a]);

  let testsTotal = 0;
  let testsFirst = 0;
  let testsSolved = 0;
  for (const p of projects) {
    const n = Array.isArray(p.quiz) ? p.quiz.length : 0;
    for (let i = 0; i < n; i++) {
      const tries = byItem.get(`${p.id}|quiz:${i}`) ?? [];
      if (tries.length === 0) continue; // not reached
      testsTotal++;
      if (tries[0].correct) testsFirst++;
      if (tries.some((t) => t.correct)) testsSolved++;
    }
  }

  const typed = blocks.filter((b) => b.build_done && b.mode !== "write");
  const written = blocks.filter((b) => b.mode === "write" && (byItem.get(`${b.project_id}|write:${b.idx}`) ?? []).some((t) => t.correct));

  const works = projects
    .map((p) => {
      const mine = blocks.filter((b) => b.project_id === p.id).sort((a, b) => a.idx - b.idx);
      const code = mine.filter((b) => b.build_done && b.code).map((b) => b.code).join("\n");
      return { title: p.title ?? p.idea, done: p.stage === "done", code: code.slice(0, 4000) };
    })
    .filter((w) => w.code.trim());

  return {
    tests_total: testsTotal,
    tests_first_try: testsFirst,
    tests_solved: testsSolved,
    typed_lines: typed.reduce((n, b) => n + codeLines(b.code ?? ""), 0),
    written_by_self: written.length,
    works,
  };
}

/**
 * The project work as plain sentences for the summary model (facts only, from the records):
 * which parts were typed, written alone, and how each code test went.
 */
export function projectWorkLines(
  projects: (ProjectForMetrics & { quiz: unknown })[],
  blocks: (BlockForMetrics & { purpose?: string; title?: string })[],
  attempts: ProjectAttemptForMetrics[],
): string[] {
  const out: string[] = [];
  const sorted = [...attempts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const tries = (pid: string, item: string) => sorted.filter((a) => a.project_id === pid && a.item === item);
  for (const p of projects) {
    const name = p.title ?? p.idea;
    const mine = blocks.filter((b) => b.project_id === p.id).sort((a, b) => a.idx - b.idx);
    const typed = mine.filter((b) => b.build_done && b.mode !== "write");
    out.push(`作品「${name}」（${p.stage === "done" ? "完成" : "とちゅう"}）`);
    if (typed.length) {
      out.push(`説明を読みながら手で打ちこんだ部分: ${typed.map((b) => b.title ?? b.purpose ?? `${b.idx + 1}`).join("、")}（${typed.reduce((n, b) => n + codeLines(b.code ?? ""), 0)}行）`);
    }
    for (const b of mine.filter((x) => x.mode === "write")) {
      const t = tries(p.id, `write:${b.idx}`);
      if (!t.length) continue;
      const ok = t.findIndex((x) => x.correct);
      out.push(`自分で書いた部分「${b.purpose ?? b.title ?? ""}」: ${ok === 0 ? "1回目で書けた" : ok > 0 ? `${ok + 1}回目で書けた` : t.some((x) => x.assisted) ? "むずかしくてお手本を見た" : "まだ書いている途中"}`);
    }
    const quiz = Array.isArray(p.quiz) ? (p.quiz as { goal?: string; question?: string }[]) : [];
    quiz.forEach((q, i) => {
      const t = tries(p.id, `quiz:${i}`);
      if (!t.length) return;
      const ok = t.findIndex((x) => x.correct);
      const what = q.goal ? `「${q.goal}」のためにコードを書きかえる問題` : `確認問題「${q.question ?? ""}」`;
      out.push(`テスト${i + 1}（${what}）: ${ok === 0 ? "1回目で正解" : ok > 0 ? `${ok + 1}回目で正解` : t.some((x) => x.assisted) ? "お手本を見て理解した" : "途中"}`);
    });
  }
  return out;
}
