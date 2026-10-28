-- Studio Explorer trees a student has used before, so they can pick one again instead of
-- running the Command Bar every time. One row per distinct tree per student.
create table public.student_trees (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.profiles (id) on delete cascade,
  place        text,                                   -- game.Name printed with the tree (may be null)
  tree         text not null check (char_length(tree) <= 12000),
  tree_hash    text generated always as (md5(tree)) stored,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (student_id, tree_hash)
);
create index student_trees_recent_idx on public.student_trees (student_id, last_used_at desc);

alter table public.student_trees enable row level security;
revoke all on public.student_trees from anon;
-- Students read their own; writes only through save_tree().
create policy "student_trees: own" on public.student_trees
  for select to authenticated using (student_id = auth.uid());

-- Save (or mark as used again) a tree for the calling student. Keeps the 12 most recent.
create or replace function public.save_tree(p_tree text, p_place text default null)
returns public.student_trees
language plpgsql security definer set search_path = '' as $$
declare
  t public.student_trees;
begin
  if auth.uid() is null or coalesce(btrim(p_tree), '') = '' then
    raise exception 'tree required' using errcode = '22023';
  end if;
  insert into public.student_trees (student_id, place, tree)
  values (auth.uid(), nullif(left(btrim(coalesce(p_place, '')), 60), ''), left(p_tree, 12000))
  on conflict (student_id, tree_hash) do update
    set last_used_at = now(), place = coalesce(excluded.place, public.student_trees.place)
  returning * into t;

  delete from public.student_trees
   where student_id = auth.uid()
     and id not in (select id from public.student_trees where student_id = auth.uid()
                    order by last_used_at desc limit 12);
  return t;
end
$$;
revoke execute on function public.save_tree(text, text) from public, anon;
grant execute on function public.save_tree(text, text) to authenticated;

-- Trees already used in projects become saved trees.
insert into public.student_trees (student_id, tree, created_at, last_used_at)
select distinct on (student_id, md5(left(explorer_tree, 12000)))
       student_id, left(explorer_tree, 12000), created_at, created_at
  from public.projects
 where explorer_tree is not null and btrim(explorer_tree) <> ''
 order by student_id, md5(left(explorer_tree, 12000)), created_at desc
on conflict (student_id, tree_hash) do nothing;
