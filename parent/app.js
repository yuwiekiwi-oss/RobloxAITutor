// Parent page (plain HTML + JS, no build step).
// Sign-in: LINE Login → Edge Function `line-login` → one-time token → Supabase session.
// Data: read-only through Supabase RLS (a parent only sees their own children).
// Add ?demo=1 to the URL to see the page with sample data and no backend.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

const app = document.getElementById("app");
const logoutBtn = document.getElementById("logout");
const params = new URLSearchParams(location.search);
const pageUrl = location.origin + location.pathname; // must match the LINE Login callback URL exactly
const cfg = window.APP_CONFIG ?? {};
const demo = params.has("demo");

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const formatDate = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
};
const randomString = () => {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
};
const store = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};
const show = (html) => { app.innerHTML = html; };
function showError(message) {
  show(`<div class="notice error"><p>${esc(message)}</p><button class="btn-outline" id="retry">ログイン画面にもどる</button></div>`);
  document.getElementById("retry").addEventListener("click", () => { location.href = pageUrl; });
}

// ---------- icons (same stroke style as the student app; no emoji) ----------
const svg = (body, size = 18) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  book: (s) => svg(`<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>`, s),
  code: (s) => svg(`<path d="M8.5 6.5 3 12l5.5 5.5M15.5 6.5 21 12l-5.5 5.5"/>`, s),
  chart: (s) => svg(`<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`, s),
  spark: (s) => svg(`<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>`, s),
  check: (s) => svg(`<path d="m5 12.5 4.5 4.5L19 7.5"/>`, s),
};

// ---------- views ----------
function renderLogin({ invited }) {
  show(`
    <section class="login">
      <div class="login-icon" aria-hidden="true">${ICON.book(30)}</div>
      <h2>${invited ? "LINEと連携してください" : "ログイン"}</h2>
      <p>${invited
        ? "塾からの招待リンクを開きました。<br>LINEでログインすると、お子さまの授業の記録が見られるようになります。<br>（次回からはLINEでログインするだけです）"
        : "お子さまの授業の記録を見るには、LINEでログインしてください。"}</p>
      <button class="btn-line" id="line-login"><span class="line-mark" aria-hidden="true">LINE</span>LINEでログイン</button>
      <p class="small">LINEのプロフィール（表示名）だけを使います。メッセージが送られることはありません。</p>
    </section>`);
  document.getElementById("line-login").addEventListener("click", startLineLogin);
}

function startLineLogin() {
  if (!cfg.lineChannelId) return showError("LINEログインの設定（config.js）がまだです。塾にお問い合わせください。");
  const state = randomString();
  const nonce = randomString();
  store.set("line_state", state);
  store.set("line_nonce", nonce);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: cfg.lineChannelId,
    redirect_uri: pageUrl,
    state,
    scope: "openid profile",
    nonce,
  });
  location.href = `https://access.line.me/oauth2/v2.1/authorize?${q}`;
}

const LEVEL_NAMES = ["初見", "一度習った", "思い出せる", "自分で書ける"];

function metricsHtml(m) {
  const done = m.completed === true ? "できた" : m.completed === false ? "とちゅう" : "—";
  const ups = m.concepts_up ?? [];
  const works = m.works ?? [];
  const lines = (code) => code.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).length;
  return `
    <section class="metrics" aria-label="記録（実測値）">
      <h3>${ICON.chart(15)} 記録（実測値）</h3>
      <dl>
        <div><dt>学習時間</dt><dd>${m.minutes}<small>分</small></dd></div>
        ${m.tests_total
          ? `<div><dt>コードのテスト</dt><dd>${m.tests_solved}<small>/${m.tests_total}問 正解</small></dd></div>`
          : m.checks_total
          ? `<div><dt>理解チェック</dt><dd>${m.checks_solved}<small>/${m.checks_total}問 正解</small></dd></div>`
          : ""}
        ${m.typed_lines ? `<div><dt>手で打ちこんだコード</dt><dd>${m.typed_lines}<small>行</small></dd></div>` : ""}
        ${m.written_by_self ? `<div><dt>自分で書けたところ</dt><dd>${m.written_by_self}<small>か所</small></dd></div>` : ""}
        <div><dt>AIへの質問</dt><dd>${m.questions}<small>回</small></dd></div>
        ${m.hints_used ? `<div><dt>ヒント使用</dt><dd>${m.hints_used}<small>回</small></dd></div>` : ""}
        <div><dt>課題</dt><dd class="done">${done}</dd></div>
        ${m.projects_completed ? `<div><dt>完成した作品</dt><dd>${m.projects_completed}<small>個</small></dd></div>` : ""}
      </dl>
      ${m.tests_total ? `<p class="small">コードのテストのうち、1回目で正解：${m.tests_first_try}問</p>`
        : m.checks_total > 0 ? `<p class="small">うち1回目で正解：${m.checks_correct_first_try}問</p>` : ""}
      ${ups.length ? `
        <div class="ups">
          <p class="ups-title">記録でわかった「できるようになったこと」</p>
          <ul>${ups.map((u) => `<li><span>${esc(u.name)}</span><b>${esc(LEVEL_NAMES[u.level] ?? "")}</b></li>`).join("")}</ul>
        </div>` : ""}
      ${works.map((w) => `
        <details class="work">
          <summary>${ICON.code(15)}<span class="work-title">今日書いたコード<b>${esc(w.title)}・${lines(w.code)}行</b></span></summary>
          <pre class="work-code"><code>${esc(w.code)}</code></pre>
          <p class="small">お子さまが説明を読みながら打ちこんだり、自分で書いたりしたコードです。</p>
        </details>`).join("")}
    </section>`;
}

function listHtml(title, items) {
  if (!items?.length) return "";
  return `<div class="block"><h3>${title}</h3><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
}

function cardHtml(s, lessons, open) {
  const lesson = lessons.find((l) => l.id === s.session?.lesson_id);
  return `
    <article class="card">
      <header class="card-head">
        <div class="date">${formatDate(s.session?.started_at ?? s.created_at)}</div>
        ${lesson ? `<div class="lesson">${ICON.book(14)} ${esc(lesson.title)}</div>` : ""}
      </header>
      <section class="ai">
        <div class="made"><span class="k">今日作ったもの</span><span class="v">${esc(s.created_today)}</span></div>
        <p class="overview">${esc(s.parent_summary)}</p>
        <details ${open ? "open" : ""}>
          <summary><span class="when-closed">くわしく見る</span><span class="when-open">閉じる</span></summary>
          ${listHtml("今日学んだこと", s.learned)}
          ${listHtml("苦戦したところ", s.struggled_with)}
          <div class="block"><h3>どう解決した？</h3><p>${esc(s.how_student_solved_it)}</p></div>
          <div class="block"><h3>次回</h3><p>${esc(s.next_lesson)}</p></div>
        </details>
        <p class="ai-note">${ICON.spark(14)} この文章は、授業の記録をもとにAIが作成したまとめです。</p>
      </section>
      ${metricsHtml(s.metrics)}
    </article>`;
}

function renderFamily(family, selectedId) {
  const { children, summaries, activeSessions, lessons } = family;
  if (children.length === 0) {
    return show(`<div class="notice">お子さまのアカウントがまだ紐づいていません。塾にお問い合わせください。</div>`);
  }
  const childId = selectedId ?? children[0].id;
  const child = children.find((c) => c.id === childId);
  const mine = summaries.filter((s) => s.student_id === childId);
  const live = activeSessions.some((s) => s.student_id === childId);

  show(`
    ${children.length > 1 ? `<nav class="tabs">${children.map((c) =>
      `<button data-child="${esc(c.id)}" class="${c.id === childId ? "active" : ""}">${esc(c.display_name)}さん</button>`).join("")}</nav>` : ""}
    <h2 class="child">${esc(child.display_name)}さんの授業</h2>
    ${live ? `<div class="live"><span class="dot"></span>ただいま授業中です</div>` : ""}
    ${mine.length === 0 && !live ? `<div class="notice">まだ授業の記録はありません。</div>` : ""}
    ${mine.map((s, i) => cardHtml(s, lessons, i === 0)).join("")}
  `);
  app.querySelectorAll("[data-child]").forEach((b) =>
    b.addEventListener("click", () => renderFamily(family, b.dataset.child))
  );
}

// ---------- data ----------
async function loadFamily(db, parentId) {
  const fail = (e) => { if (e) throw new Error("記録を読みこめませんでした。時間をおいて開き直してください。"); };
  const links = await db.from("student_parent_links").select("student_id").eq("parent_id", parentId);
  fail(links.error);
  const ids = links.data.map((l) => l.student_id);
  const lessons = (await db.from("lessons").select("id, title, emoji")).data ?? [];
  if (ids.length === 0) return { children: [], summaries: [], activeSessions: [], lessons };

  const [kids, sums, sessions] = await Promise.all([
    db.from("profiles").select("id, display_name").in("id", ids).order("display_name"),
    db.from("lesson_summaries").select("*").in("student_id", ids).order("created_at", { ascending: false }).limit(60),
    db.from("lesson_sessions").select("id, student_id, lesson_id, status, started_at").in("student_id", ids)
      .order("started_at", { ascending: false }).limit(100),
  ]);
  fail(kids.error || sums.error || sessions.error);
  const byId = new Map(sessions.data.map((s) => [s.id, s]));
  return {
    children: kids.data,
    summaries: sums.data.map((s) => ({ ...s, session: byId.get(s.session_id) ?? null })),
    activeSessions: sessions.data.filter((s) => s.status === "active"),
    lessons,
  };
}

// ---------- main ----------
async function main() {
  if (demo) {
    const { demoFamily } = await import("./demo.js");
    return renderFamily(demoFamily());
  }
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    return show(`<div class="notice error">設定ファイル（config.js）がありません。塾にお問い合わせください。</div>`);
  }

  const db = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const invite = params.get("invite");
  if (invite) store.set("line_invite", invite);

  // Coming back from LINE
  if (params.has("code") || params.has("error")) {
    history.replaceState(null, "", pageUrl); // drop code/state from the address bar
    if (params.get("error")) return showError("LINEでのログインがキャンセルされました。");
    if (params.get("state") !== store.get("line_state")) return showError("ログインの確認に失敗しました。もう一度お試しください。");
    show(`<div class="notice">ログイン中…</div>`);

    const { data, error } = await db.functions.invoke("line-login", {
      body: {
        code: params.get("code"),
        redirectUri: pageUrl,
        nonce: store.get("line_nonce"),
        invite: store.get("line_invite") ?? undefined,
      },
    });
    store.del("line_state");
    store.del("line_nonce");
    if (error) {
      const payload = await error.context?.json?.().catch(() => null);
      return showError(payload?.error ?? "ログインに失敗しました。もう一度お試しください。");
    }
    store.del("line_invite");
    const { error: otpError } = await db.auth.verifyOtp({ token_hash: data.tokenHash, type: "magiclink" });
    if (otpError) return showError("ログインに失敗しました。もう一度お試しください。");
  }

  const { data: { session } } = await db.auth.getSession();
  if (!session) return renderLogin({ invited: Boolean(store.get("line_invite")) });

  logoutBtn.hidden = false;
  logoutBtn.onclick = async () => {
    await db.auth.signOut();
    location.href = pageUrl;
  };

  const { data: me } = await db.from("profiles").select("role").eq("id", session.user.id).maybeSingle();
  if (me?.role !== "parent") {
    await db.auth.signOut();
    return showError("このページは保護者の方専用です。");
  }

  show(`<div class="notice">読みこみ中…</div>`);
  try {
    renderFamily(await loadFamily(db, session.user.id));
  } catch (e) {
    showError(e.message);
  }
}

main().catch((e) => {
  console.error(e);
  showError("エラーが起きました。時間をおいて開き直してください。");
});
