// In-memory backend for the dev preview (#/preview). Never shipped to production.
import type { Api } from "../lib/api";
import { PASSWORD_MIN } from "../lib/types";
import { projectApi, seedTeacherProjects } from "./mockProjects";
import type {
  Lesson,
  LessonSession,
  LessonSummaryRow,
  MessageRow,
  Profile,
  QuizAttempt,
  SavedTree,
  AccountRow,
  TutorMeta,
} from "../lib/types";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const id = () => `mock-${++seq}`;

// Only 体験授業 is offered now; the old lessons stay for past sessions (like inactive rows in the DB).
const trial: Lesson = { id: "trial", title: "体験授業", goal: "今あるゲームに短いコードを足して、目で見える変化を起こす", concepts: ["Instance.new", "プロパティ", "math.random"], emoji: "✨", sort_order: 10 };
export const lessons: Lesson[] = [
  trial,
  { id: "kill-brick", title: "触れるとダメージを受ける床", goal: "プレイヤーが触れたら体力が減る床を作る", concepts: ["Touchedイベント", "Humanoid", "if文（条件）"], emoji: "🔥", sort_order: 10 },
  { id: "click-door", title: "クリックで開くドア", goal: "ドアをクリックすると開いて通れるようにする", concepts: ["ClickDetector", "プロパティ", "イベント"], emoji: "🚪", sort_order: 20 },
  { id: "speed-pad", title: "スピードアップ床", goal: "踏むと少しの間だけ足が速くなる床を作る", concepts: ["Touchedイベント", "WalkSpeed", "task.wait"], emoji: "⚡", sort_order: 30 },
  { id: "coin-collect", title: "コインを集めよう", goal: "コインに触れるとスコアが増えてコインが消える", concepts: ["leaderstats", "Touchedイベント", "Destroy"], emoji: "💰", sort_order: 40 },
  { id: "vanish-step", title: "消える足場", goal: "乗ると数秒後に消えて、また戻ってくる足場を作る", concepts: ["task.wait", "Transparency / CanCollide", "くり返し"], emoji: "🧱", sort_order: 50 },
  { id: "free", title: "自由制作", goal: "自分で考えたしかけを作る", concepts: [], emoji: "✨", sort_order: 100 },
];

export const teacher: Profile = { id: "t1", role: "teacher", display_name: "山田先生", teacher_id: null };
const mk = (sid: string, name: string): Profile => ({ id: sid, role: "student", display_name: name, teacher_id: "t1" });
export const students: Profile[] = [mk("s1", "田中"), mk("s2", "佐藤"), mk("s3", "鈴木"), mk("s4", "高橋"), mk("s5", "伊藤")];
export const me = students[0];

const sessions: LessonSession[] = [];
const messages: MessageRow[] = [];
const attempts: QuizAttempt[] = [];
const summaries: LessonSummaryRow[] = [];
const images = new Map<string, string>();

function session(student: string, lesson: string | null, startedMin: number, lastMin: number, extra: Partial<LessonSession> = {}) {
  const s: LessonSession = {
    id: id(), student_id: student, lesson_id: lesson, goal_note: null, status: "active", completed: null,
    help_requested_at: null, current_concept: null, current_problem: null,
    started_at: ago(startedMin), last_activity_at: ago(lastMin), ended_at: null, ...extra,
  };
  sessions.push(s);
  return s;
}
function msg(s: LessonSession, role: "student" | "tutor", text: string, min: number, extra: Partial<MessageRow> = {}) {
  const m: MessageRow = {
    id: id(), session_id: s.id, student_id: s.student_id, role, message: text, code: null, attachments: [],
    intent: role === "student" ? "ask" : null, hint_level: null, meta: {}, created_at: ago(min), ...extra,
  };
  messages.push(m);
  return m;
}
const tutorMeta = (concept: string, progress: TutorMeta["progress"], check: TutorMeta["check"] = null): TutorMeta => ({
  concept, problem: "", progress, check,
});

// 佐藤: strong hints, stuck twice → yellow
{
  const s = session("s2", "click-door", 40, 3);
  msg(s, "student", "ドアをクリックしても開かない", 30, { code: "local door = script.Parent\ndoor.Touched:Connect(function()\n\tdoor.Transparency = 1\nend)" });
  msg(s, "tutor", "ドアを「クリックしたとき」に動いてほしいんだよね。今のコードは、何が起きたときに動くようになっているかな？", 30, { hint_level: 1, meta: tutorMeta("イベント処理", "new_problem") });
  msg(s, "student", "わからない", 20, { intent: "more_hint" });
  msg(s, "tutor", "クリックを受け取るには **ClickDetector** という部品が必要だよ。", 20, { hint_level: 2, meta: tutorMeta("イベント処理", "still_stuck") });
  msg(s, "student", "入れたけどまだ動かない", 3);
  msg(s, "tutor", "おしい！ `MouseClick` というイベントを使うよ。\n```lua\ndetector.MouseClick:Connect(function()\n\t-- ここでドアを開ける\nend)\n```", 3, { hint_level: 3, meta: tutorMeta("イベント処理", "still_stuck") });
}
// 鈴木: help requested + wrong twice on a check → red
{
  const s = session("s3", "kill-brick", 45, 2, { help_requested_at: ago(1) });
  msg(s, "student", "Outputに赤いエラーが出た", 25);
  const t = msg(s, "tutor", "触ったものがキャラクターじゃないときのことを考えてみよう。", 25, {
    hint_level: 2,
    meta: tutorMeta("条件分岐", "still_stuck", {
      question: "FindFirstChild が nil を返すのはどんなとき？",
      choices: ["その名前の子どもがいないとき", "ゲームが止まったとき", "パーツが赤いとき"],
      answer_index: 0,
      explanation: "見つからなかったときは nil になるよ。",
    }),
  });
  for (const c of [1, 2]) {
    attempts.push({ id: id(), session_id: s.id, student_id: "s3", message_id: t.id, question: "", choice_index: c, is_correct: false, created_at: ago(10) });
  }
}
// 高橋: going well → green
{
  const s = session("s4", "speed-pad", 30, 1);
  msg(s, "student", "WalkSpeedを変えたら速くなった！", 1, { intent: "solved" });
  msg(s, "tutor", "すごい！自分で数字を変えて試せたね。", 1, { hint_level: 0, meta: tutorMeta("プロパティの変更", "solved") });
}
// 伊藤: ended today with summary
{
  const s = session("s5", "coin-collect", 90, 40, { status: "ended", ended_at: ago(30), completed: true });
  summaries.push(summary(s, "コインを集めるとスコアが増える仕組み"));
}
// 田中: two past lessons
{
  const s1 = session("s1", "kill-brick", 60 * 24 * 7 + 60, 60 * 24 * 7, { status: "ended", ended_at: ago(60 * 24 * 7), completed: true });
  summaries.push(summary(s1, "触れるとダメージを受ける床"));
  const s0 = session("s1", "free", 60 * 24 * 14 + 60, 60 * 24 * 14, { status: "ended", ended_at: ago(60 * 24 * 14), completed: false });
  summaries.push({ ...summary(s0, "光る看板"), struggled_with: [], metrics: { ...summary(s0, "").metrics, completed: false } });
}

function summary(s: LessonSession, made: string): LessonSummaryRow {
  return {
    id: id(), session_id: s.id, student_id: s.student_id, created_today: made,
    learned: ["「何かが起きたら処理を実行する」という、ゲームプログラミングの基本的な仕組みを学びました。"],
    struggled_with: ["ゲーム内で触れたものがプレイヤーなのか、それ以外の物体なのかを判断する部分で少し苦戦しました。"],
    how_student_solved_it: "AIのヒントを参考にコードを確認し、自分で原因を見つけて修正できました。",
    next_lesson: "条件を追加して、より複雑な仕組みに挑戦します。",
    parent_summary: "今日は、プレイヤーが触れると体力が減る床を作りました。うまく動かない場面でも、ヒントをもとに自分で原因を探し、最後には完成させることができました。",
    metrics: { minutes: 55, questions: 7, hints_used: 4, max_hint_level: 3, checks_total: 2, checks_correct_first_try: 1, checks_solved: 2, completed: true },
    model: "mock", created_at: s.ended_at ?? ago(0), updated_at: s.ended_at ?? ago(0),
  };
}

const REPLIES: Record<string, { text: string; concept: string }> = {
  ask: {
    text: "床にさわったときに動かすなら **Touched** というイベントを使うよ（＝何かが触れた瞬間に動く仕組み）。\n```lua\nlocal floor = script.Parent\n\nfloor.Touched:Connect(function(hit)\n\tlocal humanoid = hit.Parent:FindFirstChild(\"Humanoid\")\n\tif humanoid then\n\t\thumanoid.Health -= 20\n\tend\nend)\n```\nこの Script は床（Part）の中に入れてね。20 を変えると、ダメージの大きさが変わるよ。",
    concept: "イベント処理",
  },
  more_hint: { text: "もう少しくわしく説明するね。`hit` には「床に触れたもの」が入っているよ。キャラクターの足が触れたら、その親（`hit.Parent`）がキャラクター本体。だから `hit.Parent` の中に **Humanoid** があるか確かめてから体力をへらしているんだ。", concept: "イベント処理" },
  confused: { text: "言い方をかえるね。\n\nゲームは「何かが起きたら → これをする」というルールで動いているよ。床なら「さわられたら → 体力をへらす」。コードの `Touched` が「さわられたら」、`Health -= 20` が「体力をへらす」の部分だよ。", concept: "イベント処理" },
  solved: { text: "できたね！自分で動かせたのがすごい。次は、さわったときに床の色が変わるようにしてみる？", concept: "条件分岐" },
};

// Canned "AI" for the preview: a message that asks for a change while a project is open.
const looksLikeRequest = (q: string) => /(したい|にして|変えて|かえて|ほしい|追加|足して|やめて)/.test(q) && !/[?？]$/.test(q.trim());

// Studio trees the preview student used before.
const savedTrees: SavedTree[] = [
  {
    id: "tree-1",
    place: "キーボードタワー",
    tree: "Workspace (Workspace)\n  Lobby (Folder)\n    KeyField (Model)\n      Key (MeshPart) x638\n    SpawnLocation (SpawnLocation)\n  Tower (Folder)\nServerScriptService (ServerScriptService)\n  KeyScript (Script)\n  StageServer (Script)\nStarterPlayer (StarterPlayer)\n  StarterPlayerScripts (StarterPlayerScripts)\n    KeyboardEffect (LocalScript)",
    created_at: ago(60 * 24 * 2),
    last_used_at: ago(60 * 24 * 2),
  },
  {
    id: "tree-2",
    place: null,
    tree: "Workspace (Workspace)\n  Baseplate (Part)\n  LavaFloor (Part)\n  SpawnLocation (SpawnLocation)\nServerScriptService (ServerScriptService)",
    created_at: ago(60 * 24 * 7),
    last_used_at: ago(60 * 24 * 7),
  },
];

// Accounts the preview teacher (an admin) can manage.
const LOGIN_IDS: Record<string, string> = { t1: "yamada", t2: "sasaki", s1: "tanaka", s2: "sato", s3: "suzuki", s4: "takahashi", s5: "ito" };
const accounts: Omit<AccountRow, "is_self">[] = [
  { id: "t1", role: "teacher", display_name: "山田先生", login_id: LOGIN_IDS.t1, is_admin: true, teacher_name: null },
  { id: "t2", role: "teacher", display_name: "佐々木先生", login_id: LOGIN_IDS.t2, is_admin: false, teacher_name: null },
  ...students.map((st) => ({ id: st.id, role: "student" as const, display_name: st.display_name, login_id: LOGIN_IDS[st.id], is_admin: false, teacher_name: "山田先生" })),
];

export function createMockApi(): Api {
  seedTeacherProjectsOnce();
  const { projectsForSessions, ...projectMethods } = projectApi((sid) => sessions.find((x) => x.id === sid));
  return {
    ...projectMethods,
    async listLessons() { return [trial]; },
    async listAccounts() {
      await wait(300);
      return { accounts: accounts.map((a) => ({ ...a, is_self: a.id === teacher.id })), isAdmin: true };
    },
    async setPassword(userId, password) {
      await wait(400);
      if (password.length < PASSWORD_MIN) throw new Error(`パスワードは${PASSWORD_MIN}〜72文字にしてください。`);
      if (!accounts.some((a) => a.id === userId)) throw new Error("このアカウントは変えられません。");
    },
    async setAdmin(userId, isAdmin) {
      await wait(250);
      const a = accounts.find((x) => x.id === userId)!;
      if (!isAdmin && a.is_admin && accounts.filter((x) => x.is_admin).length <= 1) throw new Error("管理者が1人もいなくなるので外せません。");
      a.is_admin = isAdmin;
    },
    async listSavedTrees() {
      return [...savedTrees].sort((a, b) => b.last_used_at.localeCompare(a.last_used_at)).slice(0, 6);
    },
    async deleteSavedTree(treeId) {
      const i = savedTrees.findIndex((x) => x.id === treeId);
      if (i >= 0) savedTrees.splice(i, 1);
    },
    async saveTree(tree, place) {
      let t = savedTrees.find((x) => x.tree === tree);
      if (t) Object.assign(t, { last_used_at: ago(0), place: place ?? t.place });
      else savedTrees.push((t = { id: id(), place, tree, created_at: ago(0), last_used_at: ago(0) }));
      return { ...t };
    },
    async getActiveSession(studentId) {
      return sessions.find((s) => s.student_id === studentId && s.status === "active") ?? null;
    },
    async startSession(lessonId, goalNote) {
      await wait(300);
      return { ...session(me.id, lessonId, 0, 0, { goal_note: goalNote || null }) };
    },
    async listMessages(sessionId) { return messages.filter((m) => m.session_id === sessionId); },
    async listAttempts(ids) { return attempts.filter((a) => ids.includes(a.session_id)); },
    async uploadScreenshot(studentId, sessionId, image) {
      await wait(200);
      const path = `${studentId}/${sessionId}/${id()}.webp`;
      images.set(path, URL.createObjectURL(image));
      return path;
    },
    async signedUrls(paths) { return Object.fromEntries(paths.filter((p) => images.has(p)).map((p) => [p, images.get(p)!])); },
    async askTutor({ sessionId, context, intent, projectId }) {
      await wait(1200);
      const s = sessions.find((x) => x.id === sessionId)!;
      const prev = [...messages].reverse().find((m) => m.session_id === sessionId && m.role === "tutor");
      const request = intent === "ask" && projectId && looksLikeRequest(context.question) ? context.question.trim() : null;
      const r = request
        ? { text: `OK、「${request}」だね。作品を作り直すから、少し待ってね。`, concept: "作品の変更" }
        : REPLIES[intent];
      const studentMessage = msg(s, "student", context.question, 0, {
        code: context.code ?? null,
        attachments: (context.screenshots ?? []).map((path) => ({ bucket: "screenshots" as const, path })),
        intent,
      });
      const tutorMessage = msg(s, "tutor", r.text, 0, {
        meta: { ...tutorMeta(r.concept, intent === "solved" ? "solved" : prev ? "progressing" : "new_problem", null), project_request: request },
      });
      s.last_activity_at = ago(0);
      return { studentMessage, tutorMessage, projectRequest: request };
    },
    async submitCheck(messageId, choice) {
      await wait(250);
      const m = messages.find((x) => x.id === messageId)!;
      const ok = m.meta.check!.answer_index === choice;
      attempts.push({ id: id(), session_id: m.session_id, student_id: m.student_id, message_id: m.id, question: m.meta.check!.question, choice_index: choice, is_correct: ok, created_at: ago(0) });
      return { is_correct: ok, already_solved: false, attempts: attempts.filter((a) => a.message_id === messageId).length, explanation: ok ? m.meta.check!.explanation : null };
    },
    async setHelp(sessionId, on) {
      const s = sessions.find((x) => x.id === sessionId)!;
      s.help_requested_at = on ? ago(0) : null;
      return { ...s };
    },
    async setLesson(sessionId, lessonId) {
      const s = sessions.find((x) => x.id === sessionId)!;
      s.lesson_id = lessonId;
      return { ...s };
    },
    async endSession({ sessionId, completed }) {
      await wait(1500);
      const s = sessions.find((x) => x.id === sessionId)!;
      if (s.status === "active") Object.assign(s, { status: "ended", ended_at: ago(0), completed: completed ?? null, help_requested_at: null });
      const existing = summaries.find((x) => x.session_id === sessionId);
      if (existing) return { summary: existing };
      const sum = summary(s, lessons.find((l) => l.id === s.lesson_id)?.title ?? "自由制作");
      summaries.push(sum);
      return { summary: sum };
    },
    async getSummary(sessionId) { return summaries.find((x) => x.session_id === sessionId) ?? null; },
    async loadClassroom() {
      const latest = students.map((st) => sessions.filter((s) => s.student_id === st.id).sort((a, b) => b.started_at.localeCompare(a.started_at))[0])
        .filter((s): s is LessonSession => Boolean(s) && (s.status === "active" || Date.now() - Date.parse(s.started_at) < 86_400_000));
      const ids = latest.map((s) => s.id);
      return {
        students,
        sessions: latest.map((s) => ({ ...s })),
        messages: messages.filter((m) => ids.includes(m.session_id)),
        attempts: attempts.filter((a) => ids.includes(a.session_id)),
        summaryIds: new Set(summaries.map((s) => s.session_id)),
        lessons,
        projects: projectsForSessions(ids),
      };
    },
  };
}

let seeded = false;
function seedTeacherProjectsOnce() {
  if (seeded) return;
  seeded = true;
  seedTeacherProjects(sessions);
}
