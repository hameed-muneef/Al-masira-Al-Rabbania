-- LIVE-002/TAW-009: circle live sessions (Google Meet) and announcements.
-- Meeting URLs are stored for circle members only; the platform never records or
-- stores audio/video. Host entry control remains the meeting provider's job.
create table public.circle_live_sessions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.study_groups(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meeting_url text not null default '' check (char_length(meeting_url) <= 500),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  notes text not null default '' check (char_length(notes) <= 1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index circle_live_sessions_circle_idx on public.circle_live_sessions(circle_id, starts_at);

create table public.circle_announcements (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.study_groups(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 3000),
  created_at timestamptz not null default now()
);
create index circle_announcements_circle_idx on public.circle_announcements(circle_id, created_at desc);

alter table public.circle_live_sessions enable row level security;
alter table public.circle_announcements enable row level security;
revoke all on public.circle_live_sessions, public.circle_announcements from public, anon, authenticated;
grant select on public.circle_live_sessions, public.circle_announcements to authenticated;
grant select, insert, update, delete on public.circle_live_sessions, public.circle_announcements to service_role;

-- Members read sessions/announcements of their circles.
create policy circle_session_read on public.circle_live_sessions for select to authenticated
  using ((select public.is_group_member(circle_id)));
create policy circle_announcement_read on public.circle_announcements for select to authenticated
  using ((select public.is_group_member(circle_id)));

create function public.create_circle_session(p_circle_id uuid, p_title text, p_starts_at timestamptz,
  p_ends_at timestamptz, p_meeting_url text default '', p_notes text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_group public.study_groups%rowtype;
  v_id uuid;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select * into v_group from public.study_groups where id = p_circle_id for update;
  if not found or v_group.founder_id <> v_actor or not exists (
    select 1 from public.group_members where group_id = p_circle_id and user_id = v_actor and role = 'founder'
  ) then
    raise exception 'المؤسس فقط ينشئ جلسات الحلقة' using errcode='42501';
  end if;
  if v_group.status <> 'active' then raise exception 'الحلقة مغلقة' using errcode='P0001'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or char_length(coalesce(p_meeting_url,'')) > 500
     or char_length(coalesce(p_notes,'')) > 1000 then
    raise exception 'بيانات الجلسة غير صالحة' using errcode='22023';
  end if;
  insert into public.circle_live_sessions (circle_id, title, starts_at, ends_at, meeting_url, notes, created_by)
    values (p_circle_id, btrim(p_title), p_starts_at, p_ends_at, coalesce(p_meeting_url,''), coalesce(p_notes,''), v_actor)
    returning id into v_id;
  return v_id;
end $$;

create function public.cancel_circle_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_session public.circle_live_sessions%rowtype;
  v_group public.study_groups%rowtype;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select * into v_session from public.circle_live_sessions where id = p_session_id for update;
  if not found then raise exception 'الجلسة غير موجودة' using errcode='P0001'; end if;
  select * into v_group from public.study_groups where id = v_session.circle_id;
  if v_group.founder_id <> v_actor and not public.is_admin() then
    raise exception 'لا تملك صلاحية إلغاء هذه الجلسة' using errcode='42501';
  end if;
  if v_session.status = 'cancelled' then return; end if;
  update public.circle_live_sessions set status = 'cancelled' where id = p_session_id;
end $$;

create function public.create_circle_announcement(p_circle_id uuid, p_title text, p_body text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_group public.study_groups%rowtype;
  v_id uuid;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select * into v_group from public.study_groups where id = p_circle_id;
  if not found or v_group.founder_id <> v_actor or not exists (
    select 1 from public.group_members where group_id = p_circle_id and user_id = v_actor and role in ('founder','manager')
  ) then
    raise exception 'المخوّل فقط ينشر إعلانات' using errcode='42501';
  end if;
  if v_group.status <> 'active' then raise exception 'الحلقة مغلقة' using errcode='P0001'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or char_length(coalesce(p_body,'')) > 3000 then
    raise exception 'بيانات الإعلان غير صالحة' using errcode='22023';
  end if;
  insert into public.circle_announcements (circle_id, author_id, title, body)
    values (p_circle_id, v_actor, btrim(p_title), coalesce(p_body,''))
    returning id into v_id;
  return v_id;
end $$;

revoke all on function public.create_circle_session(uuid, text, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.cancel_circle_session(uuid) from public, anon, authenticated;
revoke all on function public.create_circle_announcement(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_circle_session(uuid, text, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.cancel_circle_session(uuid) to authenticated;
grant execute on function public.create_circle_announcement(uuid, text, text) to authenticated;
