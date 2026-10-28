import { useCallback, useEffect, useState } from "react";
import { Loader } from "../../components/Loader";
import { useApi } from "../../lib/api";
import type { EndSessionResponse, Lesson, LessonSession, Profile } from "../../lib/types";
import { DoneScreen } from "./DoneScreen";
import { TutorScreen } from "./TutorScreen";
import "./student.css";

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "tutor"; session: LessonSession }
  | { kind: "done"; result: EndSessionResponse };

/** Students land straight on the AI先生 screen: a session is opened automatically. */
export function StudentApp({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const api = useApi();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [view, setView] = useState<View>({ kind: "loading" });

  const open = useCallback(async () => {
    setView({ kind: "loading" });
    try {
      const [ls, active] = await Promise.all([api.listLessons(), api.getActiveSession(profile.id)]);
      setLessons(ls);
      setView({ kind: "tutor", session: active ?? (await api.startSession(null, "")) });
    } catch (e) {
      setView({ kind: "error", message: (e as Error).message });
    }
  }, [api, profile.id]);

  useEffect(() => {
    open();
  }, [open]);

  return (
    <div className="theme-student student-root">
      {view.kind === "loading" && <div className="center-screen"><Loader /></div>}
      {view.kind === "error" && (
        <div className="center-screen">
          <p>{view.message}</p>
          <button className="btn btn-primary" onClick={open}>もう一度読みこむ</button>
        </div>
      )}
      {view.kind === "tutor" && (
        <TutorScreen
          key={view.session.id}
          profile={profile}
          initialSession={view.session}
          lessons={lessons}
          onSignOut={onSignOut}
          onEnded={(result) => setView({ kind: "done", result })}
        />
      )}
      {view.kind === "done" && (
        <DoneScreen name={profile.display_name} result={view.result} onRestart={open} onSignOut={onSignOut} />
      )}
    </div>
  );
}
