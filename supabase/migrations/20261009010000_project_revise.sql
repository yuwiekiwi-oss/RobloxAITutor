-- Changing an open project from the chat ("床じゃなくて壁にしたい"): the `project` Edge Function
-- re-plans and builds the project again. Before that, this clears the old code and its gates.
--
-- Mastery is kept: concept_events / student_concepts are measured results and stay as they are,
-- so the rebuilt code is again shown by the student's current level (explain / blank / write / given).
-- Attempts on the old gates are removed, since the new gates reuse the same item names.
create or replace function public.reset_project_for_revision(p_project_id uuid)
returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
begin
  select * into p from public.projects where id = p_project_id for update;
  if p.id is null or p.stage in ('done', 'abandoned') then
    raise exception 'project cannot be revised';
  end if;

  delete from public.project_attempts where project_id = p.id;
  delete from public.project_keys     where project_id = p.id;
  delete from public.project_blocks   where project_id = p.id;

  update public.projects
     set stage = 'plan', stage_changed_at = now(),
         placement = '{}'::jsonb, predict = null, tweak = null,
         ran_ok_at = null, run_failed_at = null
   where id = p.id
  returning * into p;
  return p;
end
$$;

revoke execute on function public.reset_project_for_revision(uuid) from public, anon, authenticated;
grant execute on function public.reset_project_for_revision(uuid) to service_role;
