#!/usr/bin/env node
// Creates/updates teacher, student and parent accounts from a JSON file.
// Public sign-up is disabled, so this (service role) is how accounts are made.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-users.mjs scripts/users.json
//
// Students/teachers without "password" get a generated one, written to scripts/users.credentials.csv (git-ignored).
// Parents have no password: they sign in to the parent page with LINE. Each parent who has not linked LINE yet
// gets a one-time invite link (valid 14 days) in the same CSV. Set PARENT_APP_URL to print full links.
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const domain = process.env.LOGIN_DOMAIN ?? "juku.local";
const parentAppUrl = process.env.PARENT_APP_URL; // e.g. https://you.github.io/repo/parent/
const file = process.argv[2];
if (!url || !serviceKey || !file) {
  console.error("Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-users.mjs <users.json>");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const spec = JSON.parse(readFileSync(file, "utf8"));
const toEmail = (login) => (login.includes("@") ? login : `${login}@${domain}`).toLowerCase();

// Readable passwords for kids: no 0/O/1/l/I.
const WORDS = ["block", "brick", "coin", "door", "jump", "lava", "part", "star", "tool", "wave", "robo", "cube"];
const genPassword = () => `${WORDS[randomInt(WORDS.length)]}-${WORDS[randomInt(WORDS.length)]}-${randomInt(100, 999)}`;

async function findUserByEmail(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit || data.users.length < 1000) return hit ?? null;
  }
}

const credentials = [];
const idByLogin = new Map();

async function upsertAccount(entry, role, teacherId = null) {
  const email = toEmail(entry.login);
  let user = await findUserByEmail(email);
  let password = entry.password;
  if (!user) {
    // Parents never type a password (LINE login), so theirs is random and not written anywhere.
    password ||= role === "parent" ? randomBytes(24).toString("base64url") : genPassword();
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`${entry.login}: ${error.message}`);
    user = data.user;
    if (role !== "parent") credentials.push([role, entry.name, entry.login, password]);
  } else if (entry.password && role !== "parent") {
    const { error } = await db.auth.admin.updateUserById(user.id, { password: entry.password });
    if (error) throw new Error(`${entry.login}: ${error.message}`);
  }

  const { error } = await db.from("profiles").upsert({
    id: user.id,
    role,
    display_name: entry.name,
    teacher_id: role === "student" ? teacherId : null,
  });
  if (error) throw new Error(`${entry.login}: ${error.message}`);
  idByLogin.set(entry.login, user.id);
  console.log(`✔ ${role.padEnd(7)} ${entry.name} (${entry.login})`);
}

for (const t of spec.teachers ?? []) await upsertAccount(t, "teacher");
for (const s of spec.students ?? []) {
  const teacherId = s.teacher ? idByLogin.get(s.teacher) : null;
  if (s.teacher && !teacherId) throw new Error(`${s.login}: unknown teacher "${s.teacher}"`);
  await upsertAccount(s, "student", teacherId);
}
for (const p of spec.parents ?? []) {
  await upsertAccount(p, "parent");
  for (const child of p.children ?? []) {
    const studentId = idByLogin.get(child);
    if (!studentId) throw new Error(`${p.login}: unknown child "${child}"`);
    const { error } = await db
      .from("student_parent_links")
      .upsert({ student_id: studentId, parent_id: idByLogin.get(p.login) });
    if (error) throw new Error(`${p.login}: ${error.message}`);
  }

  // LINE invite for parents who have not linked yet.
  const parentId = idByLogin.get(p.login);
  const { data: linked } = await db.from("parent_line_accounts").select("parent_id").eq("parent_id", parentId).maybeSingle();
  if (!linked) {
    const code = randomBytes(18).toString("base64url");
    const { error: inviteError } = await db.from("parent_invites").insert({ code, parent_id: parentId });
    if (inviteError) throw new Error(`${p.login}: ${inviteError.message}`);
    const link = parentAppUrl ? `${parentAppUrl}${parentAppUrl.includes("?") ? "&" : "?"}invite=${code}` : `invite=${code}`;
    credentials.push(["parent", p.name, p.login, link]);
  }
}

if (credentials.length) {
  const out = new URL("./users.credentials.csv", import.meta.url);
  const csv = ["role,name,login,password_or_parent_invite_link", ...credentials.map((r) => r.join(","))].join("\n");
  writeFileSync(out, "﻿" + csv + "\n");
  console.log(`\n${credentials.length} row(s) written to scripts/users.credentials.csv (passwords / parent invite links)`);
}
