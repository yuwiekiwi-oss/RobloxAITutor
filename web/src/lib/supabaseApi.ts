import { createClient, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { type Api, ApiError, type Classroom, startOfToday } from "./api";
import type {
  CheckAnswerResult,
  ConceptEventRow,
  ConceptRow,
  GateResult,
  ProjectBlockRow,
  ProjectRow,
  ProjectWithBlocks,
  SavedTree,
  AccountsList,
  StudentConceptRow,
  WriteResult,
  TweakResult,
  QuizResult,
  EndSessionRequest,
  EndSessionResponse,
  Lesson,
  LessonSession,
  LessonSummaryRow,
  MessageRow,
  Profile,
  QuizAttempt,
  TutorRequest,
  TutorResponse,
} from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && key);

export const supabase: SupabaseClient = createClient(url ?? "http://localhost", key ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true },
});

function fail(error: { message: string } | null, friendly: string): never {
  console.error(error);
  throw new ApiError(friendly);
}

/** Edge Functions return `{ error }` with a friendly message on failure. */
async function invoke<T>(name: string, body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body as Record<string, unknown> });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new ApiError(payload?.error ?? "サーバーでエラーが起きました。");
    }
    throw new ApiError("インターネットにつながっているか確認してね。");
  }
  return data as T;
}

const extFor = (type: string) => (type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg");

export const supabaseApi: Api = {
  async listLessons() {
    const { data, error } = await supabase.from("lessons").select("*").eq("is_active", true).order("sort_order");
    if (error) fail(error, "レッスンを読みこめませんでした。");
    return data as Lesson[];
  },

  async getActiveSession(studentId) {
    const { data, error } = await supabase
      .from("lesson_sessions")
      .select("*")
      .eq("student_id", studentId)
      .eq("status", "active")
      .maybeSingle();
    if (error) fail(error, "授業の情報を読みこめませんでした。");
    return data as LessonSession | null;
  },

  async startSession(lessonId, goalNote) {
    const { data, error } = await supabase.rpc("start_session", { p_lesson_id: lessonId, p_goal_note: goalNote });
    if (error) fail(error, "授業を始められませんでした。");
    return data as LessonSession;
  },

  async listMessages(sessionId) {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at");
    if (error) fail(error, "会話を読みこめませんでした。");
    return data as MessageRow[];
  },

  async listAttempts(sessionIds) {
    if (sessionIds.length === 0) return [];
    const { data, error } = await supabase
      .from("quiz_attempts")
      .select("*")
      .in("session_id", sessionIds)
      .order("created_at");
    if (error) fail(error, "クイズの結果を読みこめませんでした。");
    return data as QuizAttempt[];
  },

  async uploadScreenshot(studentId, sessionId, image) {
    const path = `${studentId}/${sessionId}/${crypto.randomUUID()}.${extFor(image.type)}`;
    const { error } = await supabase.storage
      .from("screenshots")
      .upload(path, image, { contentType: image.type || "image/jpeg", upsert: false });
    if (error) fail(error, "画像をアップロードできませんでした。");
    return path;
  },

  async signedUrls(paths) {
    if (paths.length === 0) return {};
    const { data, error } = await supabase.storage.from("screenshots").createSignedUrls(paths, 60 * 60);
    if (error) fail(error, "画像を表示できませんでした。");
    const out: Record<string, string> = {};
    for (const item of data ?? []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
    return out;
  },

  askTutor: (req: TutorRequest) => invoke<TutorResponse>("tutor", req),

  async submitCheck(messageId, choice) {
    const { data, error } = await supabase.rpc("submit_check_answer", { p_message_id: messageId, p_choice: choice });
    if (error) fail(error, "答えを送れませんでした。");
    return data as CheckAnswerResult;
  },

  async setHelp(sessionId, on) {
    const { data, error } = await supabase.rpc("set_help_request", { p_session_id: sessionId, p_on: on });
    if (error) fail(error, "先生を呼べませんでした。手をあげて呼んでね。");
    return data as LessonSession;
  },

  async setLesson(sessionId, lessonId) {
    const { data, error } = await supabase.rpc("set_session_lesson", { p_session_id: sessionId, p_lesson_id: lessonId });
    if (error) fail(error, "レッスンを変えられませんでした。");
    return data as LessonSession;
  },

  endSession: (req: EndSessionRequest) => invoke<EndSessionResponse>("end-session", req),

  async getSummary(sessionId) {
    const { data, error } = await supabase.from("lesson_summaries").select("*").eq("session_id", sessionId).maybeSingle();
    if (error) fail(error, "まとめを読みこめませんでした。");
    return data as LessonSummaryRow | null;
  },

  async loadClassroom(teacherId): Promise<Classroom> {
    const [studentsRes, lessonsRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("teacher_id", teacherId).order("display_name"),
      supabase.from("lessons").select("*").order("sort_order"),
    ]);
    if (studentsRes.error) fail(studentsRes.error, "生徒一覧を読みこめませんでした。");
    const students = studentsRes.data as Profile[];
    const ids = students.map((s) => s.id);
    if (ids.length === 0) {
      return { students, sessions: [], messages: [], attempts: [], summaryIds: new Set(), lessons: lessonsRes.data ?? [], projects: [] };
    }

    const { data: sessionRows, error: sErr } = await supabase
      .from("lesson_sessions")
      .select("*")
      .in("student_id", ids)
      .or(`status.eq.active,started_at.gte.${startOfToday()}`)
      .order("started_at", { ascending: false });
    if (sErr) fail(sErr, "授業の情報を読みこめませんでした。");
    // Keep the latest session per student.
    const latest = new Map<string, LessonSession>();
    for (const s of sessionRows as LessonSession[]) {
      const cur = latest.get(s.student_id);
      if (!cur || (cur.status !== "active" && s.status === "active")) latest.set(s.student_id, s);
    }
    const sessions = [...latest.values()];
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length === 0) {
      return { students, sessions, messages: [], attempts: [], summaryIds: new Set(), lessons: lessonsRes.data ?? [], projects: [] };
    }

    const [msgRes, attempts, sumRes, projRes] = await Promise.all([
      supabase
        .from("messages")
        .select("id, session_id, student_id, role, message, code, attachments, intent, hint_level, meta, created_at")
        .in("session_id", sessionIds)
        .order("created_at"),
      supabaseApi.listAttempts(sessionIds),
      supabase.from("lesson_summaries").select("session_id").in("session_id", sessionIds),
      supabase.from("projects").select("*").in("session_id", sessionIds).neq("stage", "abandoned")
        .order("created_at", { ascending: false }),
    ]);
    if (msgRes.error) fail(msgRes.error, "会話を読みこめませんでした。");
    return {
      students,
      sessions,
      messages: msgRes.data as MessageRow[],
      attempts,
      summaryIds: new Set((sumRes.data ?? []).map((r) => r.session_id as string)),
      lessons: (lessonsRes.data ?? []) as Lesson[],
      projects: (projRes.data ?? []) as ProjectRow[],
    };
  },

  // ---------------------------------------------------------------- projects & mastery
  async listConcepts() {
    const { data, error } = await supabase.from("concepts").select("*").order("sort_order");
    if (error) fail(error, "考え方の一覧を読みこめませんでした。");
    return data as ConceptRow[];
  },

  async getMastery(studentId) {
    const { data, error } = await supabase.from("student_concepts").select("*").eq("student_id", studentId);
    if (error) fail(error, "習熟度を読みこめませんでした。");
    return data as StudentConceptRow[];
  },

  async listConceptEvents({ projectId }) {
    const { data, error } = await supabase
      .from("concept_events").select("*").eq("project_id", projectId).order("created_at");
    if (error) fail(error, "記録を読みこめませんでした。");
    return data as ConceptEventRow[];
  },

  async getOpenProject(studentId) {
    const { data, error } = await supabase
      .from("projects").select("*").eq("student_id", studentId).not("stage", "in", "(done,abandoned)").maybeSingle();
    if (error) fail(error, "作品を読みこめませんでした。");
    return data ? supabaseApi.getProject((data as ProjectRow).id) : null;
  },

  async getProject(projectId) {
    const [p, b] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("project_blocks").select("*").eq("project_id", projectId).order("idx"),
    ]);
    if (p.error || b.error) fail(p.error ?? b.error, "作品を読みこめませんでした。");
    return { project: p.data as ProjectRow, blocks: b.data as ProjectBlockRow[] };
  },

  planProject: (sessionId, idea, extras) => invoke<ProjectWithBlocks>("project", { action: "plan", sessionId, idea, ...extras }),
  refinePlan: (projectId, input) => invoke<ProjectWithBlocks>("project", { action: "refine", projectId, ...input }),
  buildProject: (projectId) => invoke<ProjectWithBlocks>("project", { action: "build", projectId }),
  reviseProject: (projectId, request) => invoke<ProjectWithBlocks>("project", { action: "revise", projectId, request }),
  submitWrite: (projectId, idx, code) => invoke<WriteResult>("project", { action: "write", projectId, idx, code }),
  answerTweak: (projectId, answer) => invoke<TweakResult>("project", { action: "tweak", projectId, answer }),
  answerQuiz: (projectId, idx, code) => invoke<QuizResult>("project", { action: "quiz", projectId, idx, code }),
  async markBlockTyped(projectId, idx) {
    const { data, error } = await supabase.rpc("mark_block_typed", { p_project_id: projectId, p_idx: idx });
    if (error) fail(error, "保存できませんでした。もう一度押してね。");
    return data as ProjectBlockRow;
  },

  async answerGate(projectId, item, choice) {
    const { data, error } = await supabase.rpc("answer_project_item", { p_project_id: projectId, p_item: item, p_choice: choice });
    if (error) fail(error, "答えを送れませんでした。");
    return data as GateResult;
  },

  async reportRun(projectId, ok) {
    const { data, error } = await supabase.rpc("report_project_run", { p_project_id: projectId, p_ok: ok });
    if (error) fail(error, "送れませんでした。");
    return data as ProjectRow;
  },

  async finishProject(projectId) {
    const { data, error } = await supabase.rpc("finish_project", { p_project_id: projectId });
    if (error) fail(error, "完成にできませんでした。");
    return data as ProjectRow;
  },

  async abandonProject(projectId) {
    const { data, error } = await supabase.rpc("abandon_project", { p_project_id: projectId });
    if (error) fail(error, "やめられませんでした。");
    return data as ProjectRow;
  },

  async setConceptLevel(studentId, conceptId, level) {
    const { data, error } = await supabase.rpc("teacher_set_concept_level", { p_student: studentId, p_concept: conceptId, p_level: level });
    if (error) fail(error, "習熟度を変えられませんでした。");
    return data as StudentConceptRow;
  },

  async resumeProject(projectId, sessionId) {
    const { error } = await supabase.rpc("resume_project", { p_project_id: projectId, p_session_id: sessionId });
    if (error) fail(error, "作品をひらけませんでした。");
    return supabaseApi.getProject(projectId);
  },

  async resetMastery(studentId) {
    const { data, error } = await supabase.rpc("teacher_reset_mastery", { p_student: studentId });
    if (error) fail(error, "習熟度をリセットできませんでした。");
    return data as number;
  },

  // ---------------------------------------------------------------- saved Studio trees
  async listSavedTrees() {
    const { data, error } = await supabase
      .from("student_trees").select("id, place, tree, created_at, last_used_at").order("last_used_at", { ascending: false }).limit(6);
    if (error) fail(error, "前に使った構成を読みこめませんでした。");
    return (data ?? []) as SavedTree[];
  },
  async saveTree(tree, place) {
    const { data, error } = await supabase.rpc("save_tree", { p_tree: tree, p_place: place });
    if (error) fail(error, "構成を保存できませんでした。");
    return data as SavedTree;
  },
  listAccounts: () => invoke<AccountsList>("accounts", { action: "list" }),
  async setPassword(userId, password) {
    await invoke("accounts", { action: "set_password", userId, password });
  },
  async setAdmin(userId, isAdmin) {
    await invoke("accounts", { action: "set_admin", userId, isAdmin });
  },
  async deleteSavedTree(id) {
    const { error } = await supabase.from("student_trees").delete().eq("id", id);
    if (error) fail(error, "構成を消せませんでした。");
  },
};
