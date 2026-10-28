import { useCallback, useEffect, useRef, useState } from "react";
import { manualContextSource } from "../../context/manualContextSource";
import { prepareScreenshot } from "../../lib/image";
import { useApi } from "../../lib/api";
import type {
  EndSessionResponse,
  Lesson,
  LessonSession,
  MessageRow,
  Profile,
  ProjectWithBlocks,
  QuizAttempt,
  TutorIntent,
} from "../../lib/types";
import { LIMITS } from "../../lib/types";
import { Brand } from "../../components/Brand";
import { Icon } from "../../components/Icon";
import { RobotHero } from "../../components/TutorAvatar";
import { primeImageUrl } from "../../components/useSignedUrls";
import { Composer, type Draft, emptyDraft, type PendingImage } from "./Composer";
import { EndDialog } from "./EndDialog";
import { StudentBubble, ThinkingBubble, TutorBubble } from "./Messages";
import { CompletedCard, IdeaStart, ProjectWorkspace, ResumeCard } from "./project/ProjectWorkspace";

const QUICK_TEXT: Record<Exclude<TutorIntent, "ask">, string> = {
  more_hint: "もっとくわしく教えて",
  confused: "よくわからなかった。もう少しかんたんに教えて",
  solved: "できた！",
};


export function TutorScreen({
  profile,
  initialSession,
  lessons,
  onSignOut,
  onEnded,
}: {
  profile: Profile;
  initialSession: LessonSession;
  lessons: Lesson[];
  onSignOut: () => void;
  onEnded: (result: EndSessionResponse) => void;
}) {
  const api = useApi();
  const [session, setSession] = useState(initialSession);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [pending, setPending] = useState<MessageRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEnd, setShowEnd] = useState(false);
  const [pw, setPw] = useState<ProjectWithBlocks | null>(null);
  const [tab, setTab] = useState<"project" | "chat">("project");
  const [revising, setRevising] = useState(false);
  // The start screen (今日はなにする？). Shown again after a project is finished / dropped;
  // the chat history comes back as soon as the student asks something (or opens it).
  const [home, setHome] = useState(true);
  // The project just finished: celebrated on the start screen.
  const [completed, setCompleted] = useState<ProjectWithBlocks | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openProject = pw && !["done", "abandoned"].includes(pw.project.stage) ? pw.project : null;

  // A project from this lesson reopens (e.g. after a reload). One left unfinished in an earlier
  // lesson does not: the start screen offers 「つづきから作る」 instead.
  const [unfinished, setUnfinished] = useState<ProjectWithBlocks | null>(null);
  useEffect(() => {
    api.getOpenProject(profile.id).then((open) => {
      if (!open) return;
      if (open.project.session_id === initialSession.id) setPw(open);
      else setUnfinished(open);
    }).catch(() => {});
  }, [api, profile.id, initialSession.id]);

  // The teacher can end the lesson from the dashboard: then this screen moves to the result too.
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const active = await api.getActiveSession(profile.id);
        if (stopped || active?.id === session.id) return;
        stopped = true;
        const summary = await api.getSummary(session.id).catch(() => null);
        onEndedRef.current(summary
          ? { summary }
          : { summary: null, summaryError: "先生が授業を終わりにしたよ。まとめは、先生がいま作っているところ。" });
      } catch {
        // Offline for a moment: try again next time.
      }
    };
    const timer = window.setInterval(check, 15_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [api, profile.id, session.id]);

  const resume = async () => {
    if (!unfinished) return;
    try {
      const next = await api.resumeProject(unfinished.project.id, session.id);
      setUnfinished(null);
      setCompleted(null);
      setPw(next);
      setTab("project");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Starting something new while a project is unfinished: drop it first (only one can be open). */
  const beforeNewProject = async (): Promise<boolean> => {
    if (!unfinished) return true;
    if (!window.confirm(`作りかけの「${unfinished.project.title ?? unfinished.project.idea}」をやめて、新しく作る？`)) return false;
    await api.abandonProject(unfinished.project.id);
    setUnfinished(null);
    return true;
  };

  useEffect(() => {
    api.listMessages(session.id).then(setMessages).catch((e: Error) => setError(e.message));
    api.listAttempts([session.id]).then(setAttempts).catch(() => {});
  }, [api, session.id]);

  useEffect(() => {
    const el = listRef.current;
    if (el && (messages.length > 0 || pending)) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending, attempts.length]);

  const uploadImages = useCallback(async (images: PendingImage[]): Promise<PendingImage[]> => {
    return Promise.all(images.map(async (img) => {
      if (img.path) return img;
      const path = await api.uploadScreenshot(profile.id, session.id, img.blob);
      primeImageUrl(path, img.previewUrl);
      return { ...img, path };
    }));
  }, [api, profile.id, session.id]);

  const send = async (intent: TutorIntent) => {
    if (pending) return;
    const fromComposer = intent === "ask";
    const question = fromComposer ? draft.question : QUICK_TEXT[intent];
    const code = fromComposer ? draft.code : "";
    const tree = fromComposer ? draft.tree : null;
    if (fromComposer && !question.trim() && !code.trim() && draft.images.length === 0 && !tree) return;

    setError(null);
    setHome(false);
    setCompleted(null);
    const optimistic: MessageRow = {
      id: "pending",
      session_id: session.id,
      student_id: profile.id,
      role: "student",
      message: question,
      code: code.trim() || null,
      attachments: [],
      intent,
      hint_level: null,
      meta: {},
      created_at: new Date().toISOString(),
    };
    setPending(optimistic);

    try {
      let paths: string[] = [];
      if (fromComposer && draft.images.length) {
        const uploaded = await uploadImages(draft.images);
        setDraft((d) => ({ ...d, images: uploaded }));
        paths = uploaded.map((i) => i.path!);
      }
      const context = await manualContextSource.collect({
        question: question.trim() || (tree ? "Studioの構成を見てほしい" : question),
        code,
        screenshotPaths: paths,
        tree,
      });
      const res = await api.askTutor({ sessionId: session.id, context, intent, projectId: openProject?.id });
      setMessages((m) => [...m, res.studentMessage, res.tutorMessage]);
      if (fromComposer) setDraft(emptyDraft());
      if (res.projectRequest && openProject) void revise(openProject.id, res.projectRequest);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  };

  // The student asked AI先生 to change the project in the chat: re-plan / re-build it right away.
  const revise = async (projectId: string, request: string) => {
    setRevising(true);
    try {
      setPw(await api.reviseProject(projectId, request));
    } catch (e) {
      setError((e as Error).message);
      api.getProject(projectId).then(setPw).catch(() => {});
    } finally {
      setRevising(false);
    }
  };

  const addImages = async (files: File[]) => {
    const room = LIMITS.screenshotsPerMessage - draft.images.length;
    if (room <= 0) {
      setError(`画像は1回に${LIMITS.screenshotsPerMessage}枚までだよ。`);
      return;
    }
    const added = await Promise.all(files.slice(0, room).map(async (file) => {
      const blob = await prepareScreenshot(file);
      return { id: crypto.randomUUID(), blob, previewUrl: URL.createObjectURL(blob) } satisfies PendingImage;
    }));
    setDraft((d) => ({ ...d, images: [...d.images, ...added] }));
  };

  const changeLesson = async (lessonId: string) => {
    try {
      setSession(await api.setLesson(session.id, lessonId || null));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleHelp = async () => {
    try {
      setSession(await api.setHelp(session.id, !session.help_requested_at));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const askAboutProject = (question: string, code?: string) => {
    setTab("chat");
    setDraft((d) => (code?.trim() ? { ...d, question, code, showCode: true } : { ...d, question }));
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
  };

  const lastTutorId = [...messages].reverse().find((m) => m.role === "tutor")?.id;
  const isEmpty = messages.length === 0 && !pending;
  const hasProject = Boolean(pw);
  const showWelcome = !hasProject && !pending && (home || isEmpty);
  // Finishing (or dropping) a project goes straight back to the start screen.
  const changeProject = (next: ProjectWithBlocks | null) => {
    if (next?.project.stage === "done") setCompleted(next);
    if (!next || next.project.stage === "done") {
      setPw(null);
      setHome(true);
      setTab("project");
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0 }));
      return;
    }
    setPw(next);
  };

  return (
    <div className="tutor">
      <header className="topbar">
        <Brand compact />
        <label className={`lesson-select ${session.lesson_id ? "is-set" : ""}`}>
          <span className="lesson-select-label">レッスン</span>
          <select value={session.lesson_id ?? ""} onChange={(e) => changeLesson(e.target.value)} aria-label="今日のレッスン（えらばなくてもOK）">
            <option value="">えらばない</option>
            {lessons.map((l, i) => (
              <option key={l.id} value={l.id}>
                {String(i + 1).padStart(2, "0")} {l.title}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
        <div className="topbar-actions">
          <button
            className={`help-btn ${session.help_requested_at ? "is-on" : ""}`}
            onClick={toggleHelp}
            aria-pressed={Boolean(session.help_requested_at)}
          >
            <Icon name="bell" size={16} />
            <span className="help-text">{session.help_requested_at ? "先生を呼んだよ" : "先生を呼ぶ"}</span>
            {session.help_requested_at && <span className="help-cancel">取り消す</span>}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowEnd(true)} aria-label="授業をおわる">
            <Icon name="flag" size={16} />
            <span className="end-text">おわる</span>
          </button>
          <button className="icon-btn" onClick={onSignOut} aria-label="ログアウト" title="ログアウト">
            <Icon name="logout" size={17} />
          </button>
        </div>
      </header>

      {hasProject && (
        <div className="mode-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "project"} className={tab === "project" ? "is-on" : ""} onClick={() => setTab("project")}>
            <Icon name="code" size={16} /> 作品
          </button>
          <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "is-on" : ""} onClick={() => setTab("chat")}>
            <Icon name="chat" size={16} /> AI先生に聞く{messages.length > 0 && <span className="tab-count">{Math.ceil(messages.length / 2)}</span>}
          </button>
        </div>
      )}

      <div className={`tutor-main ${hasProject ? "has-project" : ""}`}>
        {pw && (
          <section className={`workspace-pane ${tab === "project" ? "is-active" : ""}`}>
            <ProjectWorkspace pw={pw} onChange={changeProject} onAskTutor={askAboutProject} revising={revising} />
          </section>
        )}
        <section className={`chat-pane ${!hasProject || tab === "chat" ? "is-active" : ""}`}>
        <div className="chat" ref={listRef}>
          {isEmpty && hasProject ? (
            <div className="chat-hint">
              <p className="speech-name">AI先生</p>
              <p>作品のことで困ったら、ここで聞いてね。今の作品のコードは、AI先生にも見えているよ。</p>
            </div>
          ) : showWelcome ? (
            <div className="welcome">
              <div className="welcome-stage">
                <RobotHero className="welcome-robot" />
                <div className="welcome-bubble glass">
                  <p className="speech-name">AI先生</p>
                  <p className="welcome-hello">{profile.display_name}さん、こんにちは！</p>
                  <h1 className="welcome-title">今日はなにする？</h1>
                  <p className="welcome-lead">作りたいものがあれば、AI先生が動くコードを作るよ。困ったことは、いちばん下の入力らんでいつでも聞けるよ。</p>
                </div>
              </div>
              {completed && <CompletedCard pw={completed} onClose={() => setCompleted(null)} />}
              {unfinished && !completed && (
                <ResumeCard
                  pw={unfinished}
                  onResume={resume}
                  onDrop={async () => {
                    if (!window.confirm(`「${unfinished.project.title ?? unfinished.project.idea}」をやめる？`)) return;
                    await api.abandonProject(unfinished.project.id);
                    setUnfinished(null);
                  }}
                />
              )}
              <IdeaStart sessionId={session.id} studentId={profile.id} beforeStart={beforeNewProject} onStarted={(next) => { setCompleted(null); setPw(next); setTab("project"); }} />
              {messages.length > 0 && (
                <button className="link-btn welcome-history" onClick={() => setHome(false)}>
                  <Icon name="chat" size={15} /> これまでのAI先生との会話を見る
                </button>
              )}
            </div>
          ) : (
            <div className="messages">
              {!hasProject && (
                <button className="link-btn messages-home" onClick={() => setHome(true)}>
                  <Icon name="code" size={15} /> 作りたいものから始める
                </button>
              )}
              {messages.map((m) =>
                m.role === "student" ? <StudentBubble key={m.id} message={m} /> : (
                  <TutorBubble
                    key={m.id}
                    message={m}
                    attempts={attempts.filter((a) => a.message_id === m.id)}
                    onAnswer={async (choice) => {
                      const r = await api.submitCheck(m.id, choice);
                      setAttempts((a) => [...a, {
                        id: crypto.randomUUID(),
                        session_id: session.id,
                        student_id: profile.id,
                        message_id: m.id,
                        question: m.meta.check?.question ?? "",
                        choice_index: choice,
                        is_correct: r.is_correct,
                        created_at: new Date().toISOString(),
                      }]);
                      return r;
                    }}
                    quickActions={m.id === lastTutorId && !pending
                      ? {
                        onMoreHint: () => send("more_hint"),
                        onConfused: () => send("confused"),
                        onSolved: () => send("solved"),
                        maxed: false,
                      }
                      : undefined}
                  />
                )
              )}
              {pending && (
                <>
                  <StudentBubble message={pending} localImages={draft.images.map((i) => i.previewUrl)} />
                  <ThinkingBubble />
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="toast-error" role="alert">
            <Icon name="alert" size={18} />
            <span>{error}</span>
            <button className="icon-btn" onClick={() => setError(null)} aria-label="とじる">
              <Icon name="x" size={16} />
            </button>
          </div>
        )}

        <Composer
          draft={draft}
          setDraft={setDraft}
          onAddImages={addImages}
          onSend={() => send("ask")}
          busy={Boolean(pending) || revising}
          compact={!showWelcome}
        />
        </section>
      </div>

      {showEnd && (
        <EndDialog
          onCancel={() => setShowEnd(false)}
          onEnd={async (completed) => {
            const result = await api.endSession({ sessionId: session.id, completed });
            onEnded(result);
          }}
        />
      )}
    </div>
  );
}
