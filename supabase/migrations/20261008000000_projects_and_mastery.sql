-- Build-first learning ("動くものが先、理解が後") with per-student concept mastery.
--
-- Flow of a project:
--   plan → build (fill blanks / write own blocks) → predict → run (in Studio) → explore (forced walkthrough)
--   → tweak → done
--
-- Mastery levels per student × concept (decided only from recorded results, never by the AI):
--   0 初見 / 1 一度習った (passed a walkthrough check) / 2 思い出せる (solved a blank unaided)
--   3 自分で書ける (wrote the block and it passed)
--
-- Answers live in project_keys, which clients can never read. Grading happens in SECURITY DEFINER
-- functions, so quiz results and mastery are measured values.

-- ---------------------------------------------------------------------------
-- Concept catalog (fixed list: the AI may only tag code with these ids)
-- ---------------------------------------------------------------------------
create table public.concepts (
  id         text primary key,
  name       text not null,
  kid_hint   text not null,
  category   text not null,
  sort_order int not null default 0
);

insert into public.concepts (id, name, kid_hint, category, sort_order) values
  ('script-placement', 'Scriptの置き場所',         'スクリプトをどこに入れるかで、動く・動かないが変わる',         'きほん', 10),
  ('server-vs-client', 'ScriptとLocalScript',      'みんなの世界で動くものと、自分の画面だけで動くものがある',     'きほん', 20),
  ('variable',         '変数',                     '名前をつけて、ものや数字を覚えておく箱',                       'きほん', 30),
  ('property',         'プロパティを変える',       '色・透明度・大きさなど、ものの「設定」を変える',               'きほん', 40),
  ('color',            '色を変える',               'Color3やBrickColorで、ものの色を変える',                       'きほん', 50),
  ('position',         '位置と動き',               'Position・CFrameで、ものの場所や向きを変える',                'きほん', 60),
  ('wait',             'task.waitで待つ',          '決めた秒数だけ待ってから次へ進む',                             'きほん', 70),
  ('if',               'if文（条件）',             'もし〜なら、こうする',                                         '考え方', 80),
  ('comparison',       'くらべる（== < >など）',   '同じか・大きいか・小さいかを確かめる',                         '考え方', 90),
  ('nil-check',        'あるか確かめる',           'FindFirstChildなどで、ものが本当にあるかを確かめてから使う',   '考え方', 100),
  ('function',         '関数',                     '処理のまとまりに名前をつけて、何度も使えるようにする',         '考え方', 110),
  ('loop-while',       'くり返し（while）',        '条件が続くあいだ、同じことをくり返す',                         '考え方', 120),
  ('loop-for',         'くり返し（for）',          '決めた回数だけ、同じことをくり返す',                           '考え方', 130),
  ('debounce',         '連続で動かない工夫',       '一度動いたら、少しのあいだ動かないようにする',                 '考え方', 140),
  ('touched',          'Touchedイベント',          '何かが触れた瞬間に動くしかけ',                                 'イベント', 150),
  ('click',            'クリックで動かす',         'ClickDetectorで、クリックされた瞬間に動くしかけ',              'イベント', 160),
  ('prompt',           'Eキーで動かす',            'ProximityPromptで、近くでボタンを押したときに動くしかけ',      'イベント', 170),
  ('character',        'キャラクターを見つける',   '触ったものの親（hit.Parent）からキャラクターを見つける',       'Roblox', 180),
  ('humanoid',         'Humanoid',                 'キャラクターの体力や歩く速さを管理している部品',               'Roblox', 190),
  ('players',          'プレイヤーを見つける',     'Playersサービスから、だれが遊んでいるかを調べる',               'Roblox', 200),
  ('leaderstats',      'スコア表示',               'leaderstatsで、画面の右上に点数を出す',                         'Roblox', 210),
  ('instance-new',     'ものを作る',               'Instance.newで、ゲームの中に新しいものを作る',                 'Roblox', 220),
  ('destroy',          'ものを消す',               'Destroyで、ものをゲームから消す',                               'Roblox', 230),
  ('tween',            'なめらかに動かす',         'TweenServiceで、少しずつなめらかに変化させる',                 'Roblox', 240)
on conflict (id) do update
  set name = excluded.name, kid_hint = excluded.kid_hint, category = excluded.category, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.lesson_sessions (id) on delete cascade,
  student_id       uuid not null references public.profiles (id) on delete cascade,
  idea             text not null,
  title            text,
  plan             jsonb not null default '{}'::jsonb,  -- {summary, parts[], question}
  placement        jsonb not null default '{}'::jsonb,  -- {script_type, parent_path, steps[]}
  predict          jsonb,                               -- {question, choices[]}            (answer in keys)
  tweak            jsonb,                               -- {instruction, question, choices[]} (answer in keys)
  stage            text not null default 'plan'
                   check (stage in ('plan', 'build', 'predict', 'run', 'explore', 'tweak', 'done', 'abandoned')),
  assisted_count   int not null default 0,              -- times the student needed the answer revealed
  ran_ok_at        timestamptz,
  run_failed_at    timestamptz,
  stage_changed_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create unique index projects_one_open_per_student
  on public.projects (student_id) where stage not in ('done', 'abandoned');
create index projects_session_idx on public.projects (session_id);

create table public.project_blocks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  idx          int not null,
  title        text not null,
  purpose      text not null,
  concepts     text[] not null default '{}',
  -- explain: given now, explained in the walkthrough / blank: fill the 【？】 / write: student writes it / given: mastered
  mode         text not null check (mode in ('explain', 'blank', 'write', 'given')),
  code         text,          -- what the student may see now (blank shows 【？】, write is null until done)
  blank        jsonb,         -- {prompt, choices[]}
  explanation  text,          -- walkthrough text (explain blocks)
  check_q      jsonb,         -- {question, choices[]}
  build_done   boolean not null default false,
  explore_done boolean not null default false,
  unique (project_id, idx)
);

-- Answers. RLS on, no policies: only SECURITY DEFINER functions / service role can read them.
create table public.project_keys (
  project_id   uuid not null references public.projects (id) on delete cascade,
  item         text not null,   -- 'blank:<idx>' | 'check:<idx>' | 'write:<idx>' | 'predict' | 'tweak'
  answer_index int,
  answer_text  text,
  explanation  text,
  primary key (project_id, item)
);

create table public.project_attempts (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  item         text not null,
  choice_index int,
  code         text,
  correct      boolean not null,
  assisted     boolean not null default false,  -- answer was revealed to let the student move on
  created_at   timestamptz not null default now()
);
create index project_attempts_project_idx on public.project_attempts (project_id, item);

-- ---------------------------------------------------------------------------
-- Mastery
-- ---------------------------------------------------------------------------
create table public.student_concepts (
  student_id   uuid not null references public.profiles (id) on delete cascade,
  concept_id   text not null references public.concepts (id),
  level        smallint not null default 0 check (level between 0 and 3),
  last_seen_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (student_id, concept_id)
);

create table public.concept_events (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.profiles (id) on delete cascade,
  concept_id   text not null references public.concepts (id),
  session_id   uuid references public.lesson_sessions (id) on delete set null,
  project_id   uuid references public.projects (id) on delete set null,
  kind         text not null check (kind in (
                 'explain_pass', 'explain_assisted', 'blank_pass', 'blank_assisted',
                 'write_pass', 'write_assisted', 'teacher_set')),
  level_before smallint not null,
  level_after  smallint not null,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index concept_events_student_idx on public.concept_events (student_id, created_at desc);
create index concept_events_session_idx on public.concept_events (session_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.concepts         enable row level security;
alter table public.projects         enable row level security;
alter table public.project_blocks   enable row level security;
alter table public.project_keys     enable row level security;
alter table public.project_attempts enable row level security;
alter table public.student_concepts enable row level security;
alter table public.concept_events   enable row level security;

revoke all on public.concepts, public.projects, public.project_blocks, public.project_keys,
  public.project_attempts, public.student_concepts, public.concept_events from anon;
revoke all on public.project_keys from authenticated;

create policy "concepts: everyone logged in" on public.concepts
  for select to authenticated using (true);
create policy "projects: visible students" on public.projects
  for select to authenticated using (private.can_view_student(student_id));
create policy "project_blocks: visible students" on public.project_blocks
  for select to authenticated using (private.can_view_student(student_id));
create policy "project_attempts: visible students" on public.project_attempts
  for select to authenticated using (private.can_view_student(student_id));
create policy "student_concepts: visible students" on public.student_concepts
  for select to authenticated using (private.can_view_student(student_id));
create policy "concept_events: visible students" on public.concept_events
  for select to authenticated using (private.can_view_student(student_id));

-- ---------------------------------------------------------------------------
-- Mastery rules (single place)
-- ---------------------------------------------------------------------------
create or replace function private.apply_concept_event(
  p_student uuid, p_concept text, p_kind text, p_session uuid, p_project uuid, p_detail jsonb default '{}'::jsonb
) returns smallint
language plpgsql security definer set search_path = '' as $$
declare
  cur smallint;
  nxt smallint;
begin
  select level into cur from public.student_concepts where student_id = p_student and concept_id = p_concept;
  cur := coalesce(cur, 0);
  nxt := case p_kind
    when 'explain_pass'   then greatest(cur, 1)
    when 'blank_pass'     then greatest(cur, 2)
    when 'write_pass'     then 3
    when 'blank_assisted' then 1                -- needed the answer: back to "一度習った"
    when 'write_assisted' then least(cur, 2)::smallint
    else cur                                     -- explain_assisted: seeing it is not learning it
  end;
  insert into public.student_concepts (student_id, concept_id, level, last_seen_at, updated_at)
  values (p_student, p_concept, nxt, now(), now())
  on conflict (student_id, concept_id)
  do update set level = excluded.level, last_seen_at = now(), updated_at = now();
  insert into public.concept_events (student_id, concept_id, session_id, project_id, kind, level_before, level_after, detail)
  values (p_student, p_concept, p_session, p_project, p_kind, cur, nxt, coalesce(p_detail, '{}'::jsonb));
  return nxt;
end
$$;

-- Applies an event to every catalog concept of a block.
create or replace function private.apply_block_concepts(p_block public.project_blocks, p_kind text, p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c text;
begin
  foreach c in array p_block.concepts loop
    if exists (select 1 from public.concepts where id = c) then
      perform private.apply_concept_event(p_block.student_id, c, p_kind, p_session, p_block.project_id,
        jsonb_build_object('block', p_block.idx, 'title', p_block.title));
    end if;
  end loop;
end
$$;

-- Stage is derived from what has been completed, so it can never be skipped.
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
    when not exists (select 1 from public.project_attempts
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

revoke all on function private.apply_concept_event(uuid, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.apply_block_concepts(public.project_blocks, text, uuid) from public, anon, authenticated;
revoke all on function private.refresh_project_stage(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Student RPCs
-- ---------------------------------------------------------------------------

-- Multiple-choice gates: 'blank:<idx>' (build), 'predict', 'check:<idx>' (explore, in order), 'tweak'.
-- Two wrong answers reveal the answer so nobody gets stuck; that is recorded as "assisted".
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
  required text;
begin
  select * into p from public.projects where id = p_project_id and student_id = auth.uid();
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  required := case kind when 'blank' then 'build' when 'predict' then 'predict'
                        when 'check' then 'explore' when 'tweak' then 'tweak' end;
  if required is null then
    raise exception 'unknown item' using errcode = '22023';
  end if;

  select * into k from public.project_keys where project_id = p.id and item = p_item;
  if not found then
    raise exception 'unknown item' using errcode = '22023';
  end if;

  -- Already resolved: report it, record nothing.
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
    -- The walkthrough goes in order.
    if kind = 'check' and exists (select 1 from public.project_blocks
                                  where project_id = p.id and mode = 'explain' and idx < bidx and not explore_done) then
      raise exception 'finish the earlier part first' using errcode = '22023';
    end if;
  end if;

  select count(*) into v_wrong from public.project_attempts
   where project_id = p.id and item = p_item and not correct;
  v_ok := p_choice = k.answer_index;
  v_assisted := not v_ok and v_wrong + 1 >= 2;

  insert into public.project_attempts (project_id, student_id, item, choice_index, correct, assisted)
  values (p.id, p.student_id, p_item, p_choice, v_ok, v_assisted);

  if v_ok or v_assisted then
    if kind = 'blank' then
      update public.project_blocks
         set code = replace(code, '【？】', k.answer_text), build_done = true
       where id = b.id
      returning * into b;
      perform private.apply_block_concepts(b, case when v_ok then 'blank_pass' else 'blank_assisted' end, p.session_id);
    elsif kind = 'check' then
      update public.project_blocks set explore_done = true where id = b.id returning * into b;
      perform private.apply_block_concepts(b, case when v_ok then 'explain_pass' else 'explain_assisted' end, p.session_id);
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

create or replace function public.report_project_run(p_project_id uuid, p_ok boolean)
returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
begin
  select * into p from public.projects where id = p_project_id and student_id = auth.uid() and stage = 'run';
  if not found then
    raise exception 'project is not waiting for a run' using errcode = '22023';
  end if;
  if p_ok then
    update public.projects set ran_ok_at = now(), run_failed_at = null where id = p.id;
  else
    update public.projects set run_failed_at = coalesce(run_failed_at, now()) where id = p.id;
  end if;
  perform private.refresh_project_stage(p.id);
  update public.lesson_sessions set last_activity_at = now() where id = p.session_id;
  select * into p from public.projects where id = p.id;
  return p;
end
$$;

create or replace function public.finish_project(p_project_id uuid)
returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
begin
  select * into p from public.projects where id = p_project_id and student_id = auth.uid() and stage = 'tweak';
  if not found then
    raise exception 'project is not ready to finish' using errcode = '22023';
  end if;
  if not exists (select 1 from public.project_attempts
                 where project_id = p.id and item = 'tweak' and (correct or assisted)) then
    raise exception 'answer the tweak question first' using errcode = '22023';
  end if;
  update public.projects set stage = 'done', completed_at = now(), stage_changed_at = now()
   where id = p.id returning * into p;
  update public.lesson_sessions set last_activity_at = now() where id = p.session_id;
  return p;
end
$$;

create or replace function public.abandon_project(p_project_id uuid)
returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
begin
  update public.projects set stage = 'abandoned', stage_changed_at = now()
   where id = p_project_id and student_id = auth.uid() and stage not in ('done', 'abandoned')
  returning * into p;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  return p;
end
$$;

-- Teachers can correct a level (e.g. the student clearly knows it already).
create or replace function public.teacher_set_concept_level(p_student uuid, p_concept text, p_level int)
returns public.student_concepts
language plpgsql security definer set search_path = '' as $$
declare
  cur smallint;
  r   public.student_concepts;
begin
  if not private.is_teacher_of(p_student) then
    raise exception 'not your student' using errcode = '42501';
  end if;
  if p_level < 0 or p_level > 3 then
    raise exception 'invalid level' using errcode = '22023';
  end if;
  select level into cur from public.student_concepts where student_id = p_student and concept_id = p_concept;
  insert into public.student_concepts (student_id, concept_id, level, last_seen_at, updated_at)
  values (p_student, p_concept, p_level, now(), now())
  on conflict (student_id, concept_id) do update set level = excluded.level, updated_at = now()
  returning * into r;
  insert into public.concept_events (student_id, concept_id, kind, level_before, level_after, detail)
  values (p_student, p_concept, 'teacher_set', coalesce(cur, 0), p_level, jsonb_build_object('by', auth.uid()));
  return r;
end
$$;

-- ---------------------------------------------------------------------------
-- Service-only: result of a "write it yourself" block (graded by the AI in the Edge Function).
-- ---------------------------------------------------------------------------
create or replace function public.record_write_attempt(
  p_project_id uuid, p_idx int, p_code text, p_passed boolean, p_reveal boolean
) returns public.project_blocks
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
  b public.project_blocks;
  k public.project_keys;
begin
  select * into p from public.projects where id = p_project_id and stage = 'build';
  if not found then
    raise exception 'project is not in the build step' using errcode = '22023';
  end if;
  select * into b from public.project_blocks where project_id = p.id and idx = p_idx and mode = 'write';
  if not found then
    raise exception 'block not found' using errcode = 'P0002';
  end if;
  select * into k from public.project_keys where project_id = p.id and item = 'write:' || p_idx;

  insert into public.project_attempts (project_id, student_id, item, code, correct, assisted)
  values (p.id, p.student_id, 'write:' || p_idx, p_code, p_passed, not p_passed and p_reveal);

  if p_passed then
    update public.project_blocks set code = p_code, build_done = true where id = b.id returning * into b;
    perform private.apply_block_concepts(b, 'write_pass', p.session_id);
  elsif p_reveal then
    update public.project_blocks set code = k.answer_text, build_done = true where id = b.id returning * into b;
    perform private.apply_block_concepts(b, 'write_assisted', p.session_id);
    update public.projects set assisted_count = assisted_count + 1 where id = p.id;
  end if;
  perform private.refresh_project_stage(p.id);
  update public.lesson_sessions set last_activity_at = now() where id = p.session_id;
  return b;
end
$$;

-- Service-only: after the Edge Function stored blocks and keys, move the project out of 'plan'.
create or replace function public.start_project_build(p_project_id uuid)
returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
begin
  update public.projects set stage = 'build', stage_changed_at = now()
   where id = p_project_id and stage = 'plan';
  -- Blocks the student does not have to fill in are ready from the start.
  update public.project_blocks set build_done = true
   where project_id = p_project_id and mode in ('explain', 'given');
  perform private.refresh_project_stage(p_project_id);
  select * into p from public.projects where id = p_project_id;
  return p;
end
$$;

revoke execute on function public.answer_project_item(uuid, text, int)              from public, anon;
revoke execute on function public.report_project_run(uuid, boolean)                 from public, anon;
revoke execute on function public.finish_project(uuid)                              from public, anon;
revoke execute on function public.abandon_project(uuid)                             from public, anon;
revoke execute on function public.teacher_set_concept_level(uuid, text, int)        from public, anon;
revoke execute on function public.record_write_attempt(uuid, int, text, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.start_project_build(uuid)                         from public, anon, authenticated;

grant execute on function public.answer_project_item(uuid, text, int)       to authenticated;
grant execute on function public.report_project_run(uuid, boolean)          to authenticated;
grant execute on function public.finish_project(uuid)                       to authenticated;
grant execute on function public.abandon_project(uuid)                      to authenticated;
grant execute on function public.teacher_set_concept_level(uuid, text, int) to authenticated;
grant execute on function public.record_write_attempt(uuid, int, text, boolean, boolean) to service_role;
grant execute on function public.start_project_build(uuid)                  to service_role;
