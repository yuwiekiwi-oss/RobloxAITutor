-- Account management from the teacher dashboard (Edge Function `accounts`, service role).
--   * Every teacher can change their own password and their own students' passwords.
--   * Admin teachers (管理者) can change every teacher's and student's password, and make other
--     teachers admins.
-- Clients cannot write profiles (no update policy), so nobody can make themselves an admin.
alter table public.profiles
  add column is_admin boolean not null default false,
  add constraint only_teachers_are_admins check (not is_admin or role = 'teacher');

-- Start with one admin: the first teacher account that was created.
update public.profiles
   set is_admin = true
 where id = (select id from public.profiles where role = 'teacher' order by created_at, id limit 1)
   and not exists (select 1 from public.profiles where is_admin);
