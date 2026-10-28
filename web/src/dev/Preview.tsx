// Dev-only screen preview with mock data: http://localhost:5173/#/preview
import { useMemo, useState } from "react";
import { ApiContext } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { LoginScreen } from "../features/auth/LoginScreen";
import { StudentApp } from "../features/student/StudentApp";
import { TeacherDashboard } from "../features/teacher/TeacherDashboard";
import { createMockApi, me, teacher } from "./mockApi";

type Screen = "student" | "teacher" | "login";
const LABELS: Record<Screen, string> = { student: "生徒", teacher: "先生", login: "ログイン" };

export default function Preview() {
  const api = useMemo(createMockApi, []);
  const initial = (new URLSearchParams(location.hash.split("?")[1]).get("screen") as Screen) || "student";
  const [screen, setScreen] = useState<Screen>(initial);
  const [key, setKey] = useState(0);
  const noop = () => setKey((k) => k + 1);

  return (
    <ApiContext.Provider value={api}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div className="preview-bar">
          <b>PREVIEW</b>
          {(Object.keys(LABELS) as Screen[]).map((s) => (
            <button key={s} className={s === screen ? "on" : ""} onClick={() => setScreen(s)}>{LABELS[s]}</button>
          ))}
          <a href="http://localhost:5174/?demo=1">保護者ページ（別アプリ）</a>
          <span>モックデータ・AIは定型文</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }} key={`${screen}-${key}`}>
          {screen === "student" && <StudentApp profile={me} onSignOut={noop} />}
          {screen === "teacher" && <TeacherDashboard profile={teacher} onSignOut={noop} />}
          {screen === "login" && <AuthProvider><LoginScreen /></AuthProvider>}
        </div>
      </div>
      <style>{`
        .preview-bar { display:flex; gap:6px; align-items:center; padding:4px 10px; background:#ffe14d; color:#222; font:12px system-ui; }
        .preview-bar button { border:1px solid #0003; background:#fff8; border-radius:6px; padding:2px 10px; }
        .preview-bar button.on { background:#222; color:#fff; }
        .preview-bar span { margin-left:auto; opacity:.7 }
      `}</style>
    </ApiContext.Provider>
  );
}
