import { describe, expect, it } from "vitest";
import { mergeContexts } from "../src/context/RobloxContextSource";
import { manualContextSource } from "../src/context/manualContextSource";
import { computeStatus, stuckStreak } from "../src/features/teacher/statusRules";
import { tokenizeLuau } from "../src/lib/luau";
import type { LessonSession, MessageRow, QuizAttempt } from "../src/lib/types";

const now = Date.parse("2026-10-03T11:00:00Z");
const minAgo = (m: number) => new Date(now - m * 60_000).toISOString();

const session = (over: Partial<LessonSession> = {}): LessonSession => ({
  id: "s",
  student_id: "u",
  lesson_id: null,
  goal_note: null,
  status: "active",
  completed: null,
  help_requested_at: null,
  current_concept: null,
  current_problem: null,
  started_at: minAgo(30),
  last_activity_at: minAgo(1),
  ended_at: null,
  ...over,
});

const tutor = (progress: NonNullable<MessageRow["meta"]["progress"]>, hint = 1): MessageRow => ({
  id: crypto.randomUUID(),
  session_id: "s",
  student_id: "u",
  role: "tutor",
  message: "",
  code: null,
  attachments: [],
  intent: null,
  hint_level: hint,
  meta: { progress },
  created_at: minAgo(1),
});

const attempt = (messageId: string, ok: boolean): QuizAttempt => ({
  id: crypto.randomUUID(),
  session_id: "s",
  student_id: "u",
  message_id: messageId,
  question: "",
  choice_index: 0,
  is_correct: ok,
  created_at: minAgo(1),
});

describe("statusRules", () => {
  it("is green when nothing is wrong", () => {
    expect(computeStatus(session(), [tutor("progressing")], [], now).level).toBe("green");
  });
  it("is idle without an active session", () => {
    expect(computeStatus(null, [], [], now).level).toBe("idle");
    expect(computeStatus(session({ status: "ended" }), [], [], now).level).toBe("idle");
  });
  it("is red when the student calls the teacher", () => {
    const s = computeStatus(session({ help_requested_at: minAgo(0) }), [], [], now);
    expect(s.level).toBe("red");
    expect(s.reasons[0]).toContain("先生を呼んで");
  });
  it("is red after 3 stuck turns on the same problem, yellow after 2", () => {
    const two = [tutor("new_problem"), tutor("still_stuck"), tutor("still_stuck")];
    expect(stuckStreak(two)).toBe(2);
    expect(computeStatus(session(), two, [], now).level).toBe("yellow");
    expect(computeStatus(session(), [...two, tutor("still_stuck")], [], now).level).toBe("red");
  });
  it("is red after two wrong answers on the same check, but not once solved", () => {
    expect(computeStatus(session(), [], [attempt("c", false), attempt("c", false)], now).level).toBe("red");
    expect(computeStatus(session(), [], [attempt("c", false), attempt("c", false), attempt("c", true)], now).level).toBe("green");
  });
  it("flags strong hints and inactivity", () => {
    expect(computeStatus(session(), [tutor("progressing", 3)], [], now).level).toBe("yellow");
    expect(computeStatus(session({ last_activity_at: minAgo(9) }), [], [], now).level).toBe("yellow");
    expect(computeStatus(session({ last_activity_at: minAgo(25) }), [], [], now).level).toBe("red");
  });
});

describe("RobloxContext sources", () => {
  it("manual source maps the composer into a RobloxContext", async () => {
    const ctx = await manualContextSource.collect({ question: " 開かない ", code: "print(1)\n\n", screenshotPaths: ["a"] });
    expect(ctx).toEqual({ question: "開かない", code: "print(1)", screenshots: ["a"], source: "manual" });
  });
  it("mergeContexts combines manual input with (future) Studio data", () => {
    const merged = mergeContexts(
      { question: "動かない", source: "manual" },
      { question: "", errors: ["boom"], projectTree: "Workspace", source: "studio-plugin" },
    );
    expect(merged).toEqual({ question: "動かない", errors: ["boom"], projectTree: "Workspace", source: "manual" });
  });
});

describe("tokenizeLuau", () => {
  it("highlights keywords, strings, numbers, comments and calls", () => {
    const tokens = tokenizeLuau('local hum = hit.Parent:FindFirstChild("Humanoid") -- check\nif hum then hum.Health = 0 end');
    const of = (type: string) => tokens.filter((t) => t.type === type).map((t) => t.text);
    expect(of("keyword")).toEqual(["local", "if", "then", "end"]);
    expect(of("string")).toEqual(['"Humanoid"']);
    expect(of("comment")).toEqual(["-- check"]);
    expect(of("number")).toEqual(["0"]);
    expect(of("func")).toEqual(["FindFirstChild"]);
    expect(tokens.map((t) => t.text).join("")).toContain("hit.Parent:FindFirstChild");
  });
  it("round-trips the source exactly", () => {
    const src = "--[[ long\ncomment ]] local s = [[multi\nline]] print('x', 0x1F)";
    expect(tokenizeLuau(src).map((t) => t.text).join("")).toBe(src);
  });
});
