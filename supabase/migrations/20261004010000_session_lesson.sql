-- Students start asking right away; the lesson is optional and can be picked (or changed) later.

-- The app opens a session automatically on login, so make start_session safe under concurrent calls.
create or replace function public.start_session(p_lesson_id text default null, p_goal_note text default null)
returns public.lesson_sessions
language plpgsql security definer set search_path = '' as $$
declare
  s public.lesson_sessions;
begin
  if private.my_role() is distinct from 'student' then
    raise exception 'only students can start a lesson session' using errcode = '42501';
  end if;

  insert into public.lesson_sessions (student_id, lesson_id, goal_note)
  values (auth.uid(), p_lesson_id, nullif(left(btrim(coalesce(p_goal_note, '')), 200), ''))
  on conflict (student_id) where status = 'active' do nothing;

  select * into s from public.lesson_sessions
  where student_id = auth.uid() and status = 'active';
  return s;
end
$$;
create or replace function public.set_session_lesson(p_session_id uuid, p_lesson_id text)
returns public.lesson_sessions
language plpgsql security definer set search_path = '' as $$
declare
  s public.lesson_sessions;
begin
  update public.lesson_sessions
     set lesson_id = p_lesson_id,
         last_activity_at = now()
   where id = p_session_id
     and status = 'active'
     and student_id = auth.uid()
  returning * into s;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  return s;
end
$$;

revoke execute on function public.set_session_lesson(uuid, text) from public, anon;
grant  execute on function public.set_session_lesson(uuid, text) to authenticated;
