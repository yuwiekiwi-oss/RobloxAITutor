// POST /functions/v1/project — build-first projects.
//   plan:   student's idea (+ reference images + Explorer tree) → a project small enough for today,
//           with what AI先生 understood (「こういうこと？」) and up to 3 tap-to-answer questions
//   refine: the student's answers / corrections → the plan again (questions are asked only once)
//   revise: a change asked for in the chat, at any step → re-plan, and re-build if code exists
//   build:  plan → code in blocks; each block is shown as explain / blank / write / given
//           depending on the student's recorded mastery of its concepts
//   write:  grade a block the student wrote themselves
//   quiz:   grade a code answer of テスト (「こうしたい！どう変える？」)
//   tweak:  grade the written answer of いじる (older projects)
// Grading of multiple-choice gates and all mastery updates happen in the database (RPCs).
import {
  BLANK_TOKEN,
  LIMITS,
  type ProjectBlockRow,
  type ProjectPlan,
  type ProjectRequest,
  type ProjectRow,
  type ProjectWithBlocks,
  type StudentScript,
  type QuizResult,
  type TweakResult,
  type WriteResult,
} from "../_shared/contracts.ts";
import { env } from "../_shared/env.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { createStructuredResponse, type InputContentPart, OpenAIError } from "../_shared/openai.ts";
import { decideModes, effectiveLevel, makeBlank } from "../_shared/project/mastery.ts";
import {
  BUILD_INSTRUCTIONS,
  type BuildOutput,
  buildSchema,
  cleanLines,
  cleanQuestions,
  countCodeLines,
  formatBuildInput,
  formatPlanInput,
  PLAN_INSTRUCTIONS,
  PLAN_SCHEMA,
  pickCodeQuiz,
  QUIZ_INSTRUCTIONS,
  type PlanOutput,
  TWEAK_INSTRUCTIONS,
  TWEAK_SCHEMA,
  validChoice,
  WRITE_INSTRUCTIONS,
  withLessonGuide,
  WRITE_SCHEMA,
  type WriteOutput,
} from "../_shared/project/prompt.ts";
import { cleanTree } from "../_shared/studioTree.ts";
import { sameCode } from "../_shared/codeMatch.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";
import { resolveScreenshots } from "../_shared/tutor/context.ts";

const WRITE_REVEAL_AFTER = 3; // the 3rd failed attempt shows the model answer
const TWEAK_REVEAL_AFTER = 2; // いじる: the 2nd miss shows what should have happened
const QUIZ_REVEAL_AFTER = 2; // テスト: the 2nd miss shows the model answer
const MAX_PLAN_ROUNDS = 12; // plan + corrections + changes asked for in chat

async function ai<T>(
  name: string,
  instructions: string,
  input: string,
  schema: Record<string, unknown>,
  maxOutputTokens: number,
  images: string[] = [],
) {
  const content: string | InputContentPart[] = images.length
    ? [
      { type: "input_text", text: input },
      ...images.map((url): InputContentPart => ({ type: "input_image", image_url: url, detail: env.tutorImageDetail() })),
    ]
    : input;
  try {
    const res = await createStructuredResponse<T>({
      model: env.tutorModel(),
      instructions,
      input: [{ role: "user", content }],
      schemaName: name,
      schema,
      reasoningEffort: env.tutorReasoningEffort(),
      maxOutputTokens,
    });
    return res.data;
  } catch (err) {
    const detail = err instanceof OpenAIError ? `${err.status ?? ""} ${err.message}` : String(err);
    throw new HttpError(502, "AI先生が今ちょっと考えこんでいるみたい。もう一度押してみてね。", detail);
  }
}

/** A blank's translation without its answer: the target is hidden in code, meaning and words. */
function maskLines(lines: ReturnType<typeof cleanLines>, target: string): ReturnType<typeof cleanLines> {
  if (!lines || !target) return lines;
  return lines.map((l) => ({
    code: l.code.split(target).join(BLANK_TOKEN),
    meaning: l.meaning.split(target).join("？"),
    words: l.words.filter((w) => !w.word.includes(target) && !target.includes(w.word)),
  }));
}

function toPlan(out: PlanOutput, extra: Partial<ProjectPlan>): ProjectPlan {
  return {
    understanding: (out.understanding ?? "").trim().slice(0, 300),
    summary: (out.summary ?? "").trim().slice(0, 300),
    parts: (out.parts ?? []).map((p) => p.trim().slice(0, 120)).filter(Boolean).slice(0, 4),
    ...extra,
  };
}

type Db = ReturnType<typeof adminClient>;
type Lesson = { guide: string | null; maxLines: number | null };

/** The lesson selected for the project's session (体験授業 etc.): extra AI rules and a line limit. */
async function lessonFor(db: Db, sessionId: string): Promise<Lesson> {
  const { data } = await db
    .from("lesson_sessions").select("lessons(ai_guide, max_lines)").eq("id", sessionId).maybeSingle();
  const rel = data?.lessons as unknown as { ai_guide: string | null; max_lines: number | null } | { ai_guide: string | null; max_lines: number | null }[] | null;
  const l = Array.isArray(rel) ? rel[0] : rel;
  return { guide: l?.ai_guide ?? null, maxLines: l?.max_lines ?? null };
}

/** AI先生 asks for a script only while none was given / declined, and at most 3 scripts. */
function scriptRequest(out: PlanOutput, plan: Partial<ProjectPlan>, scripts: StudentScript[]): ProjectPlan["script_request"] {
  const r = out.script_request;
  if (!r || plan.script_declined || scripts.length >= 3) return null;
  const name = (r.name ?? "").trim().slice(0, 120);
  if (!name || scripts.some((s) => s.path === name)) return null;
  return { name, reason: (r.reason ?? "").trim().slice(0, 160) };
}

/**
 * Makes the plan again with the student's answers / corrections (questions are asked only once,
 * so they are cleared here). Used by refine (plan step) and revise (requests from the chat).
 */
async function replan(
  db: Db,
  project: ProjectRow,
  input: {
    answers?: { question: string; answer: string }[];
    feedback?: string;
    tree?: string | null;
    currentCode?: string;
    scripts?: StudentScript[];
    scriptDeclined?: boolean;
  },
): Promise<ProjectRow> {
  const prev = (project.plan ?? {}) as ProjectPlan;
  if ((prev.round ?? 1) >= MAX_PLAN_ROUNDS) {
    throw new HttpError(429, "何回も作り直したね。先生といっしょに、作りたいものを整理してみよう。");
  }
  const lesson = await lessonFor(db, project.session_id);
  const tree = input.tree ?? project.explorer_tree;
  const scripts = input.scripts ?? project.scripts ?? [];
  const declined = Boolean(prev.script_declined || input.scriptDeclined);
  const answers = [...(prev.answers ?? []), ...(input.answers ?? [])];
  const feedback = [...(prev.feedback ?? []), ...(input.feedback ? [input.feedback] : [])].slice(-6);
  const imageData = await resolveScreenshots(db, project.idea_images ?? []);
  const out = await ai<PlanOutput>(
    "project_plan",
    withLessonGuide(PLAN_INSTRUCTIONS, lesson.guide),
    formatPlanInput({
      idea: project.idea,
      tree,
      imageCount: imageData.length,
      previous: { title: project.title, understanding: prev.understanding, summary: prev.summary, parts: prev.parts },
      currentCode: input.currentCode,
      answers,
      feedback,
      scripts,
      scriptDeclined: declined,
    }),
    PLAN_SCHEMA,
    2000,
    imageData,
  );
  const extra: Partial<ProjectPlan> = { round: (prev.round ?? 1) + 1, questions: [], answers, feedback, script_declined: declined };
  const saved = await db.from("projects").update({
    title: out.title.trim().slice(0, 60) || project.title,
    plan: toPlan(out, { ...extra, script_request: scriptRequest(out, extra, scripts) }),
    explorer_tree: tree,
    scripts,
  }).eq("id", project.id).select("*").single();
  if (saved.error) throw new HttpError(500, "作品を保存できませんでした。", saved.error.message);
  return saved.data as ProjectRow;
}

/**
 * plan → code in blocks, each shown by the student's mastery (explain / blank / write / given).
 * `previousCode`: the code before a revision, so unchanged parts stay the same.
 * A lesson's max_lines (体験授業) is enforced: one retry with "too long", then the shorter result wins.
 */
async function build(db: Db, project: ProjectRow, studentId: string, previousCode?: string): Promise<ProjectWithBlocks> {
  const plan = (project.plan ?? {}) as ProjectPlan;
  const lesson = await lessonFor(db, project.session_id);
  const [{ data: concepts }, { data: mastery }] = await Promise.all([
    db.from("concepts").select("id, name").order("sort_order"),
    db.from("student_concepts").select("concept_id, level, last_seen_at").eq("student_id", studentId),
  ]);
  const levels: Record<string, number> = {};
  for (const m of mastery ?? []) levels[m.concept_id] = effectiveLevel(m.level, m.last_seen_at);
  const catalog = (concepts ?? []) as { id: string; name: string }[];

  const imageData = await resolveScreenshots(db, project.idea_images ?? []);
  const instructions = withLessonGuide(BUILD_INSTRUCTIONS, lesson.guide);
  const input = formatBuildInput({
    idea: project.idea,
    plan: { ...plan, title: project.title },
    tree: project.explorer_tree,
    imageCount: imageData.length,
    previousCode,
    scripts: project.scripts ?? [],
    concepts: catalog.map((c) => ({ ...c, level: levels[c.id] ?? 0 })),
  });
  const schema = buildSchema(catalog.map((c) => c.id));
  const lineCount = (o: BuildOutput) => countCodeLines((o.blocks ?? []).map((b) => b.code ?? "").join("\n"));

  let out = await ai<BuildOutput>("project_build", instructions, input, schema, 8000, imageData);
  if (lesson.maxLines && lineCount(out) > lesson.maxLines) {
    const retry = await ai<BuildOutput>(
      "project_build",
      instructions,
      `${input}\n\n【やり直し】前の案は${lineCount(out)}行で長すぎた。お手本のように${lesson.maxLines}行以内の、もっと短くてかんたんなコードにする。`,
      schema,
      8000,
      imageData,
    );
    if ((retry.blocks ?? []).length && lineCount(retry) < lineCount(out)) out = retry;
  }

  const known = new Set(catalog.map((c) => c.id));
  const blocks = (out.blocks ?? []).filter((b) => b.code?.trim()).slice(0, 5);
  if (blocks.length === 0) {
    throw new HttpError(502, "うまくコードを作れなかったみたい。もう一度「これで作る」を押してね。", "invalid build output");
  }
  const prepared = blocks.map((b) => {
    const conceptIds = [...new Set((b.concepts ?? []).filter((c) => known.has(c)))].slice(0, 3);
    const blankCode = makeBlank(b.code, b.blank);
    return { b, conceptIds, blankCode, checkOk: validChoice(b.check) };
  });
  const modes = decideModes(prepared.map((p) => ({ concepts: p.conceptIds, hasValidBlank: p.blankCode !== null })), levels);

  const blockRows = prepared.map((p, idx) => {
    const mode = modes[idx] === "explain" && !p.checkOk ? "given" : modes[idx];
    return {
      project_id: project.id,
      student_id: studentId,
      idx,
      title: p.b.title.slice(0, 40),
      purpose: p.b.purpose.slice(0, 200),
      concepts: p.conceptIds,
      mode,
      code: mode === "blank" ? p.blankCode : mode === "write" ? null : p.b.code,
      blank: mode === "blank" ? { prompt: p.b.blank.prompt, choices: p.b.blank.choices } : null,
      explanation: mode === "explain" ? p.b.explanation : null,
      check_q: mode === "explain" ? { question: p.b.check.question, choices: p.b.check.choices } : null,
      // The translation would give away blanks / blocks to write, so only shown code gets one.
      // Every typed block gets its translation. In a blank the answer is hidden until it is filled
      // (the client pairs each meaning with the block's current code line).
      lines: mode === "write" ? null : mode === "blank" ? maskLines(cleanLines(p.b.lines, p.b.code), p.b.blank.target) : cleanLines(p.b.lines, p.b.code),
    };
  });

  // テスト: three code questions 「こうしたい！どう変える？」 (answers stay in project_keys).
  const quiz = pickCodeQuiz(out.quiz);

  type KeyRow = { project_id: string; item: string; answer_index: number | null; answer_text: string | null; explanation: string };
  const keys: KeyRow[] = [
    ...quiz.map((q, i): KeyRow => ({ project_id: project.id, item: `quiz:${i}`, answer_index: null, answer_text: q.answer, explanation: q.explanation })),
    ...prepared.flatMap((p, idx): KeyRow[] => {
      const mode = blockRows[idx].mode;
      if (mode === "blank") {
        return [{ project_id: project.id, item: `blank:${idx}`, answer_index: p.b.blank.answer_index, answer_text: p.b.blank.target, explanation: p.b.blank.explanation }];
      }
      if (mode === "explain") {
        return [{ project_id: project.id, item: `check:${idx}`, answer_index: p.b.check.answer_index, answer_text: null, explanation: p.b.check.explanation }];
      }
      if (mode === "write") {
        return [{ project_id: project.id, item: `write:${idx}`, answer_index: null, answer_text: p.b.code, explanation: p.b.purpose }];
      }
      return [];
    }),
  ];

  const r1 = await db.from("project_blocks").insert(blockRows);
  const r2 = r1.error ? r1 : await db.from("project_keys").insert(keys);
  const r3 = r2.error ? r2 : await db.from("projects").update({
    title: out.title.slice(0, 60) || project.title,
    placement: out.placement,
    predict: null,
    tweak: null,
    quiz: quiz.length ? quiz.map((q) => ({ goal: q.goal, code: q.code })) : null,
  }).eq("id", project.id);
  if (r3.error) {
    await db.from("project_blocks").delete().eq("project_id", project.id);
    await db.from("project_keys").delete().eq("project_id", project.id);
    throw new HttpError(500, "作品を保存できませんでした。", r3.error.message);
  }
  await db.rpc("start_project_build", { p_project_id: project.id });

  const [{ data: p }, { data: bl }] = await Promise.all([
    db.from("projects").select("*").eq("id", project.id).single(),
    db.from("project_blocks").select("*").eq("project_id", project.id).order("idx"),
  ]);
  return { project: p as ProjectRow, blocks: bl as ProjectBlockRow[] };
}

serve(async (req) => {
  const { user, profile } = await requireUser(req);
  if (profile.role !== "student") throw new HttpError(403, "生徒アカウントで使えます。");
  const body = await readJson<ProjectRequest>(req);
  const db = adminClient();

  // ------------------------------------------------------------------ plan
  if (body.action === "plan") {
    const idea = typeof body.idea === "string" ? body.idea.trim().slice(0, 300) : "";
    if (!idea) throw new HttpError(400, "作りたいものを書いてね。");

    const { data: session } = await db
      .from("lesson_sessions").select("id, student_id, status").eq("id", body.sessionId).maybeSingle();
    if (!session || session.student_id !== user.id || session.status !== "active") {
      throw new HttpError(409, "授業が始まっていないみたい。画面を読みこみ直してね。");
    }

    const { data: open } = await db
      .from("projects").select("id, stage").eq("student_id", user.id).not("stage", "in", "(done,abandoned)").maybeSingle();
    if (open && open.stage !== "plan") throw new HttpError(409, "作りかけの作品があるよ。完成させるか、やめてから新しく始めてね。");

    // Images must be the caller's own uploads for this session (same rule as the tutor).
    const prefix = `${user.id}/${session.id}/`;
    const images = (Array.isArray(body.images) ? body.images : [])
      .filter((p): p is string => typeof p === "string" && p.startsWith(prefix) && !p.includes("..") && p.length < 300)
      .slice(0, LIMITS.ideaImages);
    const tree = cleanTree(body.tree);
    const lesson = await lessonFor(db, session.id);

    const imageData = await resolveScreenshots(db, images);
    const out = await ai<PlanOutput>(
      "project_plan",
      withLessonGuide(PLAN_INSTRUCTIONS, lesson.guide),
      formatPlanInput({ idea, tree, imageCount: images.length }),
      PLAN_SCHEMA,
      2000,
      imageData,
    );
    const row = {
      session_id: session.id,
      student_id: user.id,
      idea,
      idea_images: images,
      explorer_tree: tree,
      scripts: [],
      title: out.title.trim().slice(0, 60) || idea.slice(0, 60),
      plan: toPlan(out, { round: 1, questions: cleanQuestions(out.questions), script_request: scriptRequest(out, {}, []) }),
    };
    const saved = open
      ? await db.from("projects").update(row).eq("id", open.id).select("*").single()
      : await db.from("projects").insert(row).select("*").single();
    if (saved.error) throw new HttpError(500, "作品を保存できませんでした。", saved.error.message);
    return json(req, { project: saved.data as ProjectRow, blocks: [] });
  }

  // Everything else works on the caller's own project.
  const { data: project } = await db.from("projects").select("*").eq("id", body.projectId).maybeSingle();
  if (!project || project.student_id !== user.id) throw new HttpError(404, "作品が見つかりません。");

  // ------------------------------------------------------------------ refine
  if (body.action === "refine") {
    if (project.stage !== "plan") throw new HttpError(409, "この作品はもう作り始めているよ。");
    const prev = (project.plan ?? {}) as ProjectPlan;
    const asked = new Set((prev.questions ?? []).map((q) => q.question));
    const answers = (Array.isArray(body.answers) ? body.answers : [])
      .filter((a) => a && typeof a.question === "string" && typeof a.answer === "string" && asked.has(a.question))
      .map((a) => ({ question: a.question, answer: a.answer.trim().slice(0, 80) || "おまかせ" }));
    const fb = typeof body.feedback === "string" ? body.feedback.trim().slice(0, 300) : "";
    const newTree = cleanTree(body.tree);
    // The script AI先生 asked for (Ctrl+A → Ctrl+C in Studio → paste).
    const pasted = body.script && typeof body.script.source === "string" && body.script.source.trim()
      ? {
        path: (typeof body.script.path === "string" && body.script.path.trim() ? body.script.path.trim() : prev.script_request?.name ?? "Script").slice(0, 120),
        source: body.script.source.slice(0, LIMITS.codeChars),
      }
      : null;
    const noScript = body.noScript === true;
    if (!answers.length && !fb && !newTree && !pasted && !noScript) throw new HttpError(400, "どこがちがうか書いてね。");

    const scripts = pasted
      ? [...((project.scripts ?? []) as StudentScript[]).filter((s) => s.path !== pasted.path), pasted].slice(-3)
      : undefined;
    const saved = await replan(db, project as ProjectRow, {
      answers,
      feedback: fb || (noScript ? "そのScriptは無い／わからない" : ""),
      tree: newTree,
      scripts,
      scriptDeclined: noScript,
    });
    return json(req, { project: saved, blocks: [] });
  }

  // ------------------------------------------------------------------ revise (asked for in chat)
  // At any step before 'done': update the plan with the request; if code was already made,
  // clear it and build again from the new plan (mastery is kept, so modes follow the current level).
  if (body.action === "revise") {
    if (["done", "abandoned"].includes(project.stage)) {
      throw new HttpError(409, "完成した作品は変えられないよ。新しい作品として作ろう。");
    }
    const request = typeof body.request === "string" ? body.request.trim().slice(0, 300) : "";
    if (!request) throw new HttpError(400, "どう変えたいか書いてね。");

    if (project.stage === "plan") {
      const saved = await replan(db, project as ProjectRow, { feedback: request });
      return json(req, { project: saved, blocks: [] });
    }

    const { data: oldBlocks } = await db.from("project_blocks").select("idx, code").eq("project_id", project.id).order("idx");
    const previousCode = (oldBlocks ?? []).map((b) => b.code ?? "-- （ここは生徒が書く部分）").join("\n");
    const replanned = await replan(db, project as ProjectRow, { feedback: request, currentCode: previousCode });
    const { data: reset, error } = await db.rpc("reset_project_for_revision", { p_project_id: project.id });
    if (error) throw new HttpError(500, "作品を作り直せませんでした。", error.message);
    // The change needs a script the student has not shown yet: stop at the plan step and ask for it.
    if ((replanned.plan as ProjectPlan).script_request) return json(req, { project: reset as ProjectRow, blocks: [] });
    // If building fails now, the project waits at 「こういうこと？」 with the new plan (「そう！これで作る」 retries).
    return json(req, await build(db, { ...replanned, stage: "plan" }, user.id, previousCode));
  }

  // ------------------------------------------------------------------ build
  if (body.action === "build") {
    if (project.stage !== "plan") throw new HttpError(409, "この作品はもう作り始めているよ。");
    const plan = (project.plan ?? {}) as ProjectPlan;
    if (plan.questions?.length) throw new HttpError(409, "AI先生のしつもんに答えてから作ろう。");
    if (plan.script_request) throw new HttpError(409, "AI先生に見せてほしいScriptがあるよ。貼るか「ない」を押してね。");
    return json(req, await build(db, project as ProjectRow, user.id));
  }
  // ------------------------------------------------------------------ write
  if (body.action === "write") {
    if (project.stage !== "build") throw new HttpError(409, "今は書くところじゃないみたい。");
    const code = typeof body.code === "string" ? body.code.slice(0, 4000) : "";
    if (!code.trim()) throw new HttpError(400, "コードを書いてからチェックしてね。");

    const { data: block } = await db
      .from("project_blocks").select("*").eq("project_id", project.id).eq("idx", body.idx).eq("mode", "write").maybeSingle();
    if (!block || block.build_done) throw new HttpError(404, "このまとまりはもう終わっているよ。");

    const [{ data: key }, { count: fails }, { data: others }] = await Promise.all([
      db.from("project_keys").select("answer_text, explanation").eq("project_id", project.id).eq("item", `write:${block.idx}`).single(),
      db.from("project_attempts").select("id", { count: "exact", head: true })
        .eq("project_id", project.id).eq("item", `write:${block.idx}`).eq("correct", false),
      db.from("project_blocks").select("idx, code").eq("project_id", project.id).order("idx"),
    ]);

    const context = (others ?? []).map((o) => (o.idx === block.idx ? "-- ▼ここを生徒が書く▼" : o.code ?? "-- （まだ書いていない部分）")).join("\n");
    const verdict = await ai<WriteOutput>(
      "project_write_check",
      WRITE_INSTRUCTIONS,
      [
        `【このまとまりでやりたいこと】${key?.explanation ?? block.purpose}`,
        `【お手本】\n${key?.answer_text ?? ""}`,
        `【作品全体（参考）】\n${context}`,
        `【生徒が書いたコード】\n${code}`,
      ].join("\n\n"),
      WRITE_SCHEMA,
      1200,
    );

    const reveal = !verdict.passed && (fails ?? 0) + 1 >= WRITE_REVEAL_AFTER;
    const { data: updated, error } = await db.rpc("record_write_attempt", {
      p_project_id: project.id,
      p_idx: block.idx,
      p_code: code,
      p_passed: verdict.passed,
      p_reveal: reveal,
    });
    if (error) throw new HttpError(500, "結果を保存できませんでした。", error.message);

    const result: WriteResult = {
      passed: verdict.passed,
      revealed: reveal,
      feedback: reveal
        ? "むずかしかったね。お手本を入れておいたから、どこがちがったか見くらべてみよう。"
        : verdict.feedback,
      block: updated as ProjectBlockRow,
    };
    return json(req, result);
  }

  // ------------------------------------------------------------------ quiz (code test answer)
  if (body.action === "quiz") {
    if (project.stage !== "explore") throw new HttpError(409, "今はテストのところじゃないみたい。");
    const idx = Number(body.idx);
    const code = typeof body.code === "string" ? body.code.slice(0, 4000) : "";
    if (!Number.isInteger(idx) || !code.trim()) throw new HttpError(400, "コードを書きかえてからチェックしてね。");
    const q = (Array.isArray(project.quiz) ? project.quiz[idx] : null) as { goal?: string; code?: string } | null;
    const [{ data: key }, { count: fails }] = await Promise.all([
      db.from("project_keys").select("answer_text, explanation").eq("project_id", project.id).eq("item", `quiz:${idx}`).maybeSingle(),
      db.from("project_attempts").select("id", { count: "exact", head: true })
        .eq("project_id", project.id).eq("item", `quiz:${idx}`).eq("correct", false),
    ]);
    if (!q?.code || !key) throw new HttpError(404, "その問題が見つかりません。");

    let passed: boolean;
    let feedback: string;
    if (sameCode(code, key.answer_text ?? "")) {
      passed = true;
      feedback = `正解！${key.explanation ?? ""}`;
    } else if (sameCode(code, q.code)) {
      passed = false;
      feedback = "まだ元のコードのままだよ。どこを変えればいいか、さがしてみよう。";
    } else {
      const verdict = await ai<WriteOutput>(
        "project_quiz_check",
        QUIZ_INSTRUCTIONS,
        [
          `【やりたいこと】${q.goal ?? ""}`,
          `【元のコード】\n${q.code}`,
          `【お手本】\n${key.answer_text ?? ""}（理由：${key.explanation ?? ""}）`,
          `【生徒のコード】\n${code}`,
        ].join("\n\n"),
        WRITE_SCHEMA,
        800,
      );
      passed = verdict.passed;
      feedback = verdict.feedback;
    }
    const reveal = !passed && (fails ?? 0) + 1 >= QUIZ_REVEAL_AFTER;
    const { data: rec, error } = await db.rpc("record_quiz_answer", {
      p_project_id: project.id, p_idx: idx, p_code: code, p_passed: passed, p_reveal: reveal,
    });
    if (error) throw new HttpError(500, "答えを保存できませんでした。", error.message);
    const r = rec as { answer: string | null; explanation: string | null };
    const result: QuizResult = {
      passed,
      revealed: reveal,
      feedback: reveal ? `むずかしかったね。お手本はこうだよ。${r.explanation ?? ""}` : feedback,
      answer: r.answer,
    };
    return json(req, result);
  }

  // ------------------------------------------------------------------ tweak (written answer, older projects)
  if (body.action === "tweak") {
    if (project.stage !== "tweak") throw new HttpError(409, "今はいじるところじゃないみたい。");
    const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 500) : "";
    if (!answer) throw new HttpError(400, "やってみてどうなったか書いてね。");
    const [{ data: key }, { count: fails }] = await Promise.all([
      db.from("project_keys").select("answer_text, explanation").eq("project_id", project.id).eq("item", "tweak").single(),
      db.from("project_attempts").select("id", { count: "exact", head: true })
        .eq("project_id", project.id).eq("item", "tweak").eq("correct", false),
    ]);
    const tweak = project.tweak as { instruction?: string; question?: string } | null;
    const verdict = await ai<WriteOutput>(
      "project_tweak_check",
      TWEAK_INSTRUCTIONS,
      [
        `【ミッション】${tweak?.instruction ?? ""}`,
        `【問い】${tweak?.question ?? ""}`,
        `【期待する答え】${key?.answer_text ?? ""}（理由：${key?.explanation ?? ""}）`,
        `【生徒の答え】${answer}`,
      ].join("\n"),
      TWEAK_SCHEMA,
      800,
    );
    const reveal = !verdict.passed && (fails ?? 0) + 1 >= TWEAK_REVEAL_AFTER;
    const { data: rec, error } = await db.rpc("record_tweak_answer", {
      p_project_id: project.id, p_answer: answer, p_passed: verdict.passed, p_reveal: reveal,
    });
    if (error) throw new HttpError(500, "答えを保存できませんでした。", error.message);
    const r = rec as { expected: string | null; explanation: string | null };
    const result: TweakResult = {
      passed: verdict.passed,
      revealed: reveal,
      feedback: reveal ? `むずかしかったね。こうなるはずだったよ：${r.expected ?? ""}。${r.explanation ?? ""}` : verdict.feedback,
      expected: r.expected,
    };
    return json(req, result);
  }

  throw new HttpError(400, "リクエストの形が正しくありません。");
});
