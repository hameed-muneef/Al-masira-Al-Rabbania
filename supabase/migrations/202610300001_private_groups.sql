-- TAW-001: private-only group foundation. Creation and membership changes will be
-- exposed through narrowly scoped server operations in later tasks.
create table public.study_groups (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '',
  goal text not null default '',
  kind text not null check (kind in ('friends','book','quran','mentoring','course','program')),
  status text not null default 'active' check (status in ('active','closed')),
  member_limit integer not null default 12 check (member_limit between 2 and 100),
  starts_on date,
  ends_on date,
  participation_rules text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.group_members (
  group_id uuid not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('founder','manager','assistant','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create unique index one_group_founder on public.group_members(group_id) where role = 'founder';
create index group_members_user_idx on public.group_members(user_id, group_id);

-- SECURITY DEFINER avoids recursive RLS checks on group_members. The caller's
-- identity comes only from auth.uid(), never from a supplied user_id argument.
create function public.is_group_member(target_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members
    where group_id = target_group and user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_group_member(uuid) from public, anon, authenticated;
grant execute on function public.is_group_member(uuid) to authenticated;

alter table public.study_groups enable row level security;
alter table public.group_members enable row level security;
revoke all on public.study_groups, public.group_members from public, anon, authenticated;
grant select on public.study_groups, public.group_members to authenticated;
grant select, insert, update, delete on public.study_groups, public.group_members to service_role;

create policy group_member_read on public.study_groups for select to authenticated
  using ((select public.is_group_member(id)));
create policy group_roster_read on public.group_members for select to authenticated
  using ((select public.is_group_member(group_id)));

create trigger set_updated_at before insert or update on public.study_groups
  for each row execute function private.set_updated_at();
