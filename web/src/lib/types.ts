export type {
  Attachment,
  BlockMode,
  ChoiceQuestion,
  CodeLine,
  ConceptEventRow,
  ConceptRow,
  GateResult,
  MasteryLevel,
  Placement,
  ProjectBlockRow,
  ProjectPlan,
  ProjectRow,
  ProjectStage,
  ProjectWithBlocks,
  StudentConceptRow,
  StudentScript,
  WriteResult,
  TweakResult,
  QuizResult,
  CodeQuiz,
  EndSessionRequest,
  EndSessionResponse,
  HintLevel,
  LessonSummaryRow,
  MessageRow,
  RobloxContext,
  SessionMetrics,
  TutorIntent,
  TutorMeta,
  TutorProgress,
  TutorRequest,
  TutorResponse,
  UnderstandingCheck,
} from "@contracts";
export { BLANK_TOKEN, LIMITS } from "@contracts";

export type Role = "student" | "teacher" | "parent";

/** A Studio Explorer tree the student used before (student_trees). */
export type SavedTree = { id: string; place: string | null; tree: string; created_at: string; last_used_at: string };

export type Profile = {
  id: string;
  role: Role;
  display_name: string;
  teacher_id: string | null;
};

export type Lesson = {
  id: string;
  title: string;
  goal: string;
  concepts: string[];
  emoji: string;
  sort_order: number;
};

export type LessonSession = {
  id: string;
  student_id: string;
  lesson_id: string | null;
  goal_note: string | null;
  status: "active" | "ended";
  completed: boolean | null;
  help_requested_at: string | null;
  current_concept: string | null;
  current_problem: string | null;
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
};

export type QuizAttempt = {
  id: string;
  session_id: string;
  student_id: string;
  message_id: string;
  question: string;
  choice_index: number;
  is_correct: boolean;
  created_at: string;
};

export type CheckAnswerResult = {
  is_correct: boolean;
  already_solved: boolean;
  attempts: number;
  explanation: string | null;
};
