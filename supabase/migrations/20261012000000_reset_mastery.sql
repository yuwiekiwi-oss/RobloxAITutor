-- Teacher: reset a student's learning record (all concept mastery back to 初見).
-- The history stays: each reset concept gets a 'teacher_set' event (before → 0), so parents'
-- "できるようになったこと" (which ignores teacher events) and past summaries are not rewritten.
create or replace function public.teacher_reset_mastery(p_student uuid)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  if not private.is_teacher_of(p_student) then
    raise exception 'not your student' using errcode = '42501';
  end if;

  insert into public.concept_events (student_id, concept_id, kind, level_before, level_after, detail)
  select student_id, concept_id, 'teacher_set', level, 0, jsonb_build_object('by', auth.uid(), 'reset', true)
    from public.student_concepts
   where student_id = p_student and level > 0;
  get diagnostics n = row_count;

  delete from public.student_concepts where student_id = p_student;
  return n;
end
$$;

revoke execute on function public.teacher_reset_mastery(uuid) from public, anon;
grant execute on function public.teacher_reset_mastery(uuid) to authenticated;
