import { describe, expect, it } from "vitest";
import { decideModes, effectiveLevel, makeBlank } from "../../supabase/functions/_shared/project/mastery.ts";
import { validChoice } from "../../supabase/functions/_shared/project/prompt.ts";
import { conceptsUp } from "../../supabase/functions/_shared/summary/metrics.ts";
import { computeStatus } from "../src/features/teacher/statusRules";
import type { LessonSession, ProjectRow } from "../src/lib/types";

describe("decideModes: 初めては解説、2回目は穴うめ、思い出せたら自分で書く", () => {
  const b = (concepts: string[], hasValidBlank = true) => ({ concepts, hasValidBlank });

  it("maps mastery levels to modes", () => {
    const levels = { touched: 1, humanoid: 2, variable: 3 };
    expect(decideModes([b(["character"]), b(["touched"]), b(["humanoid"]), b(["variable"])], levels))
      .toEqual(["explain", "blank", "write", "given"]);
  });

  it("uses the weakest concept of a block", () => {
    expect(decideModes([b(["variable", "touched"])], { variable: 3, touched: 1 })).toEqual(["blank"]);
    expect(decideModes([b(["variable", "if"])], { variable: 3 })).toEqual(["explain"]);
  });

  it("falls back to explain when the blank candidate is unusable", () => {
    expect(decideModes([b(["touched"], false)], { touched: 1 })).toEqual(["explain"]);
  });

  it("explains blocks without tagged concepts", () => {
    expect(decideModes([b([])], {})).toEqual(["explain"]);
  });

  it("caps write and blank blocks per project", () => {
    const levels = { a: 2, b: 2, c: 2, d: 1, e: 1, f: 1 };
    const modes = decideModes(["a", "b", "c", "d", "e", "f"].map((c) => b([c])), levels);
    expect(modes.filter((m) => m === "write")).toHaveLength(2);
    expect(modes.filter((m) => m === "blank")).toHaveLength(2);
  });
});

describe("effectiveLevel (忘れていたら復習)", () => {
  const now = Date.parse("2026-10-08T10:00:00Z");
  it("drops stale recall/write levels back to 1", () => {
    expect(effectiveLevel(3, "2026-08-01T00:00:00Z", now)).toBe(1);
    expect(effectiveLevel(2, "2026-10-01T00:00:00Z", now)).toBe(2);
    expect(effectiveLevel(1, "2026-01-01T00:00:00Z", now)).toBe(1);
  });
});

describe("makeBlank", () => {
  const blank = (target: string, choices = [target, "x", "y"], answer_index = 0) => ({ target, choices, answer_index });
  it("replaces the target once", () => {
    expect(makeBlank("part.Touched:Connect(fn)", blank("Touched"))).toBe("part.【？】:Connect(fn)");
  });
  it("rejects ambiguous or wrong candidates", () => {
    expect(makeBlank("a = 1 + 1", blank("1"))).toBeNull(); // appears twice
    expect(makeBlank("part.Touched", blank("Clicked"))).toBeNull(); // not in code
    expect(makeBlank("part.Touched", { target: "Touched", choices: ["Clicked", "Touched"], answer_index: 0 })).toBeNull();
    expect(makeBlank("part.Touched", null)).toBeNull();
  });
});

describe("validChoice", () => {
  it("accepts 2–4 choices with a valid index", () => {
    expect(validChoice({ question: "Q", choices: ["a", "b", "c"], answer_index: 2 })).toBe(true);
    expect(validChoice({ question: "Q", choices: ["a"], answer_index: 0 })).toBe(false);
    expect(validChoice({ question: "Q", choices: ["a", "b"], answer_index: 2 })).toBe(false);
    expect(validChoice({ question: "", choices: ["a", "b"], answer_index: 0 })).toBe(false);
  });
});

describe("conceptsUp (保護者向けの実測値)", () => {
  it("keeps the highest real level-up per concept and ignores teacher overrides", () => {
    const ups = conceptsUp([
      { concept_id: "touched", level_before: 0, level_after: 1, kind: "explain_pass" },
      { concept_id: "touched", level_before: 1, level_after: 2, kind: "blank_pass" },
      { concept_id: "if", level_before: 0, level_after: 3, kind: "teacher_set" },
      { concept_id: "wait", level_before: 1, level_after: 1, kind: "explain_assisted" },
    ], { touched: "Touchedイベント" });
    expect(ups).toEqual([{ name: "Touchedイベント", level: 2 }]);
  });
});

describe("statusRules with projects", () => {
  const now = Date.parse("2026-10-08T11:00:00Z");
  const minAgo = (m: number) => new Date(now - m * 60_000).toISOString();
  const session: LessonSession = {
    id: "s", student_id: "u", lesson_id: null, goal_note: null, status: "active", completed: null,
    help_requested_at: null, current_concept: null, current_problem: null,
    started_at: minAgo(30), last_activity_at: minAgo(1), ended_at: null,
  };
  const project = (over: Partial<ProjectRow>): ProjectRow => ({
    id: "p", session_id: "s", student_id: "u", idea: "床", title: "床", plan: {}, placement: {}, predict: null, tweak: null,
    stage: "build", assisted_count: 0, ran_ok_at: null, run_failed_at: null, stage_changed_at: minAgo(2),
    created_at: minAgo(20), completed_at: null, ...over,
  });

  it("is red when the project has not worked for 5+ minutes", () => {
    const s = computeStatus(session, [], [], now, project({ stage: "run", run_failed_at: minAgo(7) }));
    expect(s.level).toBe("red");
    expect(s.reasons[0]).toContain("作品が動かない");
  });
  it("is yellow when answers had to be revealed twice or a step takes long", () => {
    expect(computeStatus(session, [], [], now, project({ assisted_count: 2 })).level).toBe("yellow");
    expect(computeStatus(session, [], [], now, project({ stage: "explore", stage_changed_at: minAgo(16) })).level).toBe("yellow");
  });
  it("ignores finished projects", () => {
    expect(computeStatus(session, [], [], now, project({ stage: "done", assisted_count: 5 })).level).toBe("green");
  });
});
