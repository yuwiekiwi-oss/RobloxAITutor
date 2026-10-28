// Instructions + Structured Output schemas for the project flow. Pure module.
import { sameCode } from "../codeMatch.ts";

const COMMON = `
あなたは「AI先生」。小中学生がRoblox Studio（Luau）でゲームを作る塾の先生です。
方針は「動くものが先、理解が後」。まず動く小さな作品を作り、そのあと仕組みを理解させます。
説明は小学5年生でも分かる日本語で、ゲームの中で何が起きるかと結びつけて話します。専門用語は一言で言いかえます。
今のRobloxで推奨される書き方（task.wait、FindFirstChildで確かめる等）を使います。チートや他人のゲームを荒らす内容は扱いません。
`.trim();

// ---------- plan ----------
export const PLAN_INSTRUCTIONS = `${COMMON}

# 仕事：作りたいものを、生徒の頭の中と同じ解像度で理解して「今日作れる大きさ」に整える
- 生徒の「作りたいもの」の文・参考画像（手書きの絵、参考にしたゲーム、Studioの画面など）・Explorerの構成をすべて読む。
- Explorerの構成があれば、そこにある実際の名前（パーツ名・フォルダ名）を使って話す。まだ無いものは「これから作る」とはっきり言う。
- 1回の授業（30〜60分）で動かせる小さな作品にまとめる。大きすぎる（例：RPGを作りたい）ときは、その中の「最初の一歩」になる小さなしかけを提案する。
- understanding は「こういうこと？」と生徒に確かめる文（1〜2文）。何に・どうしたら・どうなるか を、生徒の言葉と実際の名前で具体的に書く。
  例：「Workspaceにある『LavaFloor』にさわったら、1秒ごとに体力が10へる、ということだね？」
- title は作品名（短い名詞句）。summary はどんなしかけか（1〜2文）。parts は作る順番を2〜4個（それぞれ1文、やさしい言葉）。
- questions は、作る前に決めないとコードが変わるのに、まだ分からないことだけ（0〜3個）。
  - タップで答えられる2〜3択にする（例：「ダメージはどれくらい？」→「少しずつ」「一気に」「即アウト」）。「おまかせ」は選択肢に入れない（画面が自動で足す）。
  - 画像や構成から分かることは聞かない。分かっていれば questions は空にする。
- 生徒の回答（answers）や「ちがうところ」（feedback）が届いたら、それを必ず反映して作り直す。そのときは questions を空にする。
- 【今のコード】があるときは、作品はもう作り始めている。生徒の注文（feedback の最後）に合わせて作品を直す。注文に関係ないところは変えない。
- script_request：生徒がもう持っているScriptにコードを差し込むのがよさそうなのに、その中身がまだ渡されていないときだけ、
  どのScriptか（name：Explorerでの名前や場所。例「ServerScriptService の KeyScript」「キーをふんだときに動いているScript」）と、
  なぜ見たいか（reason：子どもの言葉で1文）を書く。中身が渡されている・「無い」と言われた・新しく作るほうがよいときは null。`;

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "understanding", "summary", "parts", "questions", "script_request"],
  properties: {
    script_request: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["name", "reason"],
          properties: { name: { type: "string" }, reason: { type: "string" } },
        },
        { type: "null" },
      ],
    },
    title: { type: "string" },
    understanding: { type: "string" },
    summary: { type: "string" },
    parts: { type: "array", items: { type: "string" } },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "choices"],
        properties: { question: { type: "string" }, choices: { type: "array", items: { type: "string" } } },
      },
    },
  },
} as const;

export type PlanOutput = {
  title: string;
  understanding: string;
  summary: string;
  parts: string[];
  questions: { question: string; choices: string[] }[];
  script_request: { name: string; reason: string } | null;
};

/** Lesson-specific rules (e.g. 体験授業) come last and win over the defaults. */
export function withLessonGuide(instructions: string, guide: string | null | undefined): string {
  return guide?.trim() ? `${instructions}\n\n# このレッスンの決まり（上の指示より優先する）\n${guide.trim()}` : instructions;
}

/** Scripts the student pasted, as model input. */
export function formatScripts(scripts: { path: string; source: string }[] | undefined): string {
  return (scripts ?? [])
    .map((s) => `【生徒の今のScript: ${s.path}】\n\`\`\`lua\n${s.source.replace(/```/g, "ˋˋˋ").slice(0, 12000)}\n\`\`\``)
    .join("\n\n");
}

/** Keeps only questions a child can answer by tapping: 2–3 short, distinct choices. */
export function cleanQuestions(qs: PlanOutput["questions"] | undefined): { question: string; choices: string[] }[] {
  return (qs ?? [])
    .map((q) => ({
      question: (q.question ?? "").trim().slice(0, 120),
      choices: [...new Set((q.choices ?? []).map((c) => (c ?? "").trim().slice(0, 40)).filter(Boolean))]
        .filter((c) => c !== "おまかせ")
        .slice(0, 3),
    }))
    .filter((q) => q.question && q.choices.length >= 2)
    .slice(0, 3);
}

export function formatPlanInput(args: {
  idea: string;
  tree?: string | null;
  imageCount?: number;
  previous?: { title?: string | null; understanding?: string; summary?: string; parts?: string[] } | null;
  /** Code already made (a change asked for in the chat after building). */
  currentCode?: string;
  answers?: { question: string; answer: string }[];
  feedback?: string[];
  scripts?: { path: string; source: string }[];
  /** The student said the script AI先生 asked for does not exist. */
  scriptDeclined?: boolean;
}): string {
  return [
    `【作りたいもの】${args.idea}`,
    formatScripts(args.scripts),
    args.scriptDeclined ? "【Scriptについて】生徒は「そのScriptは無い／わからない」と答えた（もう聞かない。新しく作るコードにする）" : "",
    args.imageCount ? `【参考画像】${args.imageCount}枚（このあとに付いている）` : "",
    args.tree?.trim() ? `【Explorerの構成（Studioから貼りつけ。「x数字」は同じ名前のものの数）】\n${args.tree.trim()}` : "",
    args.previous
      ? `【前に考えた案】${args.previous.title ?? ""}：${args.previous.understanding ?? args.previous.summary ?? ""}` +
        (args.previous.parts?.length ? `\n${args.previous.parts.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : "")
      : "",
    args.currentCode?.trim() ? `【今のコード】\n${args.currentCode.trim()}` : "",
    args.answers?.length ? `【生徒の回答】\n${args.answers.map((a) => `- ${a.question} → ${a.answer}`).join("\n")}` : "",
    args.feedback?.length ? `【生徒が「ちがう」と言ったところ（後のものほど新しい）】\n${args.feedback.map((f) => `- ${f}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

// ---------- build ----------
export const BUILD_INSTRUCTIONS = `${COMMON}

# 仕事：作品のコードを「まとまり（block）」に分けて作る
- 1つのScript（またはLocalScript）で動く、完成したコードを書く。全体で40行以内。
- 【生徒の今のScript】が渡されたときは、そのScriptに差し込むコードだけを書く（Script全体を書き直さない）。
  そこで使われている名前をそのまま使い、placement の steps で「どの行の下に貼るか」を具体的に書く。parent_path はそのScriptの場所にする。
- 意味のあるまとまり2〜5個に分ける（例：「さわったら」「キャラクターか確かめる」「ダメージを与える」）。1まとまり12行以内。短いコードなら1つでもよい。
- 各まとまりの code はそのまま上から順につなげると完成コードになるようにする（インデントも含めて）。
- concepts には、そのまとまりで使っている考え方を、指定されたIDの中から1〜3個選ぶ。
- explanation は、そのまとまりがゲームの中で何をしているかを2文以内で。
- lines は、そのまとまりの code を1行ずつ、英語を日本語に「翻訳」するように説明する（code の行と同じ順・同じ数。空行は入れない）。
  - code はその行そのまま。meaning はその行を日本語に訳した1文（だれが・何を・どうする、がはっきり分かるように）。
    例：local boom = Instance.new("Explosion") →「新しい爆発を1つ作って、boom という名前をつけておく（まだ出てこない）」
    例：boom.Parent = workspace →「boom をゲームの世界（workspace）に入れる。ここで初めて爆発する！」
    例：end →「ここで「もし〜なら」のおわり」
  - words は、その行に出てくる英語・名前・記号のうち、初めての子がつまずくものを0〜3個、word とその意味（短く）で。
    例：{word: "boom", meaning: "自分でつけた名前（なんでもいい）"}、{word: "Instance.new", meaning: "新しく作る"}、{word: "Explosion", meaning: "爆発"}、{word: "==", meaning: "同じなら"}
  - 前の行で説明した言葉はくり返さない。
- check は、explanation を読めば必ず答えられる3択の問題（知識テストにしない）。answer_index は正解の番号（0始まり）。explanation は正解の理由を1文。
- blank は、そのまとまりの一番大事な部分（イベント名、数字、条件など）を穴埋めにする案。
  target は code の中にちょうど1回だけ出てくる文字列そのもの。choices は3つで、choices[answer_index] は target と完全に同じ文字列。
  prompt は「どれを入れる？」など、何を考えればいいかが分かる短い問い。
- 生徒はコードをコピーせず、lines の説明を読みながら1行ずつ手で打ちこむ。だから lines の説明は、打ちながら意味が分かるように書く。
- quiz は「コードのテスト」をちょうど3問。この作品のコードを少しだけ変えて、ゲームの動きを変える問題にする。
  - goal は生徒がやりたいこと（子どもの言葉で1文。例：「2回に1回、爆発するようにしたい！」「爆発をもっと大きくしたい！」）。
  - code はこの作品のコードからそのまま抜き出した1〜4行（インデントもそのまま）。answer は goal をかなえるように code を変えたもの（同じ行数・同じ形）。
  - 変えるのは数字・名前・true/false・1語くらいの小さな変更にする。lines の説明を読んだ子なら分かる問題にする。3問とも別の行・別の考え方にする。
  - explanation は「なぜその変え方で goal がかなうか」を1文で。
- placement には、Explorerのどこに何を置くか（parent_path 例: Workspace.ダメージ床）と、Studioでの準備手順 steps（3〜6個、やさしい言葉）。
- Explorerの構成が渡されたら、そこにある実際の名前をそのまま使う（parent_path、FindFirstChild や WaitForChild の名前）。すでにあるものは「作る」手順に入れない。
- 「こういうこと？」で生徒が確認した内容と回答に合わせる（数字・動き方・対象）。
- 【前のコード】があるときは、生徒の注文で作り直している。注文に関係ない部分は前のコードをなるべくそのまま使い、注文の部分だけ変える。
- 生徒の習熟度が書かれている。「自分で書ける」考え方は短く、「初見」の考え方はていねいに説明する。`;

export function buildSchema(conceptIds: string[]) {
  const choice = {
    type: "object",
    additionalProperties: false,
    required: ["question", "choices", "answer_index", "explanation"],
    properties: {
      question: { type: "string" },
      choices: { type: "array", items: { type: "string" } },
      answer_index: { type: "integer" },
      explanation: { type: "string" },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "placement", "blocks", "quiz"],
    properties: {
      title: { type: "string" },
      placement: {
        type: "object",
        additionalProperties: false,
        required: ["script_type", "parent_path", "steps"],
        properties: {
          script_type: { type: "string", enum: ["Script", "LocalScript"] },
          parent_path: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
        },
      },
      blocks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "purpose", "code", "concepts", "explanation", "lines", "check", "blank"],
          properties: {
            title: { type: "string" },
            purpose: { type: "string" },
            code: { type: "string" },
            concepts: { type: "array", items: { type: "string", enum: conceptIds } },
            explanation: { type: "string" },
            lines: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["code", "meaning", "words"],
                properties: {
                  code: { type: "string" },
                  meaning: { type: "string" },
                  words: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["word", "meaning"],
                      properties: { word: { type: "string" }, meaning: { type: "string" } },
                    },
                  },
                },
              },
            },
            check: choice,
            blank: {
              type: "object",
              additionalProperties: false,
              required: ["target", "prompt", "choices", "answer_index", "explanation"],
              properties: {
                target: { type: "string" },
                prompt: { type: "string" },
                choices: { type: "array", items: { type: "string" } },
                answer_index: { type: "integer" },
                explanation: { type: "string" },
              },
            },
          },
        },
      },
      quiz: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["goal", "code", "answer", "explanation"],
          properties: {
            goal: { type: "string" },
            code: { type: "string" },
            answer: { type: "string" },
            explanation: { type: "string" },
          },
        },
      },
    },
  } as const;
}

export type CodeQuizOut = { goal: string; code: string; answer: string; explanation: string };

/** The code test: up to 3 questions whose answer really changes the code. */
export function pickCodeQuiz(quiz: CodeQuizOut[] | undefined): CodeQuizOut[] {
  return (quiz ?? [])
    .filter((q) => q && q.goal?.trim() && q.code?.trim() && q.answer?.trim() && !sameCode(q.code, q.answer))
    .map((q) => ({
      goal: q.goal.trim().slice(0, 160),
      code: q.code.replace(/\s+$/, "").slice(0, 1200),
      answer: q.answer.replace(/\s+$/, "").slice(0, 1200),
      explanation: (q.explanation ?? "").trim().slice(0, 240),
    }))
    .slice(0, 3);
}

// ---------- quiz (grade a code answer of テスト) ----------
export const QUIZ_INSTRUCTIONS = `${COMMON}

# 仕事：「コードのテスト」の答えを判定する
- 生徒は「やりたいこと」をかなえるために、元のコードを書きかえた。
- 生徒のコードが「やりたいこと」をかなえていて、Luauとして動くなら passed=true。お手本とちがう書き方でも、同じようにかなうならOK
  （例：math.random(1,2) == 1 でも == 2 でも「2回に1回」）。スペース・字下げ・コメントは気にしない。
- 変わっていない、やりたいことと逆、動かない書き方なら passed=false。
- feedback は生徒への短い言葉（2文以内）。合格ならほめて、なぜそれでかなうかを一言。不合格なら答えを言わずに、どの行・どの言葉を見ればいいかのヒントを1つ。`;

// ---------- tweak (grade the written answer of いじる) ----------
export const TWEAK_INSTRUCTIONS = `${COMMON}

# 仕事：「いじる」ミッションの記述式の答えを判定する
- 生徒は、コードの一部を変えてStudioで試し、どうなったかを自分の言葉で書いた。
- 「期待する答え」と同じこと（何がどう変わったか）が書けていれば passed=true。言葉づかい・ひらがな・短さは気にしない。
- 関係ないこと・逆のこと・「わからない」だけなら passed=false。
- feedback は生徒への短い言葉（2文以内）。合格ならほめて、なぜそうなるかを一言。不合格なら答えを言わずに、Studioでどこを見ればいいかのヒントを1つ。`;

export const TWEAK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["passed", "feedback"],
  properties: { passed: { type: "boolean" }, feedback: { type: "string" } },
} as const;

export type CodeLineOut = { code: string; meaning: string; words: { word: string; meaning: string }[] };

/** Keeps the translation usable: one entry per non-empty code line, short texts, at most 3 words a line. */
export function cleanLines(lines: CodeLineOut[] | undefined, code: string): CodeLineOut[] | null {
  const codeLines = code.split("\n").filter((l) => l.trim());
  const out = (lines ?? [])
    .filter((l) => l && typeof l.code === "string" && l.code.trim() && typeof l.meaning === "string" && l.meaning.trim())
    .slice(0, 20)
    .map((l) => ({
      code: l.code.replace(/\s+$/, ""),
      meaning: l.meaning.trim().slice(0, 160),
      words: (l.words ?? [])
        .filter((w) => w && typeof w.word === "string" && w.word.trim() && typeof w.meaning === "string" && w.meaning.trim())
        .slice(0, 3)
        .map((w) => ({ word: w.word.trim().slice(0, 40), meaning: w.meaning.trim().slice(0, 60) })),
    }));
  // Use the real code text when the model kept the line order (it sometimes re-indents).
  if (out.length === codeLines.length) out.forEach((l, i) => (l.code = codeLines[i]));
  return out.length ? out : null;
}

/** Lines of code that count toward a lesson's max_lines (blank lines and comment-only lines do not). */
export function countCodeLines(code: string): number {
  return code.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).length;
}

export type Choice = { question: string; choices: string[]; answer_index: number; explanation: string };
export type BuildBlock = {
  title: string;
  purpose: string;
  code: string;
  concepts: string[];
  explanation: string;
  lines: CodeLineOut[];
  check: Choice;
  blank: { target: string; prompt: string; choices: string[]; answer_index: number; explanation: string };
};
export type BuildOutput = {
  title: string;
  placement: { script_type: "Script" | "LocalScript"; parent_path: string; steps: string[] };
  blocks: BuildBlock[];
  quiz: CodeQuizOut[];
};

export function formatBuildInput(args: {
  idea: string;
  plan: {
    title?: string | null;
    understanding?: string;
    summary?: string;
    parts?: string[];
    answers?: { question: string; answer: string }[];
    feedback?: string[];
  };
  tree?: string | null;
  imageCount?: number;
  /** Code before a revision asked for in the chat. */
  previousCode?: string;
  scripts?: { path: string; source: string }[];
  concepts: { id: string; name: string; level: number }[];
}): string {
  const levelName = ["初見", "一度習った", "思い出せる", "自分で書ける"];
  return [
    `【生徒が作りたいもの】${args.idea}`,
    `【作品】${args.plan.title ?? ""}：${args.plan.summary ?? ""}`,
    args.plan.understanding ? `【生徒と確認した内容（こういうこと？→そう！）】${args.plan.understanding}` : "",
    args.plan.answers?.length ? `【生徒の回答】\n${args.plan.answers.map((a) => `- ${a.question} → ${a.answer}`).join("\n")}` : "",
    args.plan.feedback?.length ? `【生徒の注文】\n${args.plan.feedback.map((f) => `- ${f}`).join("\n")}` : "",
    args.imageCount ? `【参考画像】${args.imageCount}枚（このあとに付いている）` : "",
    formatScripts(args.scripts),
    args.tree?.trim() ? `【Explorerの構成（今のStudio）】\n${args.tree.trim()}` : "",
    args.previousCode?.trim() ? `【前のコード（注文に関係ない部分はそのまま使う）】\n${args.previousCode.trim()}` : "",
    args.plan.parts?.length ? `【作る順番】\n${args.plan.parts.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : "",
    "【使ってよい考え方のIDと、この生徒の習熟度】",
    ...args.concepts.map((c) => `- ${c.id}（${c.name}）: ${levelName[c.level] ?? "初見"}`),
  ].filter(Boolean).join("\n");
}

/** A choice question is usable if it has 2–4 non-empty choices and a valid answer index. */
export function validChoice(c: { question?: string; choices?: string[]; answer_index?: number } | null | undefined): boolean {
  return Boolean(
    c && c.question?.trim() && Array.isArray(c.choices) && c.choices.length >= 2 && c.choices.length <= 4 &&
      c.choices.every((x) => typeof x === "string" && x.trim()) && Number.isInteger(c.answer_index) &&
      (c.answer_index as number) >= 0 && (c.answer_index as number) < c.choices.length,
  );
}

// ---------- write (grade a block the student wrote) ----------
export const WRITE_INSTRUCTIONS = `${COMMON}

# 仕事：生徒が自分で書いたまとまりを判定する
- 「このまとまりでやりたいこと」と「お手本」をもとに、生徒のコードが同じ働きをするかを判定する。
- 書き方がお手本と違っても、同じように動くなら passed=true。変数名・スペース・書く順番の小さな違いは気にしない。
- 動かない・やりたいことができていない場合は passed=false。
- feedback は生徒への短い言葉（2文以内）。合格ならほめる。不合格なら、答えを言わずに「どこを見ればいいか」のヒントを1つ。`;

export const WRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["passed", "feedback"],
  properties: { passed: { type: "boolean" }, feedback: { type: "string" } },
} as const;

export type WriteOutput = { passed: boolean; feedback: string };
