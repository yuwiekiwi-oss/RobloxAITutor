// Shared contracts between the Web App and the Edge Functions.
// This file must stay dependency-free: the web app imports it as types only (`@contracts`).

/**
 * Everything the AI Tutor knows about the student's Roblox situation.
 *
 * The tutor logic only ever reads this object. How it is filled is the job of a
 * RobloxContextSource on the client:
 *   - v1.5 (manual):  question + pasted code + uploaded screenshots
 *   - v2 (plugin/MCP): projectTree / currentScript / errors filled automatically
 */
export type RobloxContext = {
  /** What the student typed. */
  question: string;
  /** Code the student pasted (v1.5). */
  code?: string;
  /** Storage paths in the `screenshots` bucket, e.g. "<studentId>/<sessionId>/<uuid>.jpg". */
  screenshots?: string[];
  /** Explorer hierarchy as text (v2). */
  projectTree?: string;
  /** Script currently open in Studio (v2). */
  currentScript?: { path?: string; source: string };
  /** Output window errors (v2). */
  errors?: string[];
  /** Where the context came from. */
  source?: "manual" | "studio-plugin" | "mcp";
};

export type TutorIntent = "ask" | "more_hint" | "confused" | "solved";

export type HintLevel = 0 | 1 | 2 | 3 | 4;

export type TutorProgress = "new_problem" | "still_stuck" | "progressing" | "solved" | "chatting";

export type UnderstandingCheck = {
  question: string;
  choices: string[];
  answer_index: number;
  explanation: string;
};

export type TutorMeta = {
  concept?: string;
  problem?: string;
  progress?: TutorProgress;
  check?: UnderstandingCheck | null;
  model?: string;
  /** Legacy (hint levels were removed). */
  max_allowed_hint?: number;
  /** A change to the open project the student asked for in chat (applied automatically). */
  project_request?: string | null;
};

export type Attachment = { bucket: "screenshots"; path: string };

export type MessageRow = {
  id: string;
  session_id: string;
  student_id: string;
  role: "student" | "tutor";
  message: string;
  code: string | null;
  attachments: Attachment[];
  intent: TutorIntent | null;
  hint_level: number | null;
  meta: TutorMeta;
  created_at: string;
};

export type TutorRequest = {
  sessionId: string;
  context: RobloxContext;
  intent: TutorIntent;
  /** Open project: the server attaches its current code to the context. */
  projectId?: string;
};

export type TutorResponse = {
  studentMessage: MessageRow;
  tutorMessage: MessageRow;
  /** Set when the student asked to change the open project → call project `revise`. */
  projectRequest?: string | null;
};

export type EndSessionRequest = {
  sessionId: string;
  /** Did the student finish today's task? (課題完了) */
  completed?: boolean;
  /** Re-run the AI summary for an already ended session. */
  regenerate?: boolean;
};

/** Measured values (実測値). Computed from the DB, never produced by the AI. */
export type SessionMetrics = {
  minutes: number;
  questions: number;
  hints_used: number;
  max_hint_level: number;
  checks_total: number;
  checks_correct_first_try: number;
  checks_solved: number;
  completed: boolean | null;
  /** Projects finished in this session. */
  projects_completed?: number;
  /** Concepts whose mastery level went up in this session (from concept_events). */
  concepts_up?: { name: string; level: number }[];
  /** コードのテスト: questions answered / right on the first try / right without being shown. */
  tests_total?: number;
  tests_first_try?: number;
  tests_solved?: number;
  /** Lines the student typed by hand (打ちこむ). */
  typed_lines?: number;
  /** Parts the student wrote from scratch and AI先生 accepted (自分で書く). */
  written_by_self?: number;
  /** What was made, with the code as it is now (shown to parents as "今日書いたコード"). */
  works?: { title: string; done: boolean; code: string }[];
};

export type LessonSummaryRow = {
  id: string;
  session_id: string;
  student_id: string;
  created_today: string;
  learned: string[];
  struggled_with: string[];
  how_student_solved_it: string;
  next_lesson: string;
  parent_summary: string;
  metrics: SessionMetrics;
  model: string | null;
  created_at: string;
  updated_at: string;
};

export type EndSessionResponse = {
  summary: LessonSummaryRow | null;
  summaryError?: string;
};

export const LIMITS = {
  questionChars: 2000,
  ideaImages: 3,
  codeChars: 20000,
  screenshotsPerMessage: 4,
  tutorCallsPerMinute: 6,
  historyMessages: 20,
} as const;

// ---------------------------------------------------------------------------
// Build-first projects ("動くものが先、理解が後") and concept mastery
// ---------------------------------------------------------------------------

/** Placeholder shown in a block where the student has to fill in the blank. */
export const BLANK_TOKEN = "【？】";

export type ProjectStage = "plan" | "build" | "predict" | "run" | "explore" | "tweak" | "done" | "abandoned";

/**
 * explain: AI wrote it, explained in the forced walkthrough (concept is new)
 * blank:   fill in 【？】 (concept learned once → recall)
 * write:   student writes the block (concept can be recalled → write it)
 * given:   already mastered, shown as-is
 */
export type BlockMode = "explain" | "blank" | "write" | "given";

/** Mastery: 0 初見 / 1 一度習った / 2 思い出せる / 3 自分で書ける */
export type MasteryLevel = 0 | 1 | 2 | 3;

export type ChoiceQuestion = { question: string; choices: string[] };

/** A question AI先生 asks before building, answered by tapping a choice. */
export type PlanQuestion = { question: string; choices: string[] };

export type ProjectPlan = {
  /** 「こういうこと？」: what AI先生 understood, in the student's own terms and part names. */
  understanding?: string;
  summary: string;
  parts: string[];
  /** Questions to settle before building (asked once, then cleared). */
  questions?: PlanQuestion[];
  /** The student's answers, kept for the build step. */
  answers?: { question: string; answer: string }[];
  /** Corrections the student typed ("ちょっとちがう"). */
  feedback?: string[];
  /** AI先生 needs to see a script the student already has, to insert the code into it. */
  script_request?: { name: string; reason: string } | null;
  /** The student said there is no such script (→ AI先生 stops asking). */
  script_declined?: boolean;
  /** How many times the plan was (re)made. */
  round?: number;
  /** Legacy single question (v1.5 first release). */
  question?: string | null;
};

export type Placement = {
  script_type: "Script" | "LocalScript";
  parent_path: string;
  steps: string[];
};

export type ProjectRow = {
  id: string;
  session_id: string;
  student_id: string;
  idea: string;
  title: string | null;
  plan: ProjectPlan | Record<string, never>;
  placement: Placement | Record<string, never>;
  /** Legacy (予想する was removed): only on older projects. */
  predict: ChoiceQuestion | null;
  /** いじる: a mission + a written question (older projects: multiple choice). */
  tweak: { instruction: string; question: string; choices?: string[] } | null;
  stage: ProjectStage;
  assisted_count: number;
  ran_ok_at: string | null;
  run_failed_at: string | null;
  stage_changed_at: string;
  created_at: string;
  completed_at: string | null;
  /** Reference images for the idea (screenshots bucket paths). */
  idea_images: string[];
  /** Explorer tree pasted from Studio. */
  explorer_tree: string | null;
  /** Scripts the student pasted so the code can be inserted into them. */
  scripts: StudentScript[];
  /**
   * テスト: three code questions「こうしたい！どう変える？」(answers in keys 'quiz:0'..'quiz:2').
   * Older projects: three choice questions, one choice question ('quiz'), or null.
   */
  quiz: CodeQuiz[] | ChoiceQuestion[] | ChoiceQuestion | null;
};

export type StudentScript = { path: string; source: string };

/** A code question: what the student wants to happen, and the piece of their code to change. */
export type CodeQuiz = { goal: string; code: string };

/** One line of code "translated" for a child: what it does, and the words in it. */
export type CodeLine = { code: string; meaning: string; words: { word: string; meaning: string }[] };

export type ProjectBlockRow = {
  id: string;
  project_id: string;
  student_id: string;
  idx: number;
  title: string;
  purpose: string;
  concepts: string[];
  mode: BlockMode;
  code: string | null;
  blank: { prompt: string; choices: string[] } | null;
  explanation: string | null;
  check_q: ChoiceQuestion | null;
  /** Line-by-line translation (explain / given blocks). */
  lines: CodeLine[] | null;
  build_done: boolean;
  explore_done: boolean;
};

export type ProjectWithBlocks = { project: ProjectRow; blocks: ProjectBlockRow[] };

export type ConceptRow = { id: string; name: string; kid_hint: string; category: string; sort_order: number };

export type StudentConceptRow = {
  student_id: string;
  concept_id: string;
  level: MasteryLevel;
  last_seen_at: string | null;
  updated_at: string;
};

export type ConceptEventRow = {
  id: string;
  student_id: string;
  concept_id: string;
  session_id: string | null;
  project_id: string | null;
  kind: string;
  level_before: number;
  level_after: number;
  created_at: string;
};

export type ProjectRequest =
  | { action: "plan"; sessionId: string; idea: string; images?: string[]; tree?: string | null }
  | {
    action: "refine";
    projectId: string;
    answers?: { question: string; answer: string }[];
    feedback?: string;
    tree?: string | null;
    /** The script AI先生 asked for, pasted by the student. */
    script?: StudentScript;
    /** "そのScriptはない／わからない" */
    noScript?: boolean;
  }
  | { action: "build"; projectId: string }
  | { action: "write"; projectId: string; idx: number; code: string }
  /** いじる: the written answer, graded by AI先生 (older projects). */
  | { action: "tweak"; projectId: string; answer: string }
  /** テスト N: the changed code. */
  | { action: "quiz"; projectId: string; idx: number; code: string }
  /** A change asked for in chat, at any step before 'done': re-plan, and re-build if code exists. */
  | { action: "revise"; projectId: string; request: string };

export type WriteResult = {
  passed: boolean;
  revealed: boolean;
  feedback: string;
  block: ProjectBlockRow;
};

export type QuizResult = {
  passed: boolean;
  /** Second miss: the model answer is shown so the student can go on. */
  revealed: boolean;
  feedback: string;
  /** The model answer (once passed or revealed). */
  answer: string | null;
};

export type TweakResult = {
  passed: boolean;
  /** Second miss: the expected result is shown so the student can finish. */
  revealed: boolean;
  feedback: string;
  expected: string | null;
};

/** Result of a multiple-choice gate (answer_project_item). */
export type GateResult = {
  correct: boolean;
  resolved: boolean;
  assisted?: boolean;
  already?: boolean;
  attempts?: number;
  answer_index: number | null;
  explanation: string | null;
};

// ---------------------------------------------------------------------------
// Account management (teacher dashboard → Edge Function `accounts`)
// ---------------------------------------------------------------------------

export type AccountRow = {
  id: string;
  role: "teacher" | "student";
  display_name: string;
  /** What the person types to log in (the e-mail without the school's login domain). */
  login_id: string;
  is_admin: boolean;
  /** For students: the teacher in charge. */
  teacher_name: string | null;
  is_self: boolean;
};

export type AccountsRequest =
  | { action: "list" }
  | { action: "set_password"; userId: string; password: string }
  | { action: "set_admin"; userId: string; isAdmin: boolean };

export type AccountsList = { accounts: AccountRow[]; isAdmin: boolean };

/** Shortest password accepted when a teacher sets one. */
export const PASSWORD_MIN = 6;
