// POST /functions/v1/tutor — one AI Tutor turn.
import { LIMITS, type MessageRow, type TutorIntent, type TutorMeta, type TutorRequest } from "../_shared/contracts.ts";
import { env } from "../_shared/env.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { createStructuredResponse, OpenAIError } from "../_shared/openai.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";
import { buildTutorInput, type CheckResult, type LessonInfo } from "../_shared/tutor/buildInput.ts";
import { resolveScreenshots, sanitizeContext } from "../_shared/tutor/context.ts";
import { normalizeTutorOutput, TUTOR_OUTPUT_SCHEMA, type TutorModelOutput } from "../_shared/tutor/schema.ts";

const INTENTS: TutorIntent[] = ["ask", "more_hint", "confused", "solved"];

serve(async (req) => {
  const { user, profile } = await requireUser(req);
  if (profile.role !== "student") throw new HttpError(403, "AI先生は生徒アカウントで使えます。");

  const body = await readJson<TutorRequest>(req);
  const intent: TutorIntent = INTENTS.includes(body.intent) ? body.intent : "ask";
  if (typeof body.sessionId !== "string") throw new HttpError(400, "授業が選ばれていません。");

  const db = adminClient();

  const { data: session } = await db
    .from("lesson_sessions")
    .select("id, student_id, status, goal_note, lessons(title, goal, concepts, ai_guide)")
    .eq("id", body.sessionId)
    .maybeSingle();
  if (!session || session.student_id !== user.id) throw new HttpError(404, "授業が見つかりません。");
  if (session.status !== "active") throw new HttpError(409, "この授業はもう終わっています。");

  const context = sanitizeContext(body.context, user.id, session.id);

  // Attach the open project's current code (never trusting code sent by the client for this).
  let project: { title: string; stage: string; scripts?: { path: string; source: string }[] } | null = null;
  if (typeof body.projectId === "string") {
    const { data: p } = await db
      .from("projects").select("id, student_id, title, stage, placement, explorer_tree, scripts").eq("id", body.projectId).maybeSingle();
    if (p && p.student_id === user.id && p.stage !== "abandoned") {
      const { data: blocks } = await db
        .from("project_blocks").select("idx, code").eq("project_id", p.id).order("idx");
      const source = (blocks ?? []).map((b) => b.code ?? "-- （ここは自分で書く部分）").join("\n");
      if (source.trim()) {
        const placement = p.placement as { parent_path?: string; script_type?: string } | null;
        context.currentScript = {
          path: placement?.parent_path ? `${placement.parent_path}.${placement.script_type ?? "Script"}` : undefined,
          source,
        };
      }
      // The tree the student pasted when planning, unless they just pasted a fresh one.
      if (!context.projectTree && p.explorer_tree) context.projectTree = p.explorer_tree;
      project = { title: p.title ?? "作品", stage: p.stage, scripts: (p.scripts ?? []) as { path: string; source: string }[] };
    }
  }

  // Simple per-student rate limit.
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("student_id", user.id)
    .eq("role", "student")
    .gte("created_at", since);
  if ((count ?? 0) >= LIMITS.tutorCallsPerMinute) {
    throw new HttpError(429, "ちょっと送りすぎかも。1分くらい待って、Studioで試してからまた聞いてね。");
  }

  // History (oldest first) + check results.
  const { data: recent } = await db
    .from("messages")
    .select("*")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(LIMITS.historyMessages);
  const history = ((recent ?? []) as MessageRow[]).reverse();

  const { data: attempts } = await db
    .from("quiz_attempts")
    .select("message_id, is_correct")
    .eq("session_id", session.id);
  const byMessage = new Map<string, CheckResult>();
  for (const a of attempts ?? []) {
    const r = byMessage.get(a.message_id) ?? { messageId: a.message_id, attempts: 0, solved: false };
    r.attempts += 1;
    r.solved ||= a.is_correct;
    byMessage.set(a.message_id, r);
  }

  const images = await resolveScreenshots(db, context.screenshots ?? []);
  const lessonRel = session.lessons as unknown as LessonInfo | LessonInfo[] | null;
  const lesson = Array.isArray(lessonRel) ? lessonRel[0] ?? null : lessonRel;

  const { instructions, input } = buildTutorInput({
    context,
    history,
    checkResults: [...byMessage.values()],
    intent,
    lesson,
    goalNote: session.goal_note,
    project,
    images,
    imageDetail: env.tutorImageDetail(),
  });

  let output: TutorModelOutput;
  let model: string;
  try {
    const res = await createStructuredResponse<TutorModelOutput>({
      model: env.tutorModel(),
      instructions,
      input,
      schemaName: "tutor_turn",
      schema: TUTOR_OUTPUT_SCHEMA,
      reasoningEffort: env.tutorReasoningEffort(),
      maxOutputTokens: 4000,
    });
    output = normalizeTutorOutput(res.data, Boolean(project && project.stage !== "done"));
    model = res.model;
  } catch (err) {
    const detail = err instanceof OpenAIError ? `${err.status ?? ""} ${err.message}` : String(err);
    throw new HttpError(502, "AI先生が今ちょっと考えこんでいるみたい。もう一度「AI先生に聞く」を押してみてね。", detail);
  }

  // Save the student turn and the tutor turn together, only after the AI succeeded,
  // so a failed call can simply be retried without duplicate messages.
  // Both rows list every column: in a multi-row insert, a key missing from one row is sent as NULL
  // (not the column default), which would violate the NOT NULL columns `attachments` / `meta`.
  const now = Date.now();
  const studentRow = {
    session_id: session.id,
    student_id: user.id,
    role: "student",
    message: context.question.trim(),
    code: context.code ?? null,
    attachments: (context.screenshots ?? []).map((path) => ({ bucket: "screenshots", path })),
    intent,
    hint_level: null,
    meta: {},
    created_at: new Date(now).toISOString(),
  };
  const meta: TutorMeta = {
    concept: output.concept,
    problem: output.problem,
    progress: output.progress,
    check: null,
    project_request: output.project_request,
    model,
  };
  const tutorRow = {
    session_id: session.id,
    student_id: user.id,
    role: "tutor",
    message: output.reply,
    code: null,
    attachments: [],
    intent: null,
    hint_level: null,
    meta,
    created_at: new Date(now + 1).toISOString(),
  };

  const { data: saved, error: saveError } = await db
    .from("messages")
    .insert([studentRow, tutorRow], { defaultToNull: false })
    .select("*");
  if (saveError || !saved) throw new HttpError(500, "会話を保存できませんでした。", saveError?.message);

  await db
    .from("lesson_sessions")
    .update({
      last_activity_at: new Date().toISOString(),
      current_concept: output.concept || null,
      current_problem: output.problem || null,
    })
    .eq("id", session.id);

  const rows = saved as MessageRow[];
  return json(req, {
    studentMessage: rows.find((r) => r.role === "student"),
    tutorMessage: rows.find((r) => r.role === "tutor"),
    // The client asks the project function to revise the project (plan → code) right away.
    projectRequest: output.project_request,
  });
});
