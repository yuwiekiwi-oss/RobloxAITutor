import { describe, expect, it } from "vitest";
import { sameCode } from "../../supabase/functions/_shared/codeMatch.ts";
import { cleanTree, extractTree, parseTree, TREE_COMMAND, TREE_END, TREE_START, treeStats } from "../../supabase/functions/_shared/studioTree.ts";
import { cleanLines, cleanQuestions, countCodeLines, formatBuildInput, formatPlanInput, pickCodeQuiz, withLessonGuide } from "../../supabase/functions/_shared/project/prompt.ts";
import { formatRobloxContext } from "../../supabase/functions/_shared/tutor/buildInput.ts";
import { projectMetrics, projectWorkLines } from "../../supabase/functions/_shared/summary/metrics.ts";

describe("Studio tree (command bar → Output → paste)", () => {
  it("is one line of Luau that prints between the markers", () => {
    expect(TREE_COMMAND).not.toContain("\n");
    expect(TREE_COMMAND).toContain(TREE_START);
    expect(TREE_COMMAND).toContain(TREE_END);
    expect(TREE_COMMAND).toContain('print(table.concat(o,"\\n"))');
  });

  it("extracts the tree from a messy Output copy", () => {
    const pasted = [
      "DataStoreService: StudioAccessToApisNotAllowed ...",
      `12:34:56.789  ${TREE_START}`,
      "Workspace (Workspace)  ",
      "  LavaFloor (Part)",
      "",
      "  Cloud (Part) x151",
      `${TREE_END}  -  Edit`,
      "12:35:00.001  something else",
    ].join("\r\n");
    expect(extractTree(pasted)).toBe("Workspace (Workspace)\n  LavaFloor (Part)\n  Cloud (Part) x151");
  });

  it("accepts a copy that stops before the END line, rejects text without markers", () => {
    expect(extractTree(`${TREE_START}\nWorkspace (Workspace)\n  Door (Part)`)).toBe("Workspace (Workspace)\n  Door (Part)");
    expect(extractTree("Workspace\n  Door")).toBeNull();
    expect(extractTree(`${TREE_START}\n${TREE_END}`)).toBeNull();
  });

  it("server side keeps plain text but caps the size", () => {
    expect(cleanTree(42)).toBeNull();
    expect(cleanTree("  ")).toBeNull();
    expect(cleanTree("Workspace\n  Door ")).toBe("Workspace\n  Door");
    expect(cleanTree(`${TREE_START}\n${"x".repeat(20000)}`)!.length).toBe(12000);
  });
});

describe("plan: questions and 「こういうこと？」", () => {
  it("keeps only tap-to-answer questions (2–3 choices, no おまかせ, max 3)", () => {
    const qs = cleanQuestions([
      { question: "ダメージはどれくらい？", choices: ["少し", "一気に", "即アウト", "ランダム"] },
      { question: "床はある？", choices: ["ある", "おまかせ"] },
      { question: "  ", choices: ["a", "b"] },
      { question: "色は？", choices: ["赤", "赤", "青"] },
      { question: "Q4", choices: ["a", "b"] },
      { question: "Q5", choices: ["a", "b"] },
    ]);
    expect(qs).toEqual([
      { question: "ダメージはどれくらい？", choices: ["少し", "一気に", "即アウト"] },
      { question: "色は？", choices: ["赤", "青"] },
      { question: "Q4", choices: ["a", "b"] },
    ]);
  });

  it("gives the model the tree, images, answers and corrections", () => {
    const text = formatPlanInput({
      idea: "ダメージ床",
      tree: "Workspace (Workspace)\n  LavaFloor (Part)",
      imageCount: 2,
      previous: { title: "ダメージ床", understanding: "床にさわると体力がへる" },
      answers: [{ question: "ダメージはどれくらい？", answer: "一気に" }],
      feedback: ["床じゃなくて壁"],
    });
    expect(text).toContain("LavaFloor (Part)");
    expect(text).toContain("【参考画像】2枚");
    expect(text).toContain("ダメージはどれくらい？ → 一気に");
    expect(text).toContain("床じゃなくて壁");
    expect(formatPlanInput({ idea: "ドア" })).toBe("【作りたいもの】ドア");
  });

  it("build input carries what the student confirmed and the real part names", () => {
    const text = formatBuildInput({
      idea: "ダメージ床",
      plan: { title: "ダメージ床", understanding: "LavaFloorにさわると10へる", answers: [{ question: "量", answer: "少し" }] },
      tree: "Workspace (Workspace)\n  LavaFloor (Part)",
      concepts: [{ id: "touched", name: "Touchedイベント", level: 1 }],
    });
    expect(text).toContain("こういうこと？→そう！");
    expect(text).toContain("LavaFloor (Part)");
    expect(text).toContain("touched（Touchedイベント）: 一度習った");
  });

  it("a change from the chat re-plans and re-builds from the current code", () => {
    const plan = formatPlanInput({ idea: "ダメージ床", currentCode: "humanoid.Health -= 20", feedback: ["ダメージを50にする"] });
    expect(plan).toContain("【今のコード】\nhumanoid.Health -= 20");
    expect(plan).toContain("ダメージを50にする");
    const build = formatBuildInput({ idea: "ダメージ床", plan: { title: "床" }, previousCode: "humanoid.Health -= 20", concepts: [] });
    expect(build).toContain("【前のコード（注文に関係ない部分はそのまま使う）】");
  });

  it("the tutor sees a pasted tree as the Explorer", () => {
    expect(formatRobloxContext({ question: "動かない", projectTree: "Workspace (Workspace)\n  Door (Part)" }))
      .toContain("【Explorerの構成】\nWorkspace (Workspace)");
  });
});

describe("体験授業: short snippets, line-by-line translation", () => {
  it("adds the lesson rules last, so they win", () => {
    const text = withLessonGuide("BASE", "# 体験授業\n- 10行以内");
    expect(text.indexOf("BASE")).toBeLessThan(text.indexOf("10行以内"));
    expect(text).toContain("上の指示より優先");
    expect(withLessonGuide("BASE", null)).toBe("BASE");
  });

  it("counts only real code lines toward the limit", () => {
    expect(countCodeLines("if a then\n\n\t-- メモ\n\tb()\nend")).toBe(3);
  });

  it("keeps one translation per line and uses the real code text", () => {
    const code = 'if math.random(1,10) == 1 then\n\tlocal boom = Instance.new("Explosion")';
    const lines = cleanLines([
      { code: "if math.random(1,10) == 1 then", meaning: "10回に1回", words: [{ word: "==", meaning: "同じなら" }] },
      { code: 'local boom = Instance.new("Explosion")', meaning: "爆発を作る", words: [
        { word: "boom", meaning: "名前" }, { word: "Instance.new", meaning: "新しく作る" }, { word: "a", meaning: "b" }, { word: "c", meaning: "d" },
      ] },
      { code: "", meaning: "空" },
    ], code)!;
    expect(lines).toHaveLength(2);
    expect(lines[1].code).toBe('\tlocal boom = Instance.new("Explosion")');
    expect(lines[1].words).toHaveLength(3);
    expect(cleanLines([], code)).toBeNull();
  });

  it("shows the pasted script to the model", () => {
    const text = formatPlanInput({ idea: "爆発", scripts: [{ path: "KeyScript", source: "local key = script.Parent" }] });
    expect(text).toContain("【生徒の今のScript: KeyScript】");
    expect(text).toContain("local key = script.Parent");
    expect(formatPlanInput({ idea: "爆発", scriptDeclined: true })).toContain("もう聞かない");
  });
});

describe("saved Studio trees", () => {
  it("reads the place name printed with the tree", () => {
    const pasted = `12:00:00.000  ${TREE_START}\nPLACE: キーボードタワー\nWorkspace (Workspace)\n  Key (MeshPart) x638\n${TREE_END}`;
    expect(parseTree(pasted)).toEqual({ tree: "Workspace (Workspace)\n  Key (MeshPart) x638", place: "キーボードタワー" });
    expect(parseTree(`${TREE_START}\nWorkspace (Workspace)`)?.place).toBeNull();
    expect(TREE_COMMAND).toContain('"PLACE: "..game.Name');
  });

  it("counts parts and scripts for the cards (x groups included)", () => {
    expect(treeStats("Workspace (Workspace)\n  Key (MeshPart) x638\n  Door (Part)\n  Model (Model) x2\nServerScriptService (ServerScriptService)\n  KeyScript (Script)\n  Lib (ModuleScript) x3"))
      .toEqual({ parts: 641, scripts: 4 });
  });
});

describe("コードのテスト", () => {
  const q = (goal: string, code: string, answer: string) => ({ goal, code, answer, explanation: "e" });
  it("keeps up to 3 questions whose answer really changes the code", () => {
    const picked = pickCodeQuiz([
      q("2回に1回", "if math.random(1,10) == 1 then", "if math.random(1,2) == 1 then"),
      q("同じ", "a = 1", "a  =  1 -- 同じ"),
      q("", "b = 1", "b = 2"),
      q("大きく", "boom.BlastRadius = 20", "boom.BlastRadius = 40"),
      q("弱く", "boom.BlastPressure = 500000", "boom.BlastPressure = 50000"),
      q("4つ目", "x = 1", "x = 2"),
    ]);
    expect(picked.map((x) => x.goal)).toEqual(["2回に1回", "大きく", "弱く"]);
  });
  it("grades code the same way as typing (spaces, comments, full-width)", () => {
    expect(sameCode("if math.random(1,2)==1 then -- 半分", "if math.random(1,2) == 1 then")).toBe(true);
    expect(sameCode("\tboom.BlastRadius = 40\n", "boom.BlastRadius = 40")).toBe(true);
    expect(sameCode("boom.BlastRadius = 4", "boom.BlastRadius = 40")).toBe(false);
  });
});

describe("保護者向けの実測値（作品づくり）", () => {
  const projects = [{ id: "p", title: "爆発キー", idea: "爆発", stage: "done", quiz: [{ goal: "2回に1回", code: "a" }, { goal: "広く", code: "b" }, { goal: "弱く", code: "c" }] }];
  const blocks = [
    { project_id: "p", idx: 0, mode: "explain", code: "if x then\n\t-- メモ\n\ty = 1", build_done: true, title: "たまに" },
    { project_id: "p", idx: 1, mode: "write", code: "end", build_done: true, purpose: "おわり" },
  ];
  const at = (item: string, correct: boolean, min: number, assisted = false) =>
    ({ project_id: "p", item, correct, assisted, created_at: `2026-10-10T10:${String(min).padStart(2, "0")}:00Z` });
  const attempts = [at("write:1", false, 1), at("write:1", true, 2), at("quiz:0", true, 3), at("quiz:1", false, 4), at("quiz:1", false, 5, true), at("quiz:2", false, 6), at("quiz:2", true, 7)];

  it("counts tests, typed lines, self-written parts and keeps the code", () => {
    const m = projectMetrics(projects, blocks, attempts);
    expect(m).toMatchObject({ tests_total: 3, tests_first_try: 1, tests_solved: 2, typed_lines: 2, written_by_self: 1 });
    expect(m.works).toEqual([{ title: "爆発キー", done: true, code: "if x then\n\t-- メモ\n\ty = 1\nend" }]);
  });

  it("tells the summary model what happened, from the records only", () => {
    const lines = projectWorkLines(projects, blocks, attempts);
    expect(lines[0]).toBe("作品「爆発キー」（完成）");
    expect(lines).toContain("自分で書いた部分「おわり」: 2回目で書けた");
    expect(lines).toContain("テスト2（「広く」のためにコードを書きかえる問題）: お手本を見て理解した");
    expect(lines).toContain("テスト3（「弱く」のためにコードを書きかえる問題）: 2回目で正解");
  });
});
