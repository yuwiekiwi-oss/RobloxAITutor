// Data access used by every screen. `supabaseApi` is the real backend; the dev preview
// swaps in an in-memory implementation through <ApiProvider>.
import { createContext, useContext } from "react";
import type {
  CheckAnswerResult,
  ConceptEventRow,
  ConceptRow,
  GateResult,
  ProjectRow,
  ProjectWithBlocks,
  StudentConceptRow,
  WriteResult,
  TweakResult,
  QuizResult,
  ProjectBlockRow,
  EndSessionRequest,
  EndSessionResponse,
  Lesson,
  LessonSession,
  LessonSummaryRow,
  MessageRow,
  Profile,
  QuizAttempt,
  SavedTree,
  AccountsList,
  TutorRequest,
  TutorResponse,
} from "./types";

export type Classroom = {
  students: Profile[];
  /** Latest session per student today (active, or ended today). */
  sessions: LessonSession[];
  messages: MessageRow[];
  attempts: QuizAttempt[];
  summaryIds: Set<string>; // session ids that already have a summary
  lessons: Lesson[];
  /** Latest project per session (open, or finished today). */
  projects: ProjectRow[];
};

export interface Api {
  listLessons(): Promise<Lesson[]>;
  getActiveSession(studentId: string): Promise<LessonSession | null>;
  startSession(lessonId: string | null, goalNote: string): Promise<LessonSession>;
  listMessages(sessionId: string): Promise<MessageRow[]>;
  listAttempts(sessionIds: string[]): Promise<QuizAttempt[]>;
  uploadScreenshot(studentId: string, sessionId: string, image: Blob): Promise<string>;
  signedUrls(paths: string[]): Promise<Record<string, string>>;
  askTutor(req: TutorRequest): Promise<TutorResponse>;
  submitCheck(messageId: string, choice: number): Promise<CheckAnswerResult>;
  setHelp(sessionId: string, on: boolean): Promise<LessonSession>;
  setLesson(sessionId: string, lessonId: string | null): Promise<LessonSession>;
  endSession(req: EndSessionRequest): Promise<EndSessionResponse>;
  getSummary(sessionId: string): Promise<LessonSummaryRow | null>;
  loadClassroom(teacherId: string): Promise<Classroom>;

  // Build-first projects & mastery
  listConcepts(): Promise<ConceptRow[]>;
  getMastery(studentId: string): Promise<StudentConceptRow[]>;
  listConceptEvents(filter: { projectId: string }): Promise<ConceptEventRow[]>;
  getOpenProject(studentId: string): Promise<ProjectWithBlocks | null>;
  getProject(projectId: string): Promise<ProjectWithBlocks>;
  planProject(sessionId: string, idea: string, extras?: PlanExtras): Promise<ProjectWithBlocks>;
  /** Answers to AI先生's questions, or a correction ("ちょっとちがう"), or a newly pasted Explorer tree. */
  refinePlan(projectId: string, input: RefineInput): Promise<ProjectWithBlocks>;
  buildProject(projectId: string): Promise<ProjectWithBlocks>;
  /** A change the student asked for in the chat: re-plan, and re-build if code already exists. */
  reviseProject(projectId: string, request: string): Promise<ProjectWithBlocks>;
  answerGate(projectId: string, item: string, choice: number): Promise<GateResult>;
  submitWrite(projectId: string, idx: number, code: string): Promise<WriteResult>;
  /** Every line of a block was typed by hand. */
  markBlockTyped(projectId: string, idx: number): Promise<ProjectBlockRow>;
  /** いじる: the written answer, graded by AI先生 (older projects). */
  answerTweak(projectId: string, answer: string): Promise<TweakResult>;
  /** テスト N: the changed code, graded by AI先生. */
  answerQuiz(projectId: string, idx: number, code: string): Promise<QuizResult>;
  reportRun(projectId: string, ok: boolean): Promise<ProjectRow>;
  finishProject(projectId: string): Promise<ProjectRow>;
  abandonProject(projectId: string): Promise<ProjectRow>;
  /** Continue an unfinished project from an earlier lesson in this session. */
  resumeProject(projectId: string, sessionId: string): Promise<ProjectWithBlocks>;
  setConceptLevel(studentId: string, conceptId: string, level: number): Promise<StudentConceptRow>;
  /** Teacher: every concept back to 初見 (history is kept). Returns how many were reset. */
  resetMastery(studentId: string): Promise<number>;

  // Studio trees the signed-in student used before (newest first)
  listSavedTrees(): Promise<SavedTree[]>;
  saveTree(tree: string, place: string | null): Promise<SavedTree>;
  deleteSavedTree(id: string): Promise<void>;

  // Account management (teachers): own students; admins: everyone
  listAccounts(): Promise<AccountsList>;
  setPassword(userId: string, password: string): Promise<void>;
  setAdmin(userId: string, isAdmin: boolean): Promise<void>;
}

export type PlanExtras = { images?: string[]; tree?: string | null };
export type RefineInput = {
  answers?: { question: string; answer: string }[];
  feedback?: string;
  tree?: string | null;
  /** The script AI先生 asked to see (pasted by the student). */
  script?: { path: string; source: string };
  /** "そのScriptはない／わからない" */
  noScript?: boolean;
};

export class ApiError extends Error {}

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("ApiContext missing");
  return api;
}

export function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
