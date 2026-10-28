import { describe, expect, it } from "vitest";
import type { MessageRow, RobloxContext } from "../../supabase/functions/_shared/contracts.ts";
import { normalizeTutorOutput } from "../../supabase/functions/_shared/tutor/schema.ts";
import { buildTutorInput, formatRobloxContext } from "../../supabase/functions/_shared/tutor/buildInput.ts";
import { computeMetrics } from "../../supabase/functions/_shared/summary/metrics.ts";
import { formatSummaryInput } from "../../supabase/functions/_shared/summary/prompt.ts";

const row = (over: Partial<MessageRow>): MessageRow => ({
  id: crypto.randomUUID(),
  session_id: "s",
  student_id: "u",
  role: "student",
  message: "",
  code: null,
  attachments: [],
  intent: null,
  hint_level: null,
  meta: {},
  created_at: new Date().toISOString(),
  ...over,
});

describe("normalizeTutorOutput", () => {
  const base = { reply: "やってみよう", concept: "イベント", problem: "", progress: "progressing" as const, project_request: "ダメージを50にする" };
  it("passes a project change through only while a project can be changed", () => {
    expect(normalizeTutorOutput(base, true).project_request).toBe("ダメージを50にする");
    expect(normalizeTutorOutput(base, false).project_request).toBeNull();
    expect(normalizeTutorOutput({ ...base, project_request: "  " }, true).project_request).toBeNull();
  });
  it("never sends an empty reply", () => {
    expect(normalizeTutorOutput({ ...base, reply: " " }, false).reply).toContain("もう一度");
  });
});

describe("RobloxContext → model input", () => {
  it("renders only the fields that are present (v1.5)", () => {
    const text = formatRobloxContext({ question: "開かない", code: "print(1)" }, {});
    expect(text).toContain("【生徒の質問】");
    expect(text).toContain("```lua\nprint(1)\n```");
    expect(text).not.toContain("Explorer");
  });

  it("renders v2 fields without any tutor changes", () => {
    const ctx: RobloxContext = {
      question: "動かない",
      projectTree: "Workspace\n  Door\n    Script",
      currentScript: { path: "Workspace.Door.Script", source: "local d = script.Parent" },
      errors: ["attempt to index nil with 'Humanoid'"],
      source: "studio-plugin",
    };
    const text = formatRobloxContext(ctx);
    expect(text).toContain("【Explorerの構成】");
    expect(text).toContain("Workspace.Door.Script");
    expect(text).toContain("attempt to index nil");
  });

  it("puts images and the turn conditions in the current turn, history before it", () => {
    const history = [
      row({ role: "student", message: "最初の質問" }),
      row({
        id: "t1",
        role: "tutor",
        message: "考えてみよう",
        hint_level: 1,
        meta: { check: { question: "Q?", choices: ["a", "b"], answer_index: 0, explanation: "" } },
      }),
    ];
    const { input, instructions } = buildTutorInput({
      context: { question: "まだ動かない", screenshots: ["u/s/a.png"] },
      history,
      checkResults: [{ messageId: "t1", attempts: 2, solved: false }],
      intent: "more_hint",
      lesson: { title: "ドア", goal: "開く", concepts: [] },
      goalNote: null,
      images: ["data:image/png;base64,AAA"],
      imageDetail: "high",
    });
    expect(instructions).toContain("出し惜しみせず");
    expect(instructions).not.toContain("ヒントレベル");
    expect(input.map((m) => m.role)).toEqual(["user", "assistant", "developer", "user"]);
    expect(input[1].content).toContain("2回まちがえて");
    expect(input[2].content).toContain("「もっとくわしく」ボタン");
    expect(input[2].content).toContain("作品を作っていない");
    const current = input[3].content as Array<{ type: string }>;
    expect(current.map((p) => p.type)).toEqual(["input_text", "input_image"]);
  });
});

describe("computeMetrics", () => {
  it("counts measured values only from data", () => {
    const m = computeMetrics(
      { started_at: "2026-10-03T10:00:00Z", ended_at: "2026-10-03T10:50:00Z", completed: true },
      [
        { role: "student", hint_level: null },
        { role: "tutor", hint_level: 0 },
        { role: "student", hint_level: null },
        { role: "tutor", hint_level: 3 },
      ],
      [
        { message_id: "a", is_correct: false, created_at: "2026-10-03T10:10:00Z" },
        { message_id: "a", is_correct: true, created_at: "2026-10-03T10:11:00Z" },
        { message_id: "b", is_correct: true, created_at: "2026-10-03T10:20:00Z" },
      ],
    );
    expect(m).toEqual({
      minutes: 50,
      questions: 2,
      hints_used: 1,
      max_hint_level: 3,
      checks_total: 2,
      checks_correct_first_try: 1,
      checks_solved: 2,
      completed: true,
      projects_completed: 0,
      concepts_up: [],
    });
  });
});

describe("project notes for the tutor", () => {
  const args = {
    context: { question: "ダメージを50にしたい" },
    history: [],
    checkResults: [],
    intent: "ask" as const,
    lesson: null,
    goalNote: null,
    images: [],
    imageDetail: "high" as const,
  };
  it("lets AI先生 send changes for an open project, but keeps gate answers back", () => {
    const dev = buildTutorInput({ ...args, project: { title: "ダメージ床", stage: "explore" } }).input[0].content as string;
    expect(dev).toContain("project_request に書く");
    expect(dev).toContain("その答えだけはそのまま言わず");
  });
  it("does not change finished projects", () => {
    const dev = buildTutorInput({ ...args, project: { title: "ダメージ床", stage: "done" } }).input[0].content as string;
    expect(dev).toContain("完成している");
  });
});

describe("formatSummaryInput", () => {
  it("includes lesson, transcript and check outcomes", () => {
    const tutor = row({ id: "t", role: "tutor", message: "ヒント", hint_level: 2, meta: { check: { question: "Q", choices: ["a", "b"], answer_index: 0, explanation: "" } } });
    const text = formatSummaryInput({
      studentName: "田中",
      lesson: { title: "床", goal: "ダメージ" },
      goalNote: null,
      completed: true,
      messages: [row({ message: "質問" }), tutor],
      checks: new Map([["t", { attempts: 1, solved: true }]]),
    });
    expect(text).toContain("田中さん");
    expect(text).toContain("課題完了: できた");
    expect(text).toContain("正解（1回目）");
  });
});
