-- AL_MUDARASA Phase 3: scheduled meetings for a study circle.
-- Meeting links are Google Meet URLs supplied by staff. They are never exposed
-- by table reads: members fetch one only through reveal_study_meeting_url, which
-- re-checks membership, circle status and meeting status on every call.

create table public.study_meetings (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  agenda text not null default '' check (char_length(agenda) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meeting_url text not null check (meeting_url ~ '^https://meet\.google\.com/[A-Za-z0-9/_?=&.-]{3,150}$'),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  summary text not null default '' check (char_length(summary) <= 6000),
  pending_points text not null default '' check (char_length(pending_points) <= 3000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours')
);
create index study_meetings_circle_idx on public.study_meetings(circle_id, starts_at desc);

create table public.study_meeting_attendance (
  meeting_id uuid not null references public.study_meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('present','absent','excused')),
  marked_by uuid not null references auth.users(id),
  marked_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

-- لا قراءة ولا كتابة مباشرة؛ كل الوصول عبر وظائف تتحقق من العضوية والدور.
alter table public.study_meetings enable row level security;
alter table public.study_meeting_attendance enable row level security;
revoke all on public.study_meetings, public.study_meeting_attendance from public, anon, authenticated;

create function public.schedule_study_meeting(
  p_circle_id uuid, p_title text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_meeting_url text, p_agenda text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_circle public.study_circles%rowtype;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'جدولة الاجتماع تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if private.study_role(p_circle_id, array['creator','supervisor','teacher']) is null then
    raise exception 'المؤسس أو المشرف أو المعلم فقط يجدول الاجتماعات' using errcode = '42501';
  end if;
  select * into v_circle from public.study_circles where id = p_circle_id;
  if not found or v_circle.status <> 'active' then
    raise exception 'المدارسة ليست نشطة فلا تجدول اجتماعات' using errcode = 'P0001';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 3 and 160
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_ends_at > p_starts_at + interval '12 hours' or p_starts_at < now() - interval '1 hour'
     or p_meeting_url is null or p_meeting_url !~ '^https://meet\.google\.com/[A-Za-z0-9/_?=&.-]{3,150}$'
     or char_length(coalesce(p_agenda,'')) > 2000 then
    raise exception 'بيانات الاجتماع غير صالحة؛ الرابط يجب أن يكون من Google Meet' using errcode = '22023';
  end if;
  insert into public.study_meetings (circle_id, title, agenda, starts_at, ends_at, meeting_url, created_by)
  values (p_circle_id, btrim(p_title), coalesce(p_agenda,''), p_starts_at, p_ends_at, p_meeting_url, v_user)
  returning id into v_id;
  insert into public.notifications (recipient_id, kind, title, body, link)
  select m.user_id, 'mudarasa', 'اجتماع جديد في: ' || v_circle.title, btrim(p_title), '/study'
  from public.study_circle_members m where m.circle_id = p_circle_id and m.user_id <> v_user;
  return v_id;
end $$;

create function public.cancel_study_meeting(p_meeting_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_meeting public.study_meetings%rowtype;
  v_title text;
begin
  if v_user is null then
    raise exception 'إلغاء الاجتماع يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_meeting from public.study_meetings where id = p_meeting_id for update;
  if not found or private.study_role(v_meeting.circle_id, array['creator','supervisor','teacher']) is null then
    raise exception 'لا تملك صلاحية إلغاء هذا الاجتماع' using errcode = '42501';
  end if;
  if v_meeting.status <> 'scheduled' then
    raise exception 'الاجتماع ليس مجدولًا' using errcode = 'P0001';
  end if;
  update public.study_meetings set status = 'cancelled' where id = p_meeting_id;
  select title into v_title from public.study_circles where id = v_meeting.circle_id;
  insert into public.notifications (recipient_id, kind, title, body, link)
  select m.user_id, 'mudarasa', 'أُلغي اجتماع في: ' || v_title, v_meeting.title, '/study'
  from public.study_circle_members m where m.circle_id = v_meeting.circle_id and m.user_id <> v_user;
end $$;

-- القائمة بلا رابط؛ تُظهر حضور المستدعي فقط وعدد الحاضرين.
create function public.list_study_meetings(p_circle_id uuid)
returns table(id uuid, title text, agenda text, starts_at timestamptz, ends_at timestamptz,
  status text, summary text, pending_points text, has_meeting_link boolean,
  my_attendance text, present_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or (select public.is_study_member(p_circle_id)) is not true then
    raise exception 'لا تملك صلاحية عرض اجتماعات المدارسة' using errcode = '42501';
  end if;
  return query select m.id, m.title, m.agenda, m.starts_at, m.ends_at, m.status, m.summary, m.pending_points,
    (m.status = 'scheduled'),
    (select a.status from public.study_meeting_attendance a where a.meeting_id = m.id and a.user_id = auth.uid()),
    (select count(*) from public.study_meeting_attendance a where a.meeting_id = m.id and a.status = 'present')
  from public.study_meetings m where m.circle_id = p_circle_id order by m.starts_at desc;
end $$;

create function public.reveal_study_meeting_url(p_meeting_id uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_url text;
begin
  if auth.uid() is null then
    raise exception 'تسجيل الدخول مطلوب' using errcode = '42501';
  end if;
  select m.meeting_url into v_url from public.study_meetings m
    join public.study_circles c on c.id = m.circle_id
    join public.study_circle_members sm on sm.circle_id = m.circle_id and sm.user_id = auth.uid()
    where m.id = p_meeting_id and m.status = 'scheduled' and c.status = 'active';
  if not found then
    raise exception 'رابط الاجتماع غير متاح' using errcode = '42501';
  end if;
  return v_url;
end $$;

-- الطاقم يرى حضور الجميع؛ العضو يرى حضوره فقط.
create function public.list_study_meeting_attendance(p_meeting_id uuid)
returns table(user_id uuid, status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_circle uuid;
begin
  select circle_id into v_circle from public.study_meetings where id = p_meeting_id;
  if auth.uid() is null or v_circle is null or (select public.is_study_member(v_circle)) is not true then
    raise exception 'لا تملك صلاحية عرض الحضور' using errcode = '42501';
  end if;
  return query select a.user_id, a.status from public.study_meeting_attendance a
    where a.meeting_id = p_meeting_id
      and (a.user_id = auth.uid() or private.study_role(v_circle, array['creator','supervisor','teacher']) is not null);
end $$;

create function public.mark_study_attendance(p_meeting_id uuid, p_user_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_circle uuid;
begin
  if v_user is null then
    raise exception 'تسجيل الحضور يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_status not in ('present','absent','excused') then
    raise exception 'حالة الحضور غير صالحة' using errcode = '22023';
  end if;
  select circle_id into v_circle from public.study_meetings where id = p_meeting_id;
  if v_circle is null or private.study_role(v_circle, array['creator','supervisor','teacher']) is null then
    raise exception 'لا تملك صلاحية تسجيل الحضور' using errcode = '42501';
  end if;
  if not exists (select 1 from public.study_circle_members m where m.circle_id = v_circle and m.user_id = p_user_id) then
    raise exception 'المستخدم ليس عضوًا في المدارسة' using errcode = '22023';
  end if;
  insert into public.study_meeting_attendance (meeting_id, user_id, status, marked_by)
  values (p_meeting_id, p_user_id, p_status, v_user)
  on conflict (meeting_id, user_id) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now();
end $$;

-- ملخص الاجتماع والنقاط المعلقة؛ يغلق الاجتماع ويُخطر الأعضاء.
create function public.save_study_meeting_summary(p_meeting_id uuid, p_summary text, p_pending_points text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_meeting public.study_meetings%rowtype;
  v_title text;
begin
  if v_user is null then
    raise exception 'حفظ الملخص يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_summary is null or char_length(btrim(p_summary)) = 0 or char_length(p_summary) > 6000
     or char_length(coalesce(p_pending_points,'')) > 3000 then
    raise exception 'ملخص الاجتماع غير صالح' using errcode = '22023';
  end if;
  select * into v_meeting from public.study_meetings where id = p_meeting_id for update;
  if not found or private.study_role(v_meeting.circle_id, array['creator','supervisor','teacher']) is null then
    raise exception 'لا تملك صلاحية كتابة ملخص الاجتماع' using errcode = '42501';
  end if;
  if v_meeting.status = 'cancelled' then
    raise exception 'الاجتماع ملغى' using errcode = 'P0001';
  end if;
  update public.study_meetings set summary = btrim(p_summary), pending_points = coalesce(p_pending_points,''), status = 'completed'
    where id = p_meeting_id;
  if v_meeting.status <> 'completed' then
    select title into v_title from public.study_circles where id = v_meeting.circle_id;
    insert into public.notifications (recipient_id, kind, title, body, link)
    select m.user_id, 'mudarasa', 'ملخص اجتماع في: ' || v_title, v_meeting.title, '/study'
    from public.study_circle_members m where m.circle_id = v_meeting.circle_id and m.user_id <> v_user;
  end if;
end $$;

revoke all on function public.schedule_study_meeting(uuid, text, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.cancel_study_meeting(uuid) from public, anon, authenticated;
revoke all on function public.list_study_meetings(uuid) from public, anon, authenticated;
revoke all on function public.reveal_study_meeting_url(uuid) from public, anon, authenticated;
revoke all on function public.list_study_meeting_attendance(uuid) from public, anon, authenticated;
revoke all on function public.mark_study_attendance(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_study_meeting_summary(uuid, text, text) from public, anon, authenticated;
grant execute on function public.schedule_study_meeting(uuid, text, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.cancel_study_meeting(uuid) to authenticated;
grant execute on function public.list_study_meetings(uuid) to authenticated;
grant execute on function public.reveal_study_meeting_url(uuid) to authenticated;
grant execute on function public.list_study_meeting_attendance(uuid) to authenticated;
grant execute on function public.mark_study_attendance(uuid, uuid, text) to authenticated;
grant execute on function public.save_study_meeting_summary(uuid, text, text) to authenticated;
