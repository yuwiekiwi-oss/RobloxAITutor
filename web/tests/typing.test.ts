import { describe, expect, it } from "vitest";
import { checkTyped, needsTyping, normalizeLine, stripComment } from "../src/features/student/project/typing";

describe("hand typing check", () => {
  it("ignores indentation and spaces around symbols", () => {
    expect(checkTyped("boom.BlastRadius=20", "\tboom.BlastRadius = 20").ok).toBe(true);
    expect(checkTyped("if math.random( 1 , 10 )==1 then", "if math.random(1,10) == 1 then").ok).toBe(true);
  });

  it("accepts full-width letters typed with the IME on", () => {
    expect(checkTyped("ｂｏｏｍ．Ｐａｒｅｎｔ　＝　ｗｏｒｋｓｐａｃｅ", "boom.Parent = workspace").ok).toBe(true);
  });

  it("does not require typing comments, but keeps strings", () => {
    expect(checkTyped("boom.DestroyJointRadiusPercent = 0", "boom.DestroyJointRadiusPercent = 0 -- これがないと たおれちゃう").ok).toBe(true);
    expect(stripComment('print("a -- b") -- note')).toBe('print("a -- b") ');
    expect(needsTyping("\t-- メモ")).toBe(false);
    expect(needsTyping("end")).toBe(true);
  });

  it("is strict about names and case, and says where it went wrong", () => {
    expect(checkTyped("local boom = instance.new(\"Explosion\")", 'local boom = Instance.new("Explosion")'))
      .toEqual({ ok: false, matched: "local boom=" });
    expect(checkTyped("local bom", "local boom").ok).toBe(false);
    expect(normalizeLine("local  a   =  1")).toBe("local a=1");
  });
});
