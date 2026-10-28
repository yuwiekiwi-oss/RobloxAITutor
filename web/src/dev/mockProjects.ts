// In-memory version of the project / mastery backend for the dev preview.
// Mirrors the database rules (answer_project_item, record_write_attempt, refresh_project_stage)
// and returns a canned 体験授業 project (the "たまに爆発するキー" snippet).
import { sameCode } from "../../../supabase/functions/_shared/codeMatch.ts";
import { decideModes, makeBlank } from "../../../supabase/functions/_shared/project/mastery.ts";
import type {
  BlockMode,
  CodeLine,
  ConceptEventRow,
  ConceptRow,
  GateResult,
  LessonSession,
  ProjectBlockRow,
  ProjectPlan,
  ProjectRow,
  ProjectStage,
  StudentConceptRow,
  StudentScript,
  WriteResult,
} from "../lib/types";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const nid = () => `mp-${++seq}`;
const now = () => new Date().toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export const concepts: ConceptRow[] = [
  ["script-placement", "Scriptの置き場所", "スクリプトをどこに入れるかで、動く・動かないが変わる", "きほん"],
  ["variable", "変数", "名前をつけて、ものや数字を覚えておく箱", "きほん"],
  ["property", "プロパティを変える", "色・透明度など、ものの「設定」を変える", "きほん"],
  ["position", "位置と動き", "Position・CFrameで、ものの場所や向きを変える", "きほん"],
  ["wait", "task.waitで待つ", "決めた秒数だけ待ってから次へ進む", "きほん"],
  ["if", "if文（条件）", "もし〜なら、こうする", "考え方"],
  ["nil-check", "あるか確かめる", "FindFirstChildなどで、ものが本当にあるかを確かめてから使う", "考え方"],
  ["touched", "Touchedイベント", "何かが触れた瞬間に動くしかけ", "イベント"],
  ["click", "クリックで動かす", "ClickDetectorで、クリックされた瞬間に動くしかけ", "イベント"],
  ["character", "キャラクターを見つける", "触ったものの親（hit.Parent）からキャラクターを見つける", "Roblox"],
  ["humanoid", "Humanoid", "キャラクターの体力や歩く速さを管理している部品", "Roblox"],
  ["instance-new", "ものを作る", "Instance.newで、ゲームの中に新しいものを作る", "Roblox"],
].map(([id, name, kid_hint, category], i) => ({ id, name, kid_hint, category, sort_order: i * 10 }));

const mastery = new Map<string, StudentConceptRow>();
const events: ConceptEventRow[] = [];
const projects: ProjectRow[] = [];
const blocks: ProjectBlockRow[] = [];
const keys = new Map<string, { answer_index: number | null; answer_text: string | null; explanation: string }>();
const attempts: { project_id: string; item: string; correct: boolean; assisted: boolean }[] = [];

function setLevel(student: string, concept: string, level: number) {
  mastery.set(`${student}:${concept}`, {
    student_id: student, concept_id: concept, level: level as 0 | 1 | 2 | 3, last_seen_at: now(), updated_at: now(),
  });
}
const levelOf = (student: string, concept: string) => mastery.get(`${student}:${concept}`)?.level ?? 0;

// The preview student has some history (teacher drawer shows it); the trial project is all new to them.
setLevel("s1", "touched", 1);
setLevel("s1", "humanoid", 2);
setLevel("s1", "variable", 3);
setLevel("s1", "property", 2); // → the 2nd block of the trial project is "write it yourself"
setLevel("s4", "touched", 3);
setLevel("s4", "if", 2);

function applyEvent(p: ProjectRow, b: ProjectBlockRow, kind: string) {
  for (const c of b.concepts) {
    const cur = levelOf(p.student_id, c);
    const nxt = kind === "explain_pass" ? Math.max(cur, 1)
      : kind === "blank_pass" ? Math.max(cur, 2)
      : kind === "write_pass" ? 3
      : kind === "blank_assisted" ? 1
      : kind === "write_assisted" ? Math.min(cur, 2)
      : cur;
    setLevel(p.student_id, c, nxt);
    events.push({
      id: nid(), student_id: p.student_id, concept_id: c, session_id: p.session_id, project_id: p.id, kind,
      level_before: cur, level_after: nxt, created_at: now(),
    });
  }
}

const resolved = (pid: string, item: string) => attempts.some((a) => a.project_id === pid && a.item === item && (a.correct || a.assisted));

function refresh(p: ProjectRow) {
  if (["plan", "done", "abandoned"].includes(p.stage)) return;
  const bl = blocks.filter((b) => b.project_id === p.id);
  const quizItems = [...keys.keys()].filter((k) => k.startsWith(`${p.id}:quiz:`)).map((k) => k.slice(p.id.length + 1));
  const next: ProjectStage = bl.some((b) => !b.build_done) ? "build"
    : keys.has(`${p.id}:predict`) && !resolved(p.id, "predict") ? "predict"
    : !p.ran_ok_at ? "run"
    : quizItems.length && quizItems.some((q) => !resolved(p.id, q)) ? "explore"
    : !quizItems.length && bl.some((b) => b.mode === "explain" && !b.explore_done) ? "explore"
    : keys.has(`${p.id}:tweak`) ? "tweak"
    : "done";
  if (next !== p.stage) Object.assign(p, { stage: next, stage_changed_at: now(), completed_at: next === "done" ? now() : p.completed_at });
}

const withBlocks = (p: ProjectRow) => ({
  project: { ...p },
  blocks: blocks.filter((b) => b.project_id === p.id).sort((a, b) => a.idx - b.idx).map((b) => ({ ...b })),
});

// ---------------------------------------------------------------- canned AI output (体験授業)
const L = (code: string, meaning: string, words: [string, string][] = []): CodeLine => ({
  code, meaning, words: words.map(([word, m]) => ({ word, meaning: m })),
});

const CANNED = {
  placement: {
    script_type: "Script" as const,
    parent_path: "ServerScriptService.KeyScript",
    steps: [
      "ServerScriptService の KeyScript を開く",
      "キーをふんだときの処理（key が出てくるところ）を見つける",
      "その中の、いちばん下の行のあとに下のコードを貼る",
      "▶ プレイを押して、キーを何回かふんでみる",
    ],
  },
  blocks: [
    {
      title: "たまに爆発を作る",
      purpose: "10回に1回だけ、ふんだキーの場所に爆発を作る",
      code: 'if math.random(1,10) == 1 then\n\tlocal boom = Instance.new("Explosion")\n\tboom.Position = key.Position',
      concepts: ["if", "instance-new", "position"],
      explanation: "サイコロをふって、1が出たときだけ爆発を作るよ。場所は、今ふんだキーと同じところ。",
      lines: [
        L("if math.random(1,10) == 1 then", "1〜10のサイコロをふって、1が出たら（10回に1回）、下を動かす", [
          ["math.random(1,10)", "1〜10のどれかをランダムに出す"],
          ["==", "同じなら"],
          ["then", "そうなら、ここから"],
        ]),
        L('\tlocal boom = Instance.new("Explosion")', "新しい爆発を1つ作って、boom という名前をつけておく（まだ出てこない）", [
          ["boom", "自分でつけた名前（なんでもいい）"],
          ["Instance.new", "新しく作る"],
          ["Explosion", "爆発"],
        ]),
        L("\tboom.Position = key.Position", "爆発の場所を、今ふんだキーと同じ場所にする", [
          ["Position", "場所"],
          ["key", "今ふんだキー（もとのScriptにある名前）"],
        ]),
      ],
      check: {
        question: "math.random(1,10) を math.random(1,2) にすると、どうなる？",
        choices: ["2回に1回くらい爆発する", "爆発しなくなる", "毎回2つ爆発する"],
        answer_index: 0,
        explanation: "サイコロが1〜2になるから、2回に1回くらい1が出るよ。",
      },
      blank: { target: '"Explosion"', prompt: "爆発を作るときに入れる名前はどれ？", choices: ['"Explosion"', '"Part"', '"Fire"'], answer_index: 0, explanation: "Explosion が爆発だよ。" },
    },
    {
      title: "爆発の強さを決めて出す",
      purpose: "爆発の広さと強さを決めて、ゲームの世界に出す",
      code: "\tboom.DestroyJointRadiusPercent = 0 -- これがないと たおれちゃう\n\tboom.BlastRadius = 20\n\tboom.BlastPressure = 500000\n\tboom.Parent = workspace\nend",
      concepts: ["property"],
      explanation: "爆発の広さと、ふっとばす強さを決めてから、ゲームの世界に入れるよ。入れた瞬間に爆発する！",
      lines: [
        L("\tboom.DestroyJointRadiusPercent = 0 -- これがないと たおれちゃう", "爆発しても、プレイヤーの体がバラバラにならないようにする", [
          ["DestroyJointRadiusPercent", "体をこわす強さ（0 でこわさない）"],
          ["--", "ここから右はメモ（ゲームは読まない）"],
        ]),
        L("\tboom.BlastRadius = 20", "爆発がとどく広さを 20 にする", [["BlastRadius", "爆発がとどく広さ"]]),
        L("\tboom.BlastPressure = 500000", "ふっとばす強さを 500000 にする（すごく強い！）", [["BlastPressure", "ふっとばす力"]]),
        L("\tboom.Parent = workspace", "boom をゲームの世界に入れる。ここで初めて爆発する！", [
          ["Parent", "入れる場所"],
          ["workspace", "ゲームの世界"],
        ]),
        L("end", "ここで「もし1が出たら」のおわり"),
      ],
      check: {
        question: "最後の boom.Parent = workspace を消すと、どうなる？",
        choices: ["爆発が出てこない", "もっと大きく爆発する", "毎回爆発する"],
        answer_index: 0,
        explanation: "ゲームの世界に入れないと、爆発は作っただけで出てこないよ。",
      },
      blank: { target: "workspace", prompt: "爆発をどこに入れると出てくる？", choices: ["workspace", "script", "key"], answer_index: 0, explanation: "workspace がゲームの世界だよ。" },
    },
  ],
  // コードのテスト: 「こうしたい！どう変える？」
  quiz: [
    {
      goal: "2回に1回、爆発するようにしたい！",
      code: "if math.random(1,10) == 1 then",
      answer: "if math.random(1,2) == 1 then",
      explanation: "サイコロを1〜2にすれば、2回に1回くらい1が出るよ。",
    },
    {
      goal: "爆発がとどく広さを、今の2倍にしたい！",
      code: "\tboom.BlastRadius = 20",
      answer: "\tboom.BlastRadius = 40",
      explanation: "BlastRadius がとどく広さ。20 の2倍は 40 だね。",
    },
    {
      goal: "ふっとばす力を弱くして、ちょっとだけ飛ばされるようにしたい！",
      code: "\tboom.BlastPressure = 500000",
      answer: "\tboom.BlastPressure = 50000",
      explanation: "BlastPressure がふっとばす力。数字を小さくすると弱くなるよ。",
    },
  ],
};

// ---------------------------------------------------------------- seeds for the teacher view
export function seedTeacherProjects(sessions: LessonSession[]) {
  const mk = (studentId: string, stage: ProjectStage, title: string, extra: Partial<ProjectRow> = {}) => {
    const s = sessions.find((x) => x.student_id === studentId && x.status === "active");
    if (!s) return;
    projects.push({
      id: nid(), session_id: s.id, student_id: studentId, idea: title, title, plan: { summary: "", parts: [] }, idea_images: [], explorer_tree: null,
      scripts: [], quiz: null,
      placement: CANNED.placement, predict: null, tweak: null, stage, assisted_count: 0, ran_ok_at: null, run_failed_at: null,
      stage_changed_at: ago(4), created_at: ago(20), completed_at: null, ...extra,
    });
  };
  mk("s2", "run", "クリックで開くドア", {
    run_failed_at: ago(12),
    assisted_count: 2,
    plan: { understanding: "Workspaceにある「Door」をクリックしたら、2秒だけすけて通れるようになる、ということだね？", summary: "", parts: [] },
    explorer_tree: "Workspace (Workspace)\n  Door (Part)",
  });
  mk("s4", "explore", "スピードアップ床", { stage_changed_at: ago(2) });
}

// ---------------------------------------------------------------- API surface
type RefineInput = {
  answers?: { question: string; answer: string }[];
  feedback?: string;
  tree?: string | null;
  script?: StudentScript;
  noScript?: boolean;
};

const PROB: Record<string, string> = { "3回に1回": "math.random(1,3)", "毎回": "math.random(1,1)" };

export function projectApi(getSession: (id: string) => LessonSession | undefined) {
  const own = (pid: string) => {
    const p = projects.find((x) => x.id === pid);
    if (!p) throw new Error("作品が見つかりません。");
    return p;
  };

  /** Canned "AI" plan: what it understood depends on the answers / the pasted script. */
  const cannedPlan = (prev: Partial<ProjectPlan>, scripts: StudentScript[], extra: Partial<ProjectPlan>): ProjectPlan => {
    const answers = extra.answers ?? prev.answers ?? [];
    const prob = answers.find((a) => a.question.includes("確率"))?.answer;
    const declined = Boolean(extra.script_declined ?? prev.script_declined);
    const feedback = extra.feedback ?? prev.feedback ?? [];
    return {
      understanding:
        `キーをふんだら、${prob && prob !== "おまかせ" ? prob : "ときどき"}そのキーが爆発して、プレイヤーがふっとぶ` +
        `${scripts.length ? `（${scripts[scripts.length - 1].path} の中に足す）` : ""}` +
        `${feedback.length ? `（${feedback[feedback.length - 1]}）` : ""}、ということだね？`,
      summary: "キーをふむと、たまに爆発するしかけだよ。",
      parts: ["サイコロをふる", "爆発を作る", "爆発の強さを決めて出す"],
      round: (prev.round ?? 0) + 1,
      questions: [],
      script_request: scripts.length || declined
        ? null
        : { name: "キーをふんだときに動いているScript（KeyScript など）", reason: "そのScriptの中に足すと、いちばんかんたんに作れるんだ。" },
      ...extra,
    };
  };

  const api = {
    async listConcepts() { return concepts; },
    async getMastery(studentId: string) { return [...mastery.values()].filter((m) => m.student_id === studentId); },
    async listConceptEvents({ projectId }: { projectId: string }) { return events.filter((e) => e.project_id === projectId); },
    async getOpenProject(studentId: string) {
      const p = projects.find((x) => x.student_id === studentId && !["done", "abandoned"].includes(x.stage));
      return p ? withBlocks(p) : null;
    },
    async getProject(projectId: string) { return withBlocks(own(projectId)); },

    async planProject(sessionId: string, idea: string, extras: { images?: string[]; tree?: string | null } = {}) {
      await wait(900);
      const s = getSession(sessionId)!;
      let p = projects.find((x) => x.student_id === s.student_id && x.stage === "plan");
      const plan = cannedPlan({}, [], {
        questions: [{ question: "どれくらいの確率で爆発させる？", choices: ["10回に1回", "3回に1回", "毎回"] }],
      });
      const fields = { idea, plan, idea_images: extras.images ?? [], explorer_tree: extras.tree ?? null, scripts: [], title: "たまに爆発するキー" };
      if (!p) {
        p = {
          id: nid(), session_id: s.id, student_id: s.student_id, placement: {}, predict: null, quiz: null,
          tweak: null, stage: "plan", assisted_count: 0, ran_ok_at: null, run_failed_at: null, stage_changed_at: now(),
          created_at: now(), completed_at: null, ...fields,
        };
        projects.push(p);
      } else Object.assign(p, fields);
      return withBlocks(p);
    },

    async refinePlan(projectId: string, input: RefineInput) {
      await wait(900);
      const p = own(projectId);
      const prev = p.plan as ProjectPlan;
      if (input.tree) p.explorer_tree = input.tree;
      if (input.script) p.scripts = [...p.scripts.filter((x) => x.path !== input.script!.path), input.script];
      p.plan = cannedPlan(prev, p.scripts, {
        answers: [...(prev.answers ?? []), ...(input.answers ?? [])],
        feedback: [...(prev.feedback ?? []), ...(input.feedback?.trim() ? [input.feedback.trim()] : [])],
        script_declined: prev.script_declined || input.noScript,
      });
      return withBlocks(p);
    },

    async buildProject(projectId: string) {
      await wait(1400);
      const p = own(projectId);
      const prob = (p.plan as ProjectPlan).answers?.find((a) => a.question.includes("確率"))?.answer ?? "";
      const canned = CANNED.blocks.map((b) => {
        if (!PROB[prob]) return b;
        const n = PROB[prob].match(/,(\d+)\)/)![1];
        const code = b.code.replace("math.random(1,10)", PROB[prob]);
        const meaning = (m: string) => m.replace("1〜10", `1〜${n}`).replace("10回に1回", n === "1" ? "毎回" : `${n}回に1回`);
        return { ...b, code, lines: b.lines.map((l) => ({ ...l, code: l.code.replace("math.random(1,10)", PROB[prob]), meaning: meaning(l.meaning) })) };
      });
      const prepared = canned.map((b) => ({ b, blankCode: makeBlank(b.code, b.blank) }));
      const levels = Object.fromEntries(concepts.map((c) => [c.id, levelOf(p.student_id, c.id)]));
      const modes: BlockMode[] = decideModes(prepared.map((x) => ({ concepts: x.b.concepts, hasValidBlank: x.blankCode !== null })), levels);
      prepared.forEach(({ b, blankCode }, idx) => {
        const mode = modes[idx];
        blocks.push({
          id: nid(), project_id: p.id, student_id: p.student_id, idx, title: b.title, purpose: b.purpose, concepts: b.concepts, mode,
          code: mode === "blank" ? blankCode : mode === "write" ? null : b.code,
          blank: mode === "blank" ? { prompt: b.blank.prompt, choices: b.blank.choices } : null,
          explanation: mode === "explain" ? b.explanation : null,
          check_q: mode === "explain" ? { question: b.check.question, choices: b.check.choices } : null,
          lines: mode === "explain" || mode === "given" ? b.lines : null,
          build_done: false, // everything except "write" is typed by hand
          explore_done: false,
        });
        if (mode === "blank") keys.set(`${p.id}:blank:${idx}`, { answer_index: b.blank.answer_index, answer_text: b.blank.target, explanation: b.blank.explanation });
        if (mode === "explain") keys.set(`${p.id}:check:${idx}`, { answer_index: b.check.answer_index, answer_text: null, explanation: b.check.explanation });
        if (mode === "write") keys.set(`${p.id}:write:${idx}`, { answer_index: null, answer_text: b.code, explanation: b.purpose });
      });
      // コードのテスト (answers stay in keys); no いじる step any more.
      const quiz = CANNED.quiz;
      quiz.forEach((q, i) => keys.set(`${p.id}:quiz:${i}`, { answer_index: null, answer_text: q.answer, explanation: q.explanation }));
      Object.assign(p, {
        placement: CANNED.placement,
        predict: null,
        tweak: null,
        quiz: quiz.map((q) => ({ goal: q.goal, code: q.code })),
        stage: "build",
        stage_changed_at: now(),
      });
      refresh(p);
      return withBlocks(p);
    },

    async answerGate(projectId: string, item: string, choice: number): Promise<GateResult> {
      await wait(250);
      const p = own(projectId);
      const k = keys.get(`${p.id}:${item}`)!;
      if (resolved(p.id, item)) return { correct: true, resolved: true, already: true, answer_index: k.answer_index, explanation: k.explanation };
      const kind = item.split(":")[0];
      const wrong = attempts.filter((a) => a.project_id === p.id && a.item === item && !a.correct).length;
      const ok = choice === k.answer_index;
      const assisted = !ok && wrong + 1 >= 2;
      attempts.push({ project_id: p.id, item, correct: ok, assisted });
      if (ok || assisted) {
        const b = blocks.find((x) => x.project_id === p.id && x.idx === Number(item.split(":")[1]));
        if (kind === "blank" && b) {
          b.code = (b.code ?? "").replace("【？】", k.answer_text ?? ""); // still has to be typed
          applyEvent(p, b, ok ? "blank_pass" : "blank_assisted");
        }
        if (kind === "check" && b) {
          b.explore_done = true;
          applyEvent(p, b, ok ? "explain_pass" : "explain_assisted");
        }
        const quizKeys = [...keys.keys()].filter((key) => key.startsWith(`${p.id}:quiz:`)).map((key) => key.slice(p.id.length + 1));
        if (kind === "quiz" && (item === "quiz" || quizKeys.every((q) => resolved(p.id, q)))) {
          const anyAssisted = attempts.some((a) => a.project_id === p.id && a.item.startsWith("quiz") && a.assisted);
          for (const x of blocks.filter((y) => y.project_id === p.id && y.mode === "explain" && !y.explore_done)) {
            x.explore_done = true;
            applyEvent(p, x, anyAssisted ? "explain_assisted" : "explain_pass");
          }
        }
        if (assisted) p.assisted_count++;
        refresh(p);
      }
      return {
        correct: ok, resolved: ok || assisted, assisted, attempts: wrong + 1,
        answer_index: ok || assisted ? k.answer_index : null, explanation: ok || assisted ? k.explanation : null,
      };
    },

    async submitWrite(projectId: string, idx: number, code: string): Promise<WriteResult> {
      await wait(900);
      const p = own(projectId);
      const b = blocks.find((x) => x.project_id === p.id && x.idx === idx)!;
      const item = `write:${idx}`;
      const fails = attempts.filter((a) => a.project_id === p.id && a.item === item && !a.correct).length;
      const answer = keys.get(`${p.id}:${item}`)!.answer_text ?? "";
      const passed = sameCode(code, answer); // the real AI also accepts other ways of writing it
      const reveal = !passed && fails + 1 >= 3;
      attempts.push({ project_id: p.id, item, correct: passed, assisted: reveal });
      if (passed) {
        b.code = code;
        b.build_done = true;
        applyEvent(p, b, "write_pass");
      } else if (reveal) {
        b.code = answer;
        b.build_done = true;
        applyEvent(p, b, "write_assisted");
        p.assisted_count++;
      }
      refresh(p);
      return {
        passed,
        revealed: reveal,
        feedback: passed
          ? "すごい！自分で書けたね。"
          : reveal
          ? "むずかしかったね。お手本を入れておいたから、どこがちがったか見くらべてみよう。"
          : "おしい！もう一度、何をしたいのかを思い出して書いてみよう。",
        block: { ...b },
      };
    },

    async markBlockTyped(projectId: string, idx: number) {
      await wait(150);
      const p = own(projectId);
      const b = blocks.find((x) => x.project_id === p.id && x.idx === idx)!;
      b.build_done = true;
      refresh(p);
      return { ...b };
    },

    async answerTweak() {
      // Older projects only; the preview no longer makes a いじる step.
      return { passed: true, revealed: false, feedback: "いいね！", expected: null };
    },

    // Mirrors the project function's quiz action + record_quiz_answer.
    async answerQuiz(projectId: string, idx: number, code: string) {
      await wait(700);
      const p = own(projectId);
      const item = `quiz:${idx}`;
      const k = keys.get(`${p.id}:${item}`)!;
      const original = (p.quiz as { code: string }[])[idx].code;
      const fails = attempts.filter((a) => a.project_id === p.id && a.item === item && !a.correct).length;
      const passed = sameCode(code, k.answer_text ?? "") || (idx === 0 && sameCode(code, "if math.random(1,2) == 2 then"));
      const unchanged = sameCode(code, original);
      const revealed = !passed && fails + 1 >= 2;
      attempts.push({ project_id: p.id, item, correct: passed, assisted: revealed });
      if (revealed) p.assisted_count++;
      const all = [...keys.keys()].filter((key) => key.startsWith(`${p.id}:quiz:`)).every((key) => resolved(p.id, key.slice(p.id.length + 1)));
      if ((passed || revealed) && all) {
        const anyAssisted = attempts.some((a) => a.project_id === p.id && a.item.startsWith("quiz") && a.assisted);
        for (const x of blocks.filter((y) => y.project_id === p.id && y.mode === "explain" && !y.explore_done)) {
          x.explore_done = true;
          applyEvent(p, x, anyAssisted ? "explain_assisted" : "explain_pass");
        }
      }
      refresh(p);
      return {
        passed,
        revealed,
        feedback: passed
          ? `正解！${k.explanation}`
          : revealed
          ? `むずかしかったね。お手本はこうだよ。${k.explanation}`
          : unchanged
          ? "まだ元のコードのままだよ。どこを変えればいいか、さがしてみよう。"
          : "おしい！数字や名前をよく見てみよう。",
        answer: passed || revealed ? k.answer_text : null,
      };
    },

    async reportRun(projectId: string, ok: boolean) {
      await wait(200);
      const p = own(projectId);
      if (ok) Object.assign(p, { ran_ok_at: now(), run_failed_at: null });
      else p.run_failed_at ??= now();
      refresh(p);
      return { ...p };
    },

    async finishProject(projectId: string) {
      const p = own(projectId);
      Object.assign(p, { stage: "done", completed_at: now(), stage_changed_at: now() });
      return { ...p };
    },

    async abandonProject(projectId: string) {
      const p = own(projectId);
      Object.assign(p, { stage: "abandoned", stage_changed_at: now() });
      return { ...p };
    },

    async resumeProject(projectId: string, sessionId: string) {
      const p = own(projectId);
      p.session_id = sessionId;
      return withBlocks(p);
    },

    async resetMastery(studentId: string) {
      let n = 0;
      for (const [k, m] of [...mastery]) {
        if (m.student_id !== studentId) continue;
        if (m.level > 0) {
          n++;
          events.push({ id: nid(), student_id: studentId, concept_id: m.concept_id, session_id: null, project_id: null, kind: "teacher_set", level_before: m.level, level_after: 0, created_at: now() });
        }
        mastery.delete(k);
      }
      return n;
    },

    async setConceptLevel(studentId: string, conceptId: string, level: number) {
      setLevel(studentId, conceptId, level);
      return mastery.get(`${studentId}:${conceptId}`)!;
    },

    // Mirrors the `project` function's revise: re-plan, and if code exists, clear it and build again.
    async reviseProject(projectId: string, request: string) {
      await wait(900);
      const p = own(projectId);
      const prev = p.plan as ProjectPlan;
      p.plan = cannedPlan(prev, p.scripts, { feedback: [...(prev.feedback ?? []), request], script_declined: true });
      if (p.stage === "plan") return withBlocks(p);

      for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].project_id === p.id) blocks.splice(i, 1);
      for (let i = attempts.length - 1; i >= 0; i--) if (attempts[i].project_id === p.id) attempts.splice(i, 1);
      for (const k of [...keys.keys()]) if (k.startsWith(`${p.id}:`)) keys.delete(k);
      Object.assign(p, { stage: "plan", ran_ok_at: null, run_failed_at: null, predict: null, tweak: null, quiz: null });
      await api.buildProject(p.id);
      // Canned "AI": a number in the request becomes the blast radius.
      const n = request.match(/\d+/)?.[0];
      if (n) {
        for (const b of blocks.filter((x) => x.project_id === p.id)) {
          if (b.code) b.code = b.code.replace("BlastRadius = 20", `BlastRadius = ${n}`);
          if (b.lines) b.lines = b.lines.map((l) => ({ ...l, code: l.code.replace("BlastRadius = 20", `BlastRadius = ${n}`), meaning: l.meaning.replace("20", n) }));
        }
      }
      return withBlocks(p);
    },

    projectsForSessions(sessionIds: string[]) {
      return projects.filter((p) => sessionIds.includes(p.session_id) && p.stage !== "abandoned").map((p) => ({ ...p }));
    },
  };
  return api;
}
