import { lazy, Suspense } from "react";
import { Loader } from "./components/Loader";
import { ApiContext } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { isSupabaseConfigured, supabaseApi } from "./lib/supabaseApi";
import { LoginScreen } from "./features/auth/LoginScreen";
import { StudentApp } from "./features/student/StudentApp";
import { TeacherDashboard } from "./features/teacher/TeacherDashboard";

// Dev-only UI preview with an in-memory backend: http://localhost:5173/#/preview
const Preview = import.meta.env.DEV ? lazy(() => import("./dev/Preview")) : null;

export function App() {
  if (Preview && location.hash.startsWith("#/preview")) {
    return (
      <Suspense fallback={null}>
        <Preview />
      </Suspense>
    );
  }
  if (!isSupabaseConfigured) return <SetupNotice />;
  return (
    <AuthProvider>
      <ApiContext.Provider value={supabaseApi}>
        <Gate />
      </ApiContext.Provider>
    </AuthProvider>
  );
}

function Gate() {
  const { loading, session, profile, signOut } = useAuth();
  if (loading) return <div className="theme-student center-screen"><Loader /></div>;
  if (!session) return <LoginScreen />;
  if (!profile) {
    return (
      <div className="theme-student center-screen">
        <p>アカウントの準備がまだできていません。先生に伝えてね。</p>
        <button className="btn btn-ghost" onClick={signOut}>ログアウト</button>
      </div>
    );
  }
  switch (profile.role) {
    case "student":
      return <StudentApp profile={profile} onSignOut={signOut} />;
    case "teacher":
      return <TeacherDashboard profile={profile} onSignOut={signOut} />;
    case "parent":
      return <ParentNotice onSignOut={signOut} />;
  }
}

// Parents use the separate plain-HTML page in /parent (LINE login).
const PARENT_URL = (import.meta.env.VITE_PARENT_URL as string | undefined) ?? "./parent/";

function ParentNotice({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="theme-student center-screen">
      <p>保護者の方は、保護者専用ページをご利用ください。</p>
      <a className="btn btn-primary" href={PARENT_URL}>保護者ページを開く</a>
      <button className="btn btn-ghost" onClick={onSignOut}>ログアウト</button>
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="theme-student center-screen setup">
      <h1>ミスタージョーンズ金町校 · AI先生</h1>
      <p>Supabaseの接続先が設定されていません。</p>
      <p>
        <code>web/.env.local</code> に <code>VITE_SUPABASE_URL</code> と <code>VITE_SUPABASE_ANON_KEY</code> を設定してください。
      </p>
      {import.meta.env.DEV && <p><a href="#/preview" onClick={() => setTimeout(() => location.reload())}>画面プレビュー（デモデータ）を開く</a></p>}
    </div>
  );
}
