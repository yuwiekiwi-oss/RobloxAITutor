// POST /functions/v1/line-login — sign a parent in with LINE Login (v2.1).
//
// The parent page sends the authorization `code` LINE gave it. We exchange it with the channel
// secret, verify the ID token with LINE, map the LINE user to a parent profile (claiming a
// one-time invite on first use), and return a one-time token hash the page turns into a normal
// Supabase session with `auth.verifyOtp`. After that, RLS works exactly as for any other user.
//
// Callers are not logged in yet, so this function runs with verify_jwt = false.
import { env } from "../_shared/env.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

type LineLoginRequest = { code: string; redirectUri: string; nonce: string; invite?: string };

const str = (v: unknown, max = 2000) => typeof v === "string" && v.length > 0 && v.length <= max;

async function linePost(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(401, "LINEでのログインに失敗しました。もう一度お試しください。", `${url}: ${JSON.stringify(body)}`);
  }
  return body as Record<string, unknown>;
}

serve(async (req) => {
  const body = await readJson<LineLoginRequest>(req);
  if (!str(body.code) || !str(body.redirectUri) || !str(body.nonce, 200)) {
    throw new HttpError(400, "ログイン情報が正しくありません。最初からやり直してください。");
  }

  // 1) Authorization code → tokens
  const tokens = await linePost("https://api.line.me/oauth2/v2.1/token", {
    grant_type: "authorization_code",
    code: body.code,
    redirect_uri: body.redirectUri,
    client_id: env.lineChannelId(),
    client_secret: env.lineChannelSecret(),
  });
  if (typeof tokens.id_token !== "string") throw new HttpError(401, "LINEでのログインに失敗しました。");

  // 2) Verify the ID token with LINE (audience = our channel, nonce = this login attempt)
  const claims = await linePost("https://api.line.me/oauth2/v2.1/verify", {
    id_token: tokens.id_token,
    client_id: env.lineChannelId(),
    nonce: body.nonce,
  });
  const lineUserId = claims.sub;
  if (typeof lineUserId !== "string" || !lineUserId) throw new HttpError(401, "LINEでのログインに失敗しました。");
  const lineName = typeof claims.name === "string" ? claims.name.slice(0, 100) : null;

  const db = adminClient();

  // 3) LINE user → parent profile
  const { data: linked } = await db
    .from("parent_line_accounts")
    .select("parent_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  let parentId: string | null = linked?.parent_id ?? null;

  if (!parentId && str(body.invite, 200)) {
    // Claim the invite atomically: only one LINE account can ever use it.
    const { data: invite } = await db
      .from("parent_invites")
      .update({ used_at: new Date().toISOString() })
      .eq("code", body.invite!)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("parent_id")
      .maybeSingle();
    if (!invite) {
      throw new HttpError(400, "招待リンクの有効期限が切れているか、すでに使われています。塾にお問い合わせください。");
    }

    const { data: profile } = await db.from("profiles").select("role").eq("id", invite.parent_id).single();
    if (profile?.role !== "parent") throw new HttpError(400, "この招待リンクは使えません。塾にお問い合わせください。");

    // A re-issued invite moves the parent to a new LINE account.
    await db.from("parent_line_accounts").delete().eq("parent_id", invite.parent_id);
    const { error } = await db
      .from("parent_line_accounts")
      .insert({ line_user_id: lineUserId, parent_id: invite.parent_id, line_name: lineName });
    if (error) throw new HttpError(409, "このLINEアカウントは別の保護者として登録されています。塾にお問い合わせください。", error.message);
    parentId = invite.parent_id;
  }

  if (!parentId) {
    throw new HttpError(403, "このLINEアカウントはまだ登録されていません。塾から届いた招待リンクから開いてください。");
  }

  // 4) Mint a one-time login for that parent (no email is sent).
  const { data: user, error: userError } = await db.auth.admin.getUserById(parentId);
  if (userError || !user.user?.email) throw new HttpError(500, "アカウントの設定に問題があります。塾にお問い合わせください。", userError?.message);
  const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: "magiclink", email: user.user.email });
  if (linkError || !link.properties?.hashed_token) {
    throw new HttpError(500, "ログインに失敗しました。もう一度お試しください。", linkError?.message);
  }

  return json(req, { tokenHash: link.properties.hashed_token });
});
