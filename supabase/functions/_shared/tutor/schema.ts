// Structured Output schema for one tutor turn (strict mode: all keys required, no extras).
import type { TutorProgress } from "../contracts.ts";

export type TutorModelOutput = {
  reply: string;
  concept: string;
  problem: string;
  progress: TutorProgress;
  /** A change the student asked for in the open project (→ the project is revised automatically). */
  project_request: string | null;
};

export const TUTOR_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "concept", "problem", "progress", "project_request"],
  properties: {
    reply: { type: "string", description: "生徒に見せる返事（やさしい日本語）" },
    concept: { type: "string", description: "今あつかっている考え方（短い日本語）" },
    problem: { type: "string", description: "先生向け：生徒が取り組んでいる／つまずいている内容を1文で" },
    progress: {
      type: "string",
      enum: ["new_problem", "still_stuck", "progressing", "solved", "chatting"],
    },
    project_request: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "作品を作っている途中で、生徒が作品の変更・追加を頼んだときだけ、その注文を1文で。それ以外は null",
    },
  },
} as const;

const PROGRESS: TutorProgress[] = ["new_problem", "still_stuck", "progressing", "solved", "chatting"];

/**
 * Enforces server-side rules on whatever the model returned.
 * `canRevise`: a project is open and can still be changed; otherwise requests are dropped.
 */
export function normalizeTutorOutput(raw: TutorModelOutput, canRevise: boolean): TutorModelOutput {
  const request = typeof raw.project_request === "string" ? raw.project_request.trim().slice(0, 300) : "";
  return {
    reply: (raw.reply ?? "").trim() || "ごめんね、うまく答えられなかった。もう一度送ってみてくれる？",
    concept: (raw.concept ?? "").trim().slice(0, 40),
    problem: (raw.problem ?? "").trim().slice(0, 200),
    progress: PROGRESS.includes(raw.progress) ? raw.progress : "progressing",
    project_request: canRevise && request ? request : null,
  };
}
