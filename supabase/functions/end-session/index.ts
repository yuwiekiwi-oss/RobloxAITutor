// POST /functions/v1/end-session — end a lesson and write the parent-facing summary.
// Callable by the student themself or by their teacher.
import type { EndSessionRequest, LessonSummaryRow, MessageRow } from "../_shared/contracts.ts";
import { env } from "../_shared/env.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { createStructuredResponse } from "../_shared/openai.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";
import {
  type AttemptRow,
  type BlockForMetrics,
  computeMetrics,
  type ConceptUpEvent,
  conceptsUp,
  type ProjectAttemptForMetrics,
  type ProjectForMetrics,
  projectMetrics,
  projectWorkLines,
} from "../_shared/summary/metrics.ts";
import {
  formatSummaryInput,
  SUMMARY_INSTRUCTIONS,
  SUMMARY_OUTPUT_SCHEMA,
  type SummaryModelOutput,
} from "../_shared/summary/prompt.ts";

type SessionRow = {
  id: string;
  student_id: string;
  status: "active" | "ended";
  completed: boolean | null;
  goal_note: string | null;
  started_at: string;
  ended_at: string | null;
  lessons: { title: string; goal: string } | { title: string; goal: string }[] | null;
};

serve(async (req) => {
  const { user, profile } = await requireUser(req);
  const body = await readJson<EndSessionRequest>(req);
  if (typeof body.sessionId !== "string") throw new HttpError(400, "授業が指定されていません。");

  const db = adminClient();
  const select = "id, student_id, status, completed, goal_note, started_at, ended_at, lessons(title, goal)";
  const { data: found } = await db.from("lesson_sessions").select(select).eq("id", body.sessionId).maybeSingle();
  let session = found as SessionRow | null;
  if (!session) throw new HttpError(404, "授業が見つかりません。");

  const { data: student } = await db
    .from("profiles")
    .select("id, display_name, teacher_id")
    .eq("id", session.student_id)
    .single();
  const isOwner = session.student_id === user.id;
  const isTeacher = profile.role === "teacher" && student?.teacher_id === user.id;
  if (!isOwner && !isTeacher) throw new HttpError(403, "この授業を終了する権限がありません。");

  // 1) End the session (idempotent).
  if (session.status === "active") {
    const { data: ended, error } = await db
      .from("lesson_sessions")
      .update({
        status: "ended",
        ended_at: new Date().toISOString(),
        completed: typeof body.completed === "boolean" ? body.completed : null,
        help_requested_at: null,
      })
      .eq("id", session.id)
      .eq("status", "active")
      .select(select)
      .maybeSingle();
    if (error) throw new HttpError(500, "授業を終了できませんでした。", error.message);
    if (ended) session = ended as SessionRow;
  } else if (!body.regenerate) {
    const { data: existing } = await db.from("lesson_summaries").select("*").eq("session_id", session.id).maybeSingle();
    if (existing) return json(req, { summary: existing as LessonSummaryRow });
  }

  // 2) Measured values.
  const { data: msgs } = await db
    .from("messages")
    .select("*")
    .eq("session_id", session.id)
    .order("created_at", { ascending: true });
  const messages = (msgs ?? []) as MessageRow[];
  const { data: att } = await db
    .from("quiz_attempts")
    .select("message_id, is_correct, created_at")
    .eq("session_id", session.id);
  const attempts = (att ?? []) as AttemptRow[];

  const [{ data: projects }, { data: events }, { data: concepts }] = await Promise.all([
    db.from("projects").select("id, title, idea, stage, quiz").eq("session_id", session.id).neq("stage", "abandoned"),
    db.from("concept_events").select("concept_id, level_before, level_after, kind").eq("session_id", session.id),
    db.from("concepts").select("id, name"),
  ]);
  const names = Object.fromEntries((concepts ?? []).map((c) => [c.id, c.name]));
  const ups = conceptsUp((events ?? []) as ConceptUpEvent[], names);

  // The project work (typing, writing, code test) — measured values and, for the AI, plain facts.
  const projectRows = (projects ?? []) as ProjectForMetrics[];
  const projectIds = projectRows.map((p) => p.id);
  const [{ data: blockRows }, { data: workRows }] = projectIds.length
    ? await Promise.all([
      db.from("project_blocks").select("project_id, idx, mode, code, build_done, purpose, title").in("project_id", projectIds),
      db.from("project_attempts").select("project_id, item, correct, assisted, created_at").in("project_id", projectIds),
    ])
    : [{ data: [] }, { data: [] }];
  const blocks = (blockRows ?? []) as (BlockForMetrics & { purpose: string; title: string })[];
  const work = (workRows ?? []) as ProjectAttemptForMetrics[];

  const metrics = {
    ...computeMetrics(session, messages, attempts, {
      projectsCompleted: projectRows.filter((p) => p.stage === "done").length,
      conceptsUp: ups,
    }),
    ...projectMetrics(projectRows, blocks, work),
  };

  const lesson = Array.isArray(session.lessons) ? session.lessons[0] ?? null : session.lessons;

  // 3) AI-written text (only when there is something to summarize).
  let text: SummaryModelOutput;
  let model: string | null = null;
  if (messages.length === 0 && (projects ?? []).length === 0) {
    text = {
      created_today: lesson?.title ?? (session.goal_note || "自由制作"),
      learned: [],
      struggled_with: [],
      how_student_solved_it: "今日はAI先生への質問はありませんでした。",
      next_lesson: "次回も制作の続きを進めます。",
      parent_summary: "今日はAI先生を使わずに制作に取り組みました。詳しい様子は担当の先生にお問い合わせください。",
    };
  } else {
    const checks = new Map<string, { attempts: number; solved: boolean }>();
    for (const a of attempts) {
      const c = checks.get(a.message_id) ?? { attempts: 0, solved: false };
      c.attempts += 1;
      c.solved ||= a.is_correct;
      checks.set(a.message_id, c);
    }
    try {
      const res = await createStructuredResponse<SummaryModelOutput>({
        model: env.summaryModel(),
        instructions: SUMMARY_INSTRUCTIONS,
        input: [{
          role: "user",
          content: formatSummaryInput({
            studentName: student?.display_name ?? "生徒",
            lesson,
            goalNote: session.goal_note,
            completed: session.completed,
            messages,
            checks,
            projects: projectRows.map((p) => ({ title: p.title ?? p.idea, done: p.stage === "done" })),
            conceptsUp: ups,
            projectWork: projectWorkLines(projectRows, blocks, work),
          }),
        }],
        schemaName: "parent_lesson_summary",
        schema: SUMMARY_OUTPUT_SCHEMA,
        reasoningEffort: env.summaryReasoningEffort(),
        maxOutputTokens: 4000,
      });
      text = res.data;
      model = res.model;
    } catch (err) {
      console.error("summary generation failed", err);
      return json(req, {
        summary: null,
        summaryError: "授業は終了しました。まとめの作成に失敗したので、先生画面から作り直してください。",
      });
    }
  }

  const { data: saved, error: saveError } = await db
    .from("lesson_summaries")
    .upsert({
      session_id: session.id,
      student_id: session.student_id,
      created_today: text.created_today,
      learned: text.learned.slice(0, 5),
      struggled_with: text.struggled_with.slice(0, 5),
      how_student_solved_it: text.how_student_solved_it,
      next_lesson: text.next_lesson,
      parent_summary: text.parent_summary,
      metrics,
      model,
      updated_at: new Date().toISOString(),
    }, { onConflict: "session_id" })
    .select("*")
    .single();
  if (saveError) throw new HttpError(500, "まとめを保存できませんでした。", saveError.message);

  return json(req, { summary: saved as LessonSummaryRow });
});
