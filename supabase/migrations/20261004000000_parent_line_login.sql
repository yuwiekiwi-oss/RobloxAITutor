-- Parents sign in to the separate parent page with LINE.
-- A parent profile is linked to one LINE account by opening a one-time invite link.
-- Both tables are only touched by the `line-login` Edge Function and scripts (service role):
-- RLS is on with no policies, so clients can neither read nor write them.

create table public.parent_line_accounts (
  line_user_id text primary key,
  parent_id    uuid not null unique references public.profiles (id) on delete cascade,
  line_name    text,
  linked_at    timestamptz not null default now()
);

create table public.parent_invites (
  code       text primary key,
  parent_id  uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '14 days',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index parent_invites_parent_idx on public.parent_invites (parent_id);

alter table public.parent_line_accounts enable row level security;
alter table public.parent_invites       enable row level security;
revoke all on public.parent_line_accounts, public.parent_invites from anon, authenticated;
