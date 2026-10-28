-- 体験授業 (trial lesson) with a fixed output style, scripts pasted by the student, and the new
-- walkthrough: every line translated into Japanese, then ONE random question.

-- ---------------------------------------------------------------------------
-- Lessons: only 体験授業 is offered. Old lessons are hidden (kept for past sessions / summaries).
-- ai_guide: extra instructions for AI先生 while this lesson is selected (overrides the defaults).
-- max_lines: the generated project code must fit in this many lines (the server retries once).
-- ---------------------------------------------------------------------------
alter table public.lessons
  add column ai_guide  text,
  add column max_lines int;

update public.lessons set is_active = false where id <> 'trial';

insert into public.lessons (id, title, goal, concepts, emoji, sort_order, is_active, max_lines, ai_guide) values
  ('trial', '体験授業', '今あるゲームに短いコードを足して、目で見える変化を起こす',
   array['Instance.new', 'プロパティ', 'math.random'], '✨', 10, true, 10,
$guide$
# このレッスン：体験授業（はじめてプログラミングにさわる子）
作るコードは「今あるScriptに差し込む、短いコード」。下のお手本の形・長さ・書き方にできるだけ近づける。

## 決まり
- コードは全部で3〜10行。まとまり（block）は1〜2個だけ。
- 生徒の今のScriptが渡されているときは、そこで使われている名前（key、part、hit など）をそのまま使い、
  そのScriptの「どの行の下に貼るか」を placement の steps で具体的に書く（Script全体は書き直さない）。
- Scriptが無いときだけ、Partの中に入れる短いScript（script.Parent を使う）にする。
- 使ってよいもの：if、math.random、Instance.new、プロパティに数字・色・true/false を入れる、task.wait、Destroy、Color3.fromRGB。
- 使わないもの：function の定義、:Connect を新しく作ること（Scriptが無いとき以外）、pcall、ModuleScript、RemoteEvent、for / while、
  FindFirstChild を重ねる安全チェック、型の書き方、数字を変数や定数にまとめること。
- 数字はコードの中にそのまま書く。変数名は短い英語の名詞（boom、light、sound など）。
- コメントは、つまずきやすい1か所だけ、子どもの言葉で（例：「これがないと たおれちゃう」）。
- 動かしたらすぐ目で見える変化（爆発・色・光・音・大きさ・飛ぶ）にする。

## お手本（キーをふんだときの処理の中に差し込むコード）
```lua
if math.random(1,10) == 1 then
	local boom = Instance.new("Explosion")
	boom.Position = key.Position
	boom.DestroyJointRadiusPercent = 0 -- これがないと たおれちゃう
	boom.BlastRadius = 20
	boom.BlastPressure = 500000
	boom.Parent = workspace
end
```
$guide$)
on conflict (id) do update
  set title = excluded.title, goal = excluded.goal, concepts = excluded.concepts, emoji = excluded.emoji,
      sort_order = excluded.sort_order, is_active = true, max_lines = excluded.max_lines, ai_guide = excluded.ai_guide;

-- ---------------------------------------------------------------------------
-- Projects: scripts the student pasted (to insert code into), the one random walkthrough question,
-- and the line-by-line translation of each block.
-- ---------------------------------------------------------------------------
alter table public.projects
  add column scripts jsonb not null default '[]'::jsonb,  -- [{path, source}]
  add column quiz    jsonb;                               -- {question, choices[]} (answer in project_keys 'quiz')

alter table public.project_blocks
  add column lines jsonb;  -- [{code, meaning, words: [{word, meaning}]}] (explain / given blocks only)

-- ---------------------------------------------------------------------------
-- Gates: + 'quiz' (explore). Passing it finishes the whole walkthrough: every explained block counts
-- as walked through, and its concepts are recorded (pass, or assisted when the answer was revealed).
-- ---------------------------------------------------------------------------
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
                        when 'check' then 'explore' when 'quiz' then 'explore' when 'tweak' then 'tweak' end;
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
    elsif kind = 'quiz' then
      for b in
        update public.project_blocks set explore_done = true
         where project_id = p.id and mode = 'explain' and not explore_done
        returning *
      loop
        perform private.apply_block_concepts(b, case when v_ok then 'explain_pass' else 'explain_assisted' end, p.session_id);
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

-- A revision from the chat also clears the walkthrough question (the pasted scripts stay).
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
         placement = '{}'::jsonb, predict = null, tweak = null, quiz = null,
         ran_ok_at = null, run_failed_at = null
   where id = p.id
  returning * into p;
  return p;
end
$$;
