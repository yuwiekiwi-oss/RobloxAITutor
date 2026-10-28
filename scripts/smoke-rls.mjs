#!/usr/bin/env node
// Verifies Row Level Security / RPC rules against a real Supabase (use a LOCAL or throwaway project:
// it creates test users). Run:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/smoke-rls.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, opts);
const tag = Date.now().toString(36);
const password = `pw-${tag}-Xy9`;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✘"} ${name}${!ok && detail ? `  → ${detail}` : ""}`);
};

async function makeUser(name, role, teacherId = null) {
  const email = `${name}-${tag}@smoke.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const { error: pErr } = await admin.from("profiles").insert({ id: data.user.id, role, display_name: name, teacher_id: teacherId });
  if (pErr) throw pErr;
  const client = createClient(url, anonKey, opts);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;
  return { id: data.user.id, client };
}

const tA = await makeUser("teacherA", "teacher");
const tB = await makeUser("teacherB", "teacher");
const s1 = await makeUser("student1", "student", tA.id);
const s2 = await makeUser("student2", "student", tB.id);
const p1 = await makeUser("parent1", "parent");
await admin.from("student_parent_links").insert({ student_id: s1.id, parent_id: p1.id });

// --- anon ---
const anon = createClient(url, anonKey, opts);
const anonLessons = await anon.from("lessons").select("id");
check("anon cannot read lessons", (anonLessons.data ?? []).length === 0);

// --- sessions ---
const { data: sess1, error: e1 } = await s1.client.rpc("start_session", { p_lesson_id: "kill-brick", p_goal_note: "床" });
check("student can start a session", !e1 && sess1?.student_id === s1.id, e1?.message);
const again = await s1.client.rpc("start_session", { p_lesson_id: "click-door" });
check("start_session returns the existing active session", again.data?.id === sess1.id);
const { data: sess2 } = await s2.client.rpc("start_session", { p_lesson_id: "free" });
const pStart = await p1.client.rpc("start_session", { p_lesson_id: "free" });
check("parent cannot start a session", Boolean(pStart.error));

const directInsert = await s1.client.from("lesson_sessions").insert({ student_id: s1.id });
check("student cannot insert sessions directly", Boolean(directInsert.error));
const upd = await s1.client.from("lesson_sessions").update({ status: "ended" }).eq("id", sess1.id).select();
check("student cannot update sessions directly", (upd.data ?? []).length === 0);

// --- messages (written by the Edge Function = service role) ---
const fake = await s1.client.from("messages").insert({ session_id: sess1.id, student_id: s1.id, role: "tutor", message: "x", hint_level: 4 });
check("student cannot write tutor messages / hint levels", Boolean(fake.error));
const { data: tutorMsg } = await admin.from("messages").insert({
  session_id: sess1.id, student_id: s1.id, role: "tutor", message: "クイズ", hint_level: 2,
  meta: { check: { question: "Q", choices: ["a", "b", "c"], answer_index: 1, explanation: "e" } },
}).select().single();

// --- visibility ---
const count = async (client, table, col, val) => ((await client.from(table).select("*").eq(col, val)).data ?? []).length;
check("student sees own messages", (await count(s1.client, "messages", "session_id", sess1.id)) === 1);
check("other student cannot see messages", (await count(s2.client, "messages", "session_id", sess1.id)) === 0);
check("other student cannot see session", (await count(s2.client, "lesson_sessions", "id", sess1.id)) === 0);
check("own teacher sees session", (await count(tA.client, "lesson_sessions", "id", sess1.id)) === 1);
check("other teacher cannot see session", (await count(tB.client, "lesson_sessions", "id", sess1.id)) === 0);
check("own teacher sees student profile", (await count(tA.client, "profiles", "id", s1.id)) === 1);
check("other teacher cannot see student profile", (await count(tB.client, "profiles", "id", s1.id)) === 0);
check("parent sees child's messages", (await count(p1.client, "messages", "session_id", sess1.id)) === 1);
check("parent cannot see other child's session", (await count(p1.client, "lesson_sessions", "id", sess2.id)) === 0);
check("student sees their teacher's name", (await count(s1.client, "profiles", "id", tA.id)) === 1);
check("student cannot see other teachers", (await count(s1.client, "profiles", "id", tB.id)) === 0);

const roleHack = await s1.client.from("profiles").update({ role: "teacher" }).eq("id", s1.id).select();
check("student cannot change own role", (roleHack.data ?? []).length === 0);

// --- understanding check RPC ---
const wrong = await s1.client.rpc("submit_check_answer", { p_message_id: tutorMsg.id, p_choice: 0 });
check("wrong answer recorded as incorrect", wrong.data?.is_correct === false, wrong.error?.message);
const right = await s1.client.rpc("submit_check_answer", { p_message_id: tutorMsg.id, p_choice: 1 });
check("right answer recorded as correct", right.data?.is_correct === true && right.data?.attempts === 2, JSON.stringify(right));
const steal = await s2.client.rpc("submit_check_answer", { p_message_id: tutorMsg.id, p_choice: 1 });
check("other student cannot answer someone else's check", Boolean(steal.error));
const fakeAttempt = await s1.client.from("quiz_attempts").insert({ session_id: sess1.id, student_id: s1.id, message_id: tutorMsg.id, question: "", choice_index: 1, is_correct: true });
check("student cannot insert quiz attempts directly", Boolean(fakeAttempt.error));
check("teacher sees quiz attempts", (await count(tA.client, "quiz_attempts", "session_id", sess1.id)) === 2);

// --- help request ---
const help = await s1.client.rpc("set_help_request", { p_session_id: sess1.id, p_on: true });
check("student can call the teacher", Boolean(help.data?.help_requested_at), help.error?.message);
const otherClear = await tB.client.rpc("set_help_request", { p_session_id: sess1.id, p_on: false });
check("other teacher cannot clear the call", Boolean(otherClear.error));
const clear = await tA.client.rpc("set_help_request", { p_session_id: sess1.id, p_on: false });
check("own teacher can clear the call", clear.data?.help_requested_at === null, clear.error?.message);

// --- storage ---
const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });
const ownPath = `${s1.id}/${sess1.id}/a.png`;
const up = await s1.client.storage.from("screenshots").upload(ownPath, png, { contentType: "image/png" });
check("student uploads into own folder", !up.error, up.error?.message);
const upOther = await s1.client.storage.from("screenshots").upload(`${s2.id}/${sess2.id}/x.png`, png, { contentType: "image/png" });
check("student cannot upload into another student's folder", Boolean(upOther.error));
const signT = await tA.client.storage.from("screenshots").createSignedUrl(ownPath, 60);
check("own teacher can view screenshot", Boolean(signT.data?.signedUrl), signT.error?.message);
const signOther = await s2.client.storage.from("screenshots").createSignedUrl(ownPath, 60);
check("other student cannot view screenshot", !signOther.data?.signedUrl);
const signParent = await p1.client.storage.from("screenshots").createSignedUrl(ownPath, 60);
check("parent can view child's screenshot", Boolean(signParent.data?.signedUrl), signParent.error?.message);

// --- cleanup ---
await admin.storage.from("screenshots").remove([ownPath]);
for (const u of [tA, tB, s1, s2, p1]) await admin.auth.admin.deleteUser(u.id);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll RLS checks passed");
process.exit(failures ? 1 : 0);
