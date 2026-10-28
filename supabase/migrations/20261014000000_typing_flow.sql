-- New project flow:  決める → 打ちこむ → 動かす → テスト(3問) → いじる(記述式) → 完成
--  * 打ちこむ: the code is not handed over to copy. The student types every line by hand while
--    reading its translation; a block is in the student's code (build_done) once it was typed.
--  * 予想する is gone (new projects have no 'predict' key; old ones still need it).
--  * テスト: three questions 'quiz:0'..'quiz:2' in order; finishing them completes the walkthrough.
--  * いじる: a written answer graded by AI先生 (record_tweak_answer, service role).

-- Building no longer marks explained / given blocks as done: they still have to be typed.
create or replace function public.start_project_build(p_project_id uuid)
returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
begin
  update public.projects set stage = 'build', stage_changed_at = now()
   where id = p_project_id and stage = 'plan';
  perform private.refresh_project_stage(p_project_id);
  select * into p from public.projects where id = p_project_id;
  return p;
end
$$;

-- 予想する only for projects that have a predict question (made before this change).
create or replace function private.refresh_project_stage(p_project uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
  next_stage text;
begin
  select * into p from public.projects where id = p_project;
  if not found or p.stage in ('plan', 'done', 'abandoned') then
    return p.stage;
  end if;

  next_stage := case
    when exists (select 1 from public.project_blocks where project_id = p.id and not build_done) then 'build'
    when exists (select 1 from public.project_keys where project_id = p.id and item = 'predict')
         and not exists (select 1 from public.project_attempts
                         where project_id = p.id and item = 'predict' and (correct or assisted)) then 'predict'
    when p.ran_ok_at is null then 'run'
    when exists (select 1 from public.project_blocks
                 where project_id = p.id and mode = 'explain' and not explore_done) then 'explore'
    else 'tweak'
  end;

  if next_stage is distinct from p.stage then
    update public.projects set stage = next_stage, stage_changed_at = now() where id = p.id;
  end if;
  return next_stage;
end
$$;
revoke all on function private.refresh_project_stage(uuid) from public, anon, authenticated;

-- The student typed every line of a block (explain / given, or a blank after it was filled).
create or replace function public.mark_block_typed(p_project_id uuid, p_idx int)
returns public.project_blocks
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
  b public.project_blocks;
begin
  select * into p from public.projects where id = p_project_id and student_id = auth.uid() and stage = 'build';
  if not found then
    raise exception 'not in the typing step' using errcode = '22023';
  end if;
  select * into b from public.project_blocks where project_id = p.id and idx = p_idx;
  if not found or b.mode = 'write' or (b.mode = 'blank' and position('【？】' in coalesce(b.code, '')) > 0) then
    raise exception 'this part cannot be typed yet' using errcode = '22023';
  end if;
  update public.project_blocks set build_done = true where id = b.id returning * into b;
  perform private.refresh_project_stage(p.id);
  update public.lesson_sessions set last_activity_at = now() where id = p.session_id;
  return b;
end
$$;
revoke execute on function public.mark_block_typed(uuid, int) from public, anon;
grant execute on function public.mark_block_typed(uuid, int) to authenticated;

-- Gates. Changes: a solved blank fills the code but the block still has to be typed;
-- 'quiz:N' (three, in order) — the last one completes the walkthrough for every explained block
-- (recorded as pass, or assisted if any answer had to be revealed). Legacy 'quiz' still works.
create or replace function public.answer_project_item(p_project_id uuid, p_item text, p_choice int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p        public.projects;
  k        public.project_keys;
  b        public.project_blocks;
  kind     text := split_part(p_item, ':', 1);
  bidx     int;
  v_wrong    int;
  v_ok       boolean;
  v_assisted boolean;
  v_any_assisted boolean;
  required text;
begin
  select * into p from public.projects where id = p_project_id and student_id = auth.uid();
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  required := case kind when 'blank' then 'build' when 'predict' then 'predict'
                        when 'check' then 'explore' when 'quiz' then 'explore' when 'tweak' then 'tweak' end;
  if required is null then
    raise exception 'unknown item' using errcode = '22023';
  end if;

  select * into k from public.project_keys where project_id = p.id and item = p_item;
  if not found then
    raise exception 'unknown item' using errcode = '22023';
  end if;

  if exists (select 1 from public.project_attempts
             where project_id = p.id and item = p_item and (correct or assisted)) then
    return jsonb_build_object('correct', true, 'resolved', true, 'already', true,
                              'answer_index', k.answer_index, 'explanation', k.explanation);
  end if;

  if p.stage <> required then
    raise exception 'not available in this step' using errcode = '22023';
  end if;

  if kind in ('blank', 'check') then
    bidx := split_part(p_item, ':', 2)::int;
    select * into b from public.project_blocks where project_id = p.id and idx = bidx;
    if kind = 'check' and exists (select 1 from public.project_blocks
                                  where project_id = p.id and mode = 'explain' and idx < bidx and not explore_done) then
      raise exception 'finish the earlier part first' using errcode = '22023';
    end if;
  end if;
  -- The test goes in order too.
  if kind = 'quiz' and p_item like 'quiz:%' and exists (
       select 1 from public.project_keys pk
        where pk.project_id = p.id and pk.item like 'quiz:%'
          and split_part(pk.item, ':', 2)::int < split_part(p_item, ':', 2)::int
          and not exists (select 1 from public.project_attempts a
                          where a.project_id = p.id and a.item = pk.item and (a.correct or a.assisted))) then
    raise exception 'answer the earlier question first' using errcode = '22023';
  end if;

  select count(*) into v_wrong from public.project_attempts
   where project_id = p.id and item = p_item and not correct;
  v_ok := p_choice = k.answer_index;
  v_assisted := not v_ok and v_wrong + 1 >= 2;

  insert into public.project_attempts (project_id, student_id, item, choice_index, correct, assisted)
  values (p.id, p.student_id, p_item, p_choice, v_ok, v_assisted);

  if v_ok or v_assisted then
    if kind = 'blank' then
      -- Filled in, but the block still has to be typed (mark_block_typed).
      update public.project_blocks set code = replace(code, '【？】', k.answer_text)
       where id = b.id
      returning * into b;
      perform private.apply_block_concepts(b, case when v_ok then 'blank_pass' else 'blank_assisted' end, p.session_id);
    elsif kind = 'check' then
      update public.project_blocks set explore_done = true where id = b.id returning * into b;
      perform private.apply_block_concepts(b, case when v_ok then 'explain_pass' else 'explain_assisted' end, p.session_id);
    elsif kind = 'quiz' and (p_item = 'quiz' or not exists (
        select 1 from public.project_keys pk
         where pk.project_id = p.id and pk.item like 'quiz:%'
           and not exists (select 1 from public.project_attempts a
                           where a.project_id = p.id and a.item = pk.item and (a.correct or a.assisted)))) then
      select exists (select 1 from public.project_attempts
                      where project_id = p.id and item like 'quiz%' and assisted) into v_any_assisted;
      for b in
        update public.project_blocks set explore_done = true
         where project_id = p.id and mode = 'explain' and not explore_done
        returning *
      loop
        perform private.apply_block_concepts(b, case when v_any_assisted then 'explain_assisted' else 'explain_pass' end, p.session_id);
      end loop;
    end if;
    if v_assisted then
      update public.projects set assisted_count = assisted_count + 1 where id = p.id;
    end if;
    perform private.refresh_project_stage(p.id);
  end if;

  update public.lesson_sessions set last_activity_at = now() where id = p.session_id;

  return jsonb_build_object(
    'correct', v_ok,
    'resolved', v_ok or v_assisted,
    'assisted', v_assisted,
    'attempts', v_wrong + 1,
    'answer_index', case when v_ok or v_assisted then k.answer_index end,
    'explanation', case when v_ok or v_assisted then k.explanation end
  );
end
$$;

-- いじる: the written answer, graded by AI先生 in the Edge Function (service role).
create or replace function public.record_tweak_answer(p_project_id uuid, p_answer text, p_passed boolean, p_reveal boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
  k public.project_keys;
begin
  select * into p from public.projects where id = p_project_id and stage = 'tweak';
  if not found then
    raise exception 'project is not in the tweak step' using errcode = '22023';
  end if;
  select * into k from public.project_keys where project_id = p.id and item = 'tweak';
  insert into public.project_attempts (project_id, student_id, item, code, correct, assisted)
  values (p.id, p.student_id, 'tweak', left(p_answer, 2000), p_passed, not p_passed and p_reveal);
  if not p_passed and p_reveal then
    update public.projects set assisted_count = assisted_count + 1 where id = p.id;
  end if;
  update public.lesson_sessions set last_activity_at = now() where id = p.session_id;
  return jsonb_build_object(
    'resolved', p_passed or p_reveal,
    'expected', case when p_passed or p_reveal then k.answer_text end,
    'explanation', case when p_passed or p_reveal then k.explanation end
  );
end
$$;
revoke execute on function public.record_tweak_answer(uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_tweak_answer(uuid, text, boolean, boolean) to service_role;
