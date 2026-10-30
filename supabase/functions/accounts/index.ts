// POST /functions/v1/accounts — account management from the teacher dashboard.
//   list:         accounts the caller may manage (login IDs included)
//   set_password: give an account a new password
//   set_admin:    make a teacher an admin (or not) — admins only
// Who may manage whom:
//   * a teacher: themself and their own students
//   * an admin teacher (profiles.is_admin): every teacher and every student
import { type AccountRow, type AccountsList, type AccountsRequest, PASSWORD_MIN } from "../_shared/contracts.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

type ProfileRow = {
  id: string;
  role: "teacher" | "student";
  display_name: string;
  teacher_id: string | null;
  is_admin: boolean;
};

const LOGIN_DOMAIN = Deno.env.get("LOGIN_DOMAIN") ?? "juku.local";

/** "taro@juku.local" → "taro" (other addresses are shown as they are). */
const loginId = (email: string | undefined) =>
  !email ? "" : email.toLowerCase().endsWith(`@${LOGIN_DOMAIN.toLowerCase()}`) ? email.slice(0, -(LOGIN_DOMAIN.length + 1)) : email;

serve(async (req) => {
  const { user, profile } = await requireUser(req);
  if (profile.role !== "teacher") throw new HttpError(403, "先生のアカウントで使えます。");
  const body = await readJson<AccountsRequest>(req);
  const db = adminClient();

  const { data: me } = await db.from("profiles").select("is_admin").eq("id", user.id).single();
  let isAdmin = Boolean(me?.is_admin);
  // A school with no admin yet (fresh install): the first teacher to open this becomes the admin.
  if (!isAdmin) {
    const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true);
    if ((count ?? 0) === 0) {
      const { error: bootError } = await db.from("profiles").update({ is_admin: true }).eq("id", user.id);
      if (!bootError) isAdmin = true;
    }
  }

  // Everyone the caller may manage.
  let q = db.from("profiles").select("id, role, display_name, teacher_id, is_admin").in("role", ["teacher", "student"]);
  if (!isAdmin) q = q.or(`id.eq.${user.id},teacher_id.eq.${user.id}`);
  const { data: rows, error } = await q.order("role", { ascending: false }).order("display_name");
  if (error) throw new HttpError(500, "アカウントを読みこめませんでした。", error.message);
  const manageable = (rows ?? []) as ProfileRow[];
  const byId = new Map(manageable.map((p) => [p.id, p]));

  // ------------------------------------------------------------------ list
  if (body.action === "list") {
    const emails = new Map<string, string>();
    for (let page = 1; page <= 20; page++) {
      const { data, error: listError } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (listError) throw new HttpError(500, "ログインIDを読みこめませんでした。", listError.message);
      for (const u of data.users) emails.set(u.id, u.email ?? "");
      if (data.users.length < 1000) break;
    }
    // Teacher names for "担当" (an admin sees all teachers; a teacher is the only teacher of their students).
    const teacherNames = new Map(manageable.filter((p) => p.role === "teacher").map((p) => [p.id, p.display_name]));
    const accounts: AccountRow[] = manageable.map((p) => ({
      id: p.id,
      role: p.role,
      display_name: p.display_name,
      login_id: loginId(emails.get(p.id)),
      is_admin: p.is_admin,
      teacher_name: p.teacher_id ? teacherNames.get(p.teacher_id) ?? null : null,
      is_self: p.id === user.id,
    }));
    const result: AccountsList = { accounts, isAdmin };
    return json(req, result);
  }

  const target = typeof body.userId === "string" ? byId.get(body.userId) : undefined;
  if (!target) throw new HttpError(403, "このアカウントは変えられません。");

  // ------------------------------------------------------------------ set_password
  if (body.action === "set_password") {
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < PASSWORD_MIN || password.length > 72) {
      throw new HttpError(400, `パスワードは${PASSWORD_MIN}〜72文字にしてください。`);
    }
    if (/\s/.test(password)) throw new HttpError(400, "パスワードにスペースは使えません。");
    const { error: updateError } = await db.auth.admin.updateUserById(target.id, { password });
    if (updateError) throw new HttpError(400, "パスワードを変えられませんでした。", updateError.message);
    return json(req, { ok: true });
  }

  // ------------------------------------------------------------------ set_admin
  if (body.action === "set_admin") {
    if (!isAdmin) throw new HttpError(403, "管理者の先生だけが変えられます。");
    if (target.role !== "teacher") throw new HttpError(400, "管理者にできるのは先生だけです。");
    const makeAdmin = body.isAdmin === true;
    if (!makeAdmin) {
      const admins = manageable.filter((p) => p.is_admin);
      if (admins.length <= 1 && target.is_admin) throw new HttpError(409, "管理者が1人もいなくなるので外せません。");
    }
    const { error: adminError } = await db.from("profiles").update({ is_admin: makeAdmin }).eq("id", target.id);
    if (adminError) throw new HttpError(500, "変えられませんでした。", adminError.message);
    return json(req, { ok: true });
  }

  throw new HttpError(400, "リクエストの形が正しくありません。");
});
