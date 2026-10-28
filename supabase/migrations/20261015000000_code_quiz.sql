-- テスト becomes a code test: "こうしたい！どう変える？" with a piece of the student's code to change.
-- Answers are code, graded in the Edge Function (exact match first, then AI先生) and recorded here.
-- Projects without a tweak (いじる) question finish right after the test.

create or replace function private.refresh_project_stage(p_project uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
  next_stage text;
  has_quiz boolean;
begin
  select * into p from public.projects where id = p_project;
  if not found or p.stage in ('plan', 'done', 'abandoned') then
    return p.stage;
  end if;
  select exists (select 1 from public.project_keys where project_id = p.id and item like 'quiz:%') into has_quiz;

  next_stage := case
    when exists (select 1 from public.project_blocks where project_id = p.id and not build_done) then 'build'
    when exists (select 1 from public.project_keys where project_id = p.id and item = 'predict')
         and not exists (select 1 from public.project_attempts
                         where project_id = p.id and item = 'predict' and (correct or assisted)) then 'predict'
    when p.ran_ok_at is null then 'run'
    -- テスト: every quiz:N must be answered (new projects) ...
    when has_quiz and exists (
           select 1 from public.project_keys k
            where k.project_id = p.id and k.item like 'quiz:%'
              and not exists (select 1 from public.project_attempts a
                              where a.project_id = p.id and a.item = k.item and (a.correct or a.assisted))) then 'explore'
    -- ... older projects walk through every explained block.
    when not has_quiz and exists (select 1 from public.project_blocks
                                  where project_id = p.id and mode = 'explain' and not explore_done) then 'explore'
    when exists (select 1 from public.project_keys where project_id = p.id and item = 'tweak') then 'tweak'
    else 'done'
  end;

  if next_stage is distinct from p.stage then
    update public.projects
       set stage = next_stage, stage_changed_at = now(),
           completed_at = case when next_stage = 'done' then now() else completed_at end
     where id = p.id;
  end if;
  return next_stage;
end
$$;
revoke all on function private.refresh_project_stage(uuid) from public, anon, authenticated;

-- A code answer to テスト N (service role). In order; the last one completes the walkthrough for
-- every explained block (assisted if any answer had to be shown).
create or replace function public.record_quiz_answer(
  p_project_id uuid, p_idx int, p_code text, p_passed boolean, p_reveal boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
  k public.project_keys;
  b public.project_blocks;
  v_item text := 'quiz:' || p_idx;
  v_assisted boolean := not p_passed and p_reveal;
  v_any_assisted boolean;
begin
  select * into p from public.projects where id = p_project_id and stage = 'explore';
  if not found then
    raise exception 'project is not in the test step' using errcode = '22023';
  end if;
  select * into k from public.project_keys where project_id = p.id and item = v_item;
  if not found then
    raise exception 'unknown question' using errcode = '22023';
  end if;
  if exists (select 1 from public.project_attempts where project_id = p.id and item = v_item and (correct or assisted)) then
    return jsonb_build_object('resolved', true, 'already', true, 'answer', k.answer_text, 'explanation', k.explanation);
  end if;
  if exists (select 1 from public.project_keys pk
              where pk.project_id = p.id and pk.item like 'quiz:%' and split_part(pk.item, ':', 2)::int < p_idx
                and not exists (select 1 from public.project_attempts a
                                where a.project_id = p.id and a.item = pk.item and (a.correct or a.assisted))) then
    raise exception 'answer the earlier question first' using errcode = '22023';
  end if;

  insert into public.project_attempts (project_id, student_id, item, code, correct, assisted)
  values (p.id, p.student_id, v_item, left(p_code, 4000), p_passed, v_assisted);
  if v_assisted then
    update public.projects set assisted_count = assisted_count + 1 where id = p.id;
  end if;

  if (p_passed or v_assisted) and not exists (
       select 1 from public.project_keys pk
        where pk.project_id = p.id and pk.item like 'quiz:%'
          and not exists (select 1 from public.project_attempts a
                          where a.project_id = p.id and a.item = pk.item and (a.correct or a.assisted))) then
    select exists (select 1 from public.project_attempts where project_id = p.id and item like 'quiz%' and assisted)
      into v_any_assisted;
    for b in
      update public.project_blocks set explore_done = true
       where project_id = p.id and mode = 'explain' and not explore_done
      returning *
    loop
      perform private.apply_block_concepts(b, case when v_any_assisted then 'explain_assisted' else 'explain_pass' end, p.session_id);
    end loop;
  end if;
  perform private.refresh_project_stage(p.id);
  update public.lesson_sessions set last_activity_at = now() where id = p.session_id;

  return jsonb_build_object(
    'resolved', p_passed or v_assisted,
    'answer', case when p_passed or v_assisted then k.answer_text end,
    'explanation', case when p_passed or v_assisted then k.explanation end
  );
end
$$;
revoke execute on function public.record_quiz_answer(uuid, int, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_quiz_answer(uuid, int, text, boolean, boolean) to service_role;
