// Turns a RobloxContext (+ conversation history) into Responses API input.
// This is the only place that knows how context fields are presented to the model, so
// v2 sources (Studio plugin / MCP) only need to fill RobloxContext — nothing here changes.
import type { MessageRow, RobloxContext, TutorIntent } from "../contracts.ts";
import type { ImageDetail } from "../env.ts";
import type { InputContentPart, InputMessage } from "../openai.ts";
import { formatScripts, withLessonGuide } from "../project/prompt.ts";
import { TUTOR_INSTRUCTIONS } from "./prompt.ts";

export type LessonInfo = { title: string; goal: string; concepts: string[]; ai_guide?: string | null } | null;

export type CheckResult = { messageId: string; attempts: number; solved: boolean };

export type TutorInputArgs = {
  context: RobloxContext;
  /** Earlier messages of this session, oldest first (not including the current turn). */
  history: MessageRow[];
  /** Results of understanding checks, keyed by tutor message. */
  checkResults: CheckResult[];
  intent: TutorIntent;
  lesson: LessonInfo;
  goalNote: string | null;
  /** The project the student is building now (its code is in context.currentScript). */
  project?: { title: string; stage: string; scripts?: { path: string; source: string }[] } | null;
  /** Screenshot images already resolved to data URLs (same order as context.screenshots). */
  images: string[];
  imageDetail: ImageDetail;
};

const HISTORY_CODE_CHARS = 4000;

const STAGE_LABEL: Record<string, string> = {
  plan: "作るものを決めている",
  build: "説明を読みながらコードを1行ずつ手で打ちこんでいる（穴埋め・自分で書く部分もある）",
  predict: "動かす前に予想している",
  run: "Studioで動かしている",
  explore: "テスト（「こうしたい！どう変える？」と、コードを少し書きかえる問題が3つ）",
  tweak: "いじる（数字を変えて試し、どうなったかを文で答える）",
  done: "完成した",
};

const INTENT_LABEL: Record<TutorIntent, string> = {
  ask: "質問を送った",
  more_hint: "「もっとくわしく」ボタンを押した",
  confused: "「🤔 よくわからない」ボタンを押した",
  solved: "「✅ できた！」ボタンを押した",
};

function fence(code: string, max?: number): string {
  const body = max && code.length > max ? `${code.slice(0, max)}\n-- （長いので省略）` : code;
  return "```lua\n" + body.replace(/```/g, "ˋˋˋ") + "\n```";
}

/** Renders every filled RobloxContext field as a labelled section. */
export function formatRobloxContext(ctx: RobloxContext, opts: { codeMax?: number; imagesAttached?: boolean } = {}): string {
  const parts: string[] = [];
  parts.push(`【生徒の質問】\n${ctx.question.trim() || "（質問文なし）"}`);
  if (ctx.code?.trim()) parts.push(`【生徒が貼ったコード】\n${fence(ctx.code, opts.codeMax)}`);
  if (ctx.currentScript?.source.trim()) {
    parts.push(
      `【Studioで開いているScript${ctx.currentScript.path ? `: ${ctx.currentScript.path}` : ""}】\n` +
        fence(ctx.currentScript.source, opts.codeMax),
    );
  }
  if (ctx.projectTree?.trim()) parts.push(`【Explorerの構成】\n${ctx.projectTree.trim()}`);
  if (ctx.errors?.length) parts.push(`【Outputのエラー】\n${ctx.errors.map((e) => `- ${e}`).join("\n")}`);
  const shots = ctx.screenshots?.length ?? 0;
  if (shots > 0) {
    parts.push(
      opts.imagesAttached
        ? `【Roblox Studioのスクリーンショット】${shots}枚（このメッセージに添付）`
        : `【Roblox Studioのスクリーンショット】${shots}枚（以前に送信）`,
    );
  }
  return parts.join("\n\n");
}

/** Rebuilds a RobloxContext from a stored student message (history only has v1.5 fields). */
function contextFromMessage(m: MessageRow): RobloxContext {
  return {
    question: m.message,
    code: m.code ?? undefined,
    screenshots: m.attachments?.map((a) => a.path) ?? [],
  };
}

function formatTutorHistory(m: MessageRow, results: Map<string, CheckResult>): string {
  let text = m.message;
  const check = m.meta?.check;
  if (check) {
    const r = results.get(m.id);
    const outcome = !r || r.attempts === 0
      ? "まだ答えていない"
      : r.solved
      ? `正解（${r.attempts}回目で）`
      : `${r.attempts}回まちがえて、まだ正解していない`;
    text += `\n\n[理解チェック] ${check.question} / 選択肢: ${check.choices.join(" | ")} / 結果: ${outcome}`;
  }
  return text;
}

function projectNote(project: TutorInputArgs["project"]): string {
  if (!project) return "生徒は今、作品を作っていない（project_request は null）。";
  if (project.stage === "done") {
    return `生徒の作品「${project.title}」は完成している（project_request は null。変えたいなら新しい作品を提案）。`;
  }
  return [
    `生徒は今、作品「${project.title}」を作っている（今のステップ: ${STAGE_LABEL[project.stage] ?? project.stage}）。`,
    "作品のコードは【Studioで開いているScript】にある。作品を変えたい・足したいと言われたら project_request に書く（システムが作品を自動で作り直す）。",
    project.scripts?.length ? `\n生徒が見せてくれた今のScript（コードはここに差し込む）:\n${formatScripts(project.scripts)}\n` : "",
    "ただし「【？】」の穴うめ・「ここは自分で書く部分」・テストの問題・いじるの答えは、生徒の学習記録になる関所なので、その答えだけはそのまま言わず、考え方を説明する。",
  ].join("");
}

export function buildTutorInput(args: TutorInputArgs): { instructions: string; input: InputMessage[] } {
  const results = new Map(args.checkResults.map((r) => [r.messageId, r]));
  const input: InputMessage[] = [];

  for (const m of args.history) {
    if (m.role === "student") {
      input.push({ role: "user", content: formatRobloxContext(contextFromMessage(m), { codeMax: HISTORY_CODE_CHARS }) });
    } else {
      input.push({ role: "assistant", content: formatTutorHistory(m, results) });
    }
  }

  const lessonLine = args.lesson
    ? `今日のレッスン: ${args.lesson.title}（目標: ${args.lesson.goal}${
      args.lesson.concepts.length ? ` / 学ぶこと: ${args.lesson.concepts.join("、")}` : ""
    }）`
    : "今日のレッスン: 指定なし";

  input.push({
    role: "developer",
    content: [
      "# このターンの条件（生徒には見えない）",
      lessonLine,
      args.goalNote ? `生徒が書いた「今日作るもの」: ${args.goalNote}` : "",
      projectNote(args.project),
      `生徒の操作: ${INTENT_LABEL[args.intent]}`,
    ].filter(Boolean).join("\n"),
  });

  const current: InputContentPart[] = [
    { type: "input_text", text: formatRobloxContext(args.context, { imagesAttached: args.images.length > 0 }) },
    ...args.images.map((url): InputContentPart => ({ type: "input_image", image_url: url, detail: args.imageDetail })),
  ];
  input.push({ role: "user", content: current });

  return { instructions: withLessonGuide(TUTOR_INSTRUCTIONS, args.lesson?.ai_guide), input };
}
