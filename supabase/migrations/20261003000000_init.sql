-- AI × Robloxプログラミング塾 Version 1.5 — initial schema
--
-- Trust model:
--   * Clients only READ through RLS.
--   * Small student actions go through SECURITY DEFINER RPCs (start_session, set_help_request, submit_check_answer).
--   * AI output, hint levels and summaries are written ONLY by Edge Functions (service role).

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         text not null check (role in ('student', 'teacher', 'parent')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  teacher_id   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint only_students_have_teacher check (teacher_id is null or role = 'student')
);
create index profiles_teacher_id_idx on public.profiles (teacher_id);

create table public.student_parent_links (
  student_id uuid not null references public.profiles (id) on delete cascade,
  parent_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, parent_id)
);
create index student_parent_links_parent_idx on public.student_parent_links (parent_id);

create table public.lessons (
  id         text primary key,
  title      text not null,
  goal       text not null,
  concepts   text[] not null default '{}',
  emoji      text not null default '🎮',
  sort_order int not null default 0,
  is_active  boolean not null default true
);

create table public.lesson_sessions (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.profiles (id) on delete cascade,
  lesson_id         text references public.lessons (id),
  goal_note         text,
  status            text not null default 'active' check (status in ('active', 'ended')),
  completed         boolean,
  help_requested_at timestamptz,
  current_concept   text,
  current_problem   text,
  started_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now(),
  ended_at          timestamptz
);
create unique index lesson_sessions_one_active_per_student
  on public.lesson_sessions (student_id) where status = 'active';
create index lesson_sessions_student_started_idx on public.lesson_sessions (student_id, started_at desc);

create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.lesson_sessions (id) on delete cascade,
  student_id  uuid not null references public.profiles (id) on delete cascade,
  role        text not null check (role in ('student', 'tutor')),
  message     text not null,
  code        text,
  -- Storage references only, never image bytes: [{"bucket":"screenshots","path":"<student>/<session>/<uuid>.jpg"}]
  attachments jsonb not null default '[]'::jsonb,
  intent      text check (intent in ('ask', 'more_hint', 'confused', 'solved')),
  hint_level  smallint check (hint_level between 0 and 4),
  -- tutor rows: {concept, problem, progress, check, model}
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index messages_session_created_idx on public.messages (session_id, created_at);
create index messages_student_created_idx on public.messages (student_id, created_at desc);

create table public.quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.lesson_sessions (id) on delete cascade,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  message_id   uuid not null references public.messages (id) on delete cascade,
  question     text not null,
  choice_index smallint not null,
  is_correct   boolean not null,
  created_at   timestamptz not null default now()
);
create index quiz_attempts_session_idx on public.quiz_attempts (session_id, created_at);
create index quiz_attempts_message_idx on public.quiz_attempts (message_id);

create table public.lesson_summaries (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null unique references public.lesson_sessions (id) on delete cascade,
  student_id            uuid not null references public.profiles (id) on delete cascade,
  -- AI-written (plain language for parents)
  created_today         text not null,
  learned               jsonb not null default '[]'::jsonb,
  struggled_with        jsonb not null default '[]'::jsonb,
  how_student_solved_it text not null,
  next_lesson           text not null,
  parent_summary        text not null,
  -- Measured values computed from the database, never by the AI
  metrics               jsonb not null,
  model                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index lesson_summaries_student_idx on public.lesson_summaries (student_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helper functions (private schema, not exposed through the API)
-- ---------------------------------------------------------------------------

create or replace function private.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid())
$$;

create or replace function private.my_teacher_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select teacher_id from public.profiles where id = (select auth.uid())
$$;

create or replace function private.is_teacher_of(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = p_student and role = 'student' and teacher_id = (select auth.uid())
  )
$$;

create or replace function private.is_parent_of(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.student_parent_links
    where student_id = p_student and parent_id = (select auth.uid())
  )
$$;

create or replace function private.can_view_student(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_student = (select auth.uid())
      or private.is_teacher_of(p_student)
      or private.is_parent_of(p_student)
$$;

-- Storage folder names are text; compare without casting so odd names never raise.
create or replace function private.can_view_student_folder(p_folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id::text = p_folder and private.can_view_student(p.id)
  )
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles             enable row level security;
alter table public.student_parent_links enable row level security;
alter table public.lessons              enable row level security;
alter table public.lesson_sessions      enable row level security;
alter table public.messages             enable row level security;
alter table public.quiz_attempts        enable row level security;
alter table public.lesson_summaries     enable row level security;

-- Nothing is readable without logging in.
revoke all on all tables in schema public from anon;

create policy "profiles: self, my students, my children, my teacher"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_teacher_of(id)
    or private.is_parent_of(id)
    or id = private.my_teacher_id()
  );

create policy "links: involved users and the student's teacher"
  on public.student_parent_links for select to authenticated
  using (
    parent_id = (select auth.uid())
    or student_id = (select auth.uid())
    or private.is_teacher_of(student_id)
  );

create policy "lessons: everyone logged in"
  on public.lessons for select to authenticated
  using (true);

create policy "sessions: visible students"
  on public.lesson_sessions for select to authenticated
  using (private.can_view_student(student_id));

create policy "messages: visible students"
  on public.messages for select to authenticated
  using (private.can_view_student(student_id));

create policy "quiz_attempts: visible students"
  on public.quiz_attempts for select to authenticated
  using (private.can_view_student(student_id));

create policy "summaries: visible students"
  on public.lesson_summaries for select to authenticated
  using (private.can_view_student(student_id));

-- No INSERT/UPDATE/DELETE policies on purpose: writes go through RPCs below or Edge Functions.

-- ---------------------------------------------------------------------------
-- RPCs for small student/teacher actions
-- ---------------------------------------------------------------------------

create or replace function public.start_session(p_lesson_id text default null, p_goal_note text default null)
returns public.lesson_sessions
language plpgsql security definer set search_path = '' as $$
declare
  s public.lesson_sessions;
begin
  if private.my_role() is distinct from 'student' then
    raise exception 'only students can start a lesson session' using errcode = '42501';
  end if;

  select * into s from public.lesson_sessions
  where student_id = auth.uid() and status = 'active';
  if found then
    return s;
  end if;

  insert into public.lesson_sessions (student_id, lesson_id, goal_note)
  values (auth.uid(), p_lesson_id, nullif(left(btrim(coalesce(p_goal_note, '')), 200), ''))
  returning * into s;
  return s;
end
$$;

-- Student raises/lowers their hand; the teacher can clear it after helping.
create or replace function public.set_help_request(p_session_id uuid, p_on boolean)
returns public.lesson_sessions
language plpgsql security definer set search_path = '' as $$
declare
  s public.lesson_sessions;
begin
  update public.lesson_sessions
     set help_requested_at = case when p_on then now() else null end,
         last_activity_at  = case when student_id = auth.uid() then now() else last_activity_at end
   where id = p_session_id
     and status = 'active'
     and (student_id = auth.uid() or private.is_teacher_of(student_id))
  returning * into s;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  return s;
end
$$;

-- Multiple-choice understanding check. Correctness is decided here from the stored tutor message,
-- so quiz results are measured values, not something the AI or the client claims.
create or replace function public.submit_check_answer(p_message_id uuid, p_choice int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m        public.messages;
  chk      jsonb;
  ok       boolean;
  attempts int;
begin
  select * into m from public.messages
  where id = p_message_id and role = 'tutor' and student_id = auth.uid();
  if not found then
    raise exception 'check not found' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.lesson_sessions where id = m.session_id and status = 'active') then
    raise exception 'session already ended' using errcode = '22023';
  end if;

  chk := m.meta -> 'check';
  if chk is null or jsonb_typeof(chk) <> 'object' then
    raise exception 'message has no check' using errcode = '22023';
  end if;
  if p_choice < 0 or p_choice >= jsonb_array_length(chk -> 'choices') then
    raise exception 'invalid choice' using errcode = '22023';
  end if;

  if exists (select 1 from public.quiz_attempts where message_id = p_message_id and is_correct) then
    select count(*) into attempts from public.quiz_attempts where message_id = p_message_id;
    return jsonb_build_object('is_correct', true, 'already_solved', true, 'attempts', attempts,
                              'explanation', chk ->> 'explanation');
  end if;

  ok := p_choice = (chk ->> 'answer_index')::int;

  insert into public.quiz_attempts (session_id, student_id, message_id, question, choice_index, is_correct)
  values (m.session_id, m.student_id, m.id, chk ->> 'question', p_choice, ok);

  update public.lesson_sessions set last_activity_at = now() where id = m.session_id;

  select count(*) into attempts from public.quiz_attempts where message_id = p_message_id;

  return jsonb_build_object(
    'is_correct', ok,
    'already_solved', false,
    'attempts', attempts,
    'explanation', case when ok then chk ->> 'explanation' else null end
  );
end
$$;

revoke execute on function public.start_session(text, text)        from public, anon;
revoke execute on function public.set_help_request(uuid, boolean)  from public, anon;
revoke execute on function public.submit_check_answer(uuid, int)   from public, anon;
grant  execute on function public.start_session(text, text)        to authenticated;
grant  execute on function public.set_help_request(uuid, boolean)  to authenticated;
grant  execute on function public.submit_check_answer(uuid, int)   to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: Roblox Studio screenshots (private bucket, path = <student_id>/<session_id>/<file>)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "screenshots: students upload into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.my_role() = 'student'
  );

create policy "screenshots: visible students"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'screenshots'
    and private.can_view_student_folder((storage.foldername(name))[1])
  );
