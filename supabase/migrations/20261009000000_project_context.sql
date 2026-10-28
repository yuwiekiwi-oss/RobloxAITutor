-- What the student showed AI先生 when describing a project: reference images and the Explorer tree
-- (pasted from the Studio Command Bar). Written only by the `project` Edge Function (service role).
alter table public.projects
  add column idea_images   text[] not null default '{}',  -- storage paths in the `screenshots` bucket
  add column explorer_tree text;

comment on column public.projects.idea_images is 'Reference images for the idea (screenshots bucket paths).';
comment on column public.projects.explorer_tree is 'Explorer hierarchy pasted from Roblox Studio (text).';
