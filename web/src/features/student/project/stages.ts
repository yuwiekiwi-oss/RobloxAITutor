import type { ProjectBlockRow, ProjectStage } from "../../../lib/types";

export const STAGES: { id: ProjectStage; label: string }[] = [
  { id: "plan", label: "決める" },
  { id: "build", label: "打ちこむ" },
  { id: "run", label: "動かす" },
  { id: "explore", label: "テスト" },
  { id: "tweak", label: "いじる" },
  { id: "done", label: "完成" },
];

/** 予想する only exists on projects made before it was removed. */
const LEGACY_LABEL: Partial<Record<ProjectStage, string>> = { predict: "予想する", abandoned: "やめた" };

export const stageLabel = (s: ProjectStage) => STAGES.find((x) => x.id === s)?.label ?? LEGACY_LABEL[s] ?? s;

export const LEVEL_NAMES = ["初見", "一度習った", "思い出せる", "自分で書ける"];

export const MODE_LABEL: Record<ProjectBlockRow["mode"], string> = {
  explain: "AIが書いたよ",
  blank: "穴うめ",
  write: "自分で書く",
  given: "もう書ける",
};

/** The project's code as the student can see it right now. */
export function assembledCode(blocks: ProjectBlockRow[]): string {
  return blocks.map((b) => b.code ?? "-- ✏ ここは自分で書く部分").join("\n");
}
