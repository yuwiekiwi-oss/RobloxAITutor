// Parent-facing lesson summary: instructions, schema and input formatting. Pure module.
import type { MessageRow } from "../contracts.ts";

export type SummaryModelOutput = {
  created_today: string;
  learned: string[];
  struggled_with: string[];
  how_student_solved_it: string;
  next_lesson: string;
  parent_summary: string;
};

export const SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["created_today", "learned", "struggled_with", "how_student_solved_it", "next_lesson", "parent_summary"],
  properties: {
    created_today: { type: "string", description: "今日作ったもの（短く。例：触れるとダメージを受ける床）" },
    learned: { type: "array", items: { type: "string" }, description: "今日学んだこと（1〜3個）" },
    struggled_with: { type: "array", items: { type: "string" }, description: "苦戦したところ（0〜2個）" },
    how_student_solved_it: { type: "string", description: "どう解決したか" },
    next_lesson: { type: "string", description: "次回の内容の提案" },
    parent_summary: { type: "string", description: "保護者への短いまとめ（2〜4文）" },
  },
} as const;

export const SUMMARY_INSTRUCTIONS = `
あなたはRobloxプログラミング塾の講師アシスタントです。授業の記録（作品づくりの記録：説明を読みながらコードを打ちこんだこと・自分で書いた部分・コードのテストの結果、生徒とAI先生の会話）から、保護者向けの「今日の授業のまとめ」を書きます。

# 書き方
- 読む人はプログラミングを知らない保護者。です・ます調の、あたたかく落ち着いた日本語。
- 技術用語はそのまま書かない。必要なら意味に言いかえる。
  例：「Touchedイベント」→「何かが触れたときに処理を動かす仕組み」、「if文」→「条件によって動きを変える仕組み」、「Humanoid」→「キャラクターの体力などを管理する部分」。
- コード・関数名・エラーメッセージは書かない。
- 具体的に書く（「がんばりました」だけで終わらせず、何に取り組み、どう進んだか）。

# 絶対に守ること
- 記録にあることだけを書く。記録にない作品・成果・やりとりを作らない。
- 「理解度87%」「Aランク」のような点数・割合・評価を作らない。数字の記録は別の欄に実測値として表示されるので、文章では数字を使わなくてよい。
- 課題が終わっていない／解決していないときは、正直にやわらかく書く（「次回に続きを進めます」など）。
- 苦戦したところは、責める書き方をせず「どこで考えたか」として書く。苦戦がなければ struggled_with は空配列。
- AI先生との会話が少なくても、作品づくりの記録があれば、それをもとに何を作り、どこを自分でできたかを書く。
- 記録が少ない場合は、分かる範囲だけを短く書く。

# 各項目
- created_today: 今日作った（作ろうとした）もの。短い名詞句。
- learned: 学んだ考え方を1〜3個。1つ1文。
- struggled_with: 0〜2個。1つ1文。
- how_student_solved_it: AI先生への質問や作品への注文をどう使い、どこを自分で考えて直したか。未解決なら今どこまで来ているか。
- next_lesson: 次回挑戦するとよいこと（1文）。
- parent_summary: 全体を2〜4文で。
`.trim();

const CODE_MAX = 3000;
const TRANSCRIPT_MAX = 60_000;

export type SummaryInputArgs = {
  studentName: string;
  lesson: { title: string; goal: string } | null;
  goalNote: string | null;
  completed: boolean | null;
  messages: MessageRow[];
  /** Check results keyed by tutor message id. */
  checks: Map<string, { attempts: number; solved: boolean }>;
  /** Projects worked on in this session. */
  projects?: { title: string; done: boolean }[];
  /** Concepts whose recorded mastery went up (measured). */
  conceptsUp?: { name: string; level: number }[];
  /** What the student did in the project steps (typing, writing, code test), already as sentences. */
  projectWork?: string[];
};

const LEVEL_NAME = ["初見", "一度習った", "思い出せる", "自分で書ける"];

export function formatSummaryInput(a: SummaryInputArgs): string {
  const lines: string[] = [];
  lines.push(`生徒: ${a.studentName}さん`);
  lines.push(a.lesson ? `レッスン: ${a.lesson.title}（目標: ${a.lesson.goal}）` : "レッスン: 自由制作");
  if (a.goalNote) lines.push(`生徒が書いた今日作るもの: ${a.goalNote}`);
  lines.push(`課題完了: ${a.completed === true ? "できた" : a.completed === false ? "まだ" : "記録なし"}`);
  if (a.projects?.length) {
    lines.push(`作った作品: ${a.projects.map((p) => `${p.title}（${p.done ? "完成" : "とちゅう"}）`).join("、")}`);
  }
  if (a.conceptsUp?.length) {
    lines.push(`記録で上がった理解（実測）: ${a.conceptsUp.map((c) => `${c.name}→${LEVEL_NAME[c.level]}`).join("、")}`);
  }
  if (a.projectWork?.length) {
    lines.push(`作品づくりでやったこと（記録）:\n${a.projectWork.map((w) => `- ${w}`).join("\n")}`);
  }
  const header = lines.join("\n");
  lines.length = 0;

  for (const m of a.messages) {
    if (m.role === "student") {
      let t = `[生徒] ${m.message || "（質問文なし）"}`;
      if (m.code) t += `\n（貼ったコード）\n${m.code.slice(0, CODE_MAX)}`;
      if (m.attachments?.length) t += `\n（Studioのスクリーンショット${m.attachments.length}枚）`;
      lines.push(t);
    } else {
      let t = m.hint_level === null ? `[AI先生] ${m.message}` : `[AI先生・ヒントレベル${m.hint_level}] ${m.message}`;
      if (m.meta?.project_request) t += `\n（作品への注文として受け付け: ${m.meta.project_request}）`;
      if (m.meta?.concept) t += `\n（扱った考え方: ${m.meta.concept}）`;
      const check = m.meta?.check;
      if (check) {
        const r = a.checks.get(m.id);
        const outcome = !r ? "未回答" : r.solved ? `正解（${r.attempts}回目）` : `不正解のまま（${r.attempts}回）`;
        t += `\n（理解チェック: ${check.question} → ${outcome}）`;
      }
      lines.push(t);
    }
  }

  // Keep the end of very long lessons: that is where the outcome is.
  let transcript = lines.join("\n\n");
  if (transcript.length > TRANSCRIPT_MAX) transcript = "（前半は省略）\n\n" + transcript.slice(-TRANSCRIPT_MAX);
  return `${header}\n\n# 授業の記録（古い順）\n\n${transcript}`;
}
