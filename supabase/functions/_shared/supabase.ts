import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { env } from "./env.ts";
import { HttpError } from "./http.ts";

let admin: SupabaseClient | undefined;

/** Service-role client. Bypasses RLS — always authorize the caller in code first. */
export function adminClient(): SupabaseClient {
  admin ??= createClient(env.supabaseUrl(), env.serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export type Profile = {
  id: string;
  role: "student" | "teacher" | "parent";
  display_name: string;
  teacher_id: string | null;
};

/** Validates the caller's JWT and loads their profile. */
export async function requireUser(req: Request): Promise<{ user: User; profile: Profile }> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "ログインしてください。");

  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "ログインの期限が切れました。もう一度ログインしてね。");

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, role, display_name, teacher_id")
    .eq("id", data.user.id)
    .single<Profile>();
  if (profileError || !profile) throw new HttpError(403, "アカウントの設定がまだ終わっていません。先生に伝えてね。");

  return { user: data.user, profile };
}
