import type { Session } from "@supabase/supabase-js";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabaseApi";
import type { Profile } from "./types";

type AuthState = {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  signIn: (loginId: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const LOGIN_DOMAIN = (import.meta.env.VITE_LOGIN_DOMAIN as string | undefined) ?? "juku.local";

/** Kids type a short login ID; we turn it into the email Supabase Auth expects. */
export function loginIdToEmail(loginId: string): string {
  const id = loginId.trim().toLowerCase();
  return id.includes("@") ? id : `${id}@${LOGIN_DOMAIN}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    supabase
      .from("profiles")
      .select("id, role, display_name, teacher_id")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        setProfile((data as Profile | null) ?? null);
        setLoading(false);
      });
  }, [userId]);

  const signIn = useCallback(async (loginId: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: loginIdToEmail(loginId), password });
    if (error) throw new Error("ログインIDかパスワードがちがうみたい。");
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ loading, session, profile, signIn, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
