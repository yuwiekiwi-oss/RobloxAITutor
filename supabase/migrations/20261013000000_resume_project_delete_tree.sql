-- 1) An unfinished project from an earlier lesson is no longer reopened automatically. The student
--    picks 「つづきから作る」 on the start screen; this moves the project into today's session so the
--    teacher dashboard (which lists today's sessions) shows it again.
create or replace function public.resume_project(p_project_id uuid, p_session_id uuid)
returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
begin
  if not exists (select 1 from public.lesson_sessions
                 where id = p_session_id and student_id = auth.uid() and status = 'active') then
    raise exception 'session not active' using errcode = '22023';
  end if;
  update public.projects set session_id = p_session_id
   where id = p_project_id and student_id = auth.uid() and stage not in ('done', 'abandoned')
  returning * into p;
  if p.id is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  return p;
end
$$;
revoke execute on function public.resume_project(uuid, uuid) from public, anon;
grant execute on function public.resume_project(uuid, uuid) to authenticated;

-- 2) Students can delete their own saved Studio trees.
create policy "student_trees: delete own" on public.student_trees
  for delete to authenticated using (student_id = auth.uid());
grant delete on public.student_trees to authenticated;
