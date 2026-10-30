-- ILM-006: recurring course sessions, attendance and time zones. Session times are
-- stored in UTC with an IANA time zone on the course; display converts locally.
-- No recording or media storage is created.
create table public.course_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meeting_url text not null default '' check (char_length(meeting_url) <= 500),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  notes text not null default '' check (char_length(notes) <= 1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index course_sessions_course_idx on public.course_sessions(course_id, starts_at);

create table public.course_attendance (
  session_id uuid not null references public.course_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'present' check (status in ('present','absent','excused','late')),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  note text not null default '' check (char_length(note) <= 500),
  primary key (session_id, user_id)
);
create index course_attendance_user_idx on public.course_attendance(user_id, recorded_at desc);

alter table public.course_sessions enable row level security;
alter table public.course_attendance enable row level security;
revoke all on public.course_sessions, public.course_attendance from public, anon, authenticated;
grant select on public.course_sessions, public.course_attendance to anon, authenticated;
grant select, insert, update, delete on public.course_sessions, public.course_attendance to service_role;

-- Sessions visible to registered students and the course owner/admin.
create policy session_read on public.course_sessions for select to anon, authenticated
  using (
    exists (select 1 from public.courses c where c.id = course_id
      and (c.status = 'published' or c.teacher_id = (select auth.uid()) or (select public.is_admin())))
  );
-- Attendance visible to the registrant, the course owner, and admins.
create policy attendance_read on public.course_attendance for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.course_sessions s join public.courses c on c.id = s.course_id
               where s.id = session_id and (c.teacher_id = (select auth.uid()) or (select public.is_admin())))
  );

create function public.create_course_session(p_course_id uuid, p_title text, p_starts_at timestamptz,
  p_ends_at timestamptz, p_meeting_url text default '', p_notes text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_course public.courses%rowtype;
  v_id uuid;
begin
  if v_actor is null or not public.is_approved_teacher() then
    raise exception 'اعتماد المعلم مطلوب' using errcode = '42501';
  end if;
  select * into v_course from public.courses where id = p_course_id for update;
  if not found or v_course.teacher_id <> v_actor then
    raise exception 'لا تملك صلاحية هذا المجلس' using errcode = '42501';
  end if;
  if v_course.status <> 'published' then
    raise exception 'المجلس غير منشور' using errcode = 'P0001';
  end if;
  if p_title is null or char_length(btrim(p_title)) > 200
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or char_length(coalesce(p_meeting_url,'')) > 500
     or char_length(coalesce(p_notes,'')) > 1000 then
    raise exception 'بيانات الجلسة غير صالحة' using errcode = '22023';
  end if;
  insert into public.course_sessions (course_id, title, starts_at, ends_at, meeting_url, notes, created_by)
    values (p_course_id, btrim(p_title), p_starts_at, p_ends_at, coalesce(p_meeting_url,''), coalesce(p_notes,''), v_actor)
    returning id into v_id;
  return v_id;
end $$;

create function public.cancel_course_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_session public.course_sessions%rowtype;
  v_course public.courses%rowtype;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  select * into v_session from public.course_sessions where id = p_session_id for update;
  if not found then raise exception 'الجلسة غير موجودة' using errcode = 'P0001'; end if;
  select * into v_course from public.courses where id = v_session.course_id;
  if v_course.teacher_id <> v_actor and not public.is_admin() then
    raise exception 'لا تملك صلاحية إلغاء هذه الجلسة' using errcode = '42501';
  end if;
  if v_session.status = 'cancelled' then return; end if;
  update public.course_sessions set status = 'cancelled' where id = p_session_id;
end $$;

create function public.record_attendance(p_session_id uuid, p_user_id uuid, p_status text, p_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_session public.course_sessions%rowtype;
  v_course public.courses%rowtype;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('present','absent','excused','late') then
    raise exception 'حالة الحضور غير صالحة' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note,'')) > 500 then
    raise exception 'ملاحظة الحضور أطول من 500 حرف' using errcode = '22023';
  end if;
  select * into v_session from public.course_sessions where id = p_session_id;
  if not found then raise exception 'الجلسة غير موجودة' using errcode = 'P0001'; end if;
  select * into v_course from public.courses where id = v_session.course_id;
  if v_course.teacher_id <> v_actor and not public.is_admin() then
    raise exception 'لا تملك صلاحية تسجيل الحضور' using errcode = '42501';
  end if;
  -- Only registered (or the teacher recording self) students may be marked.
  if p_user_id <> v_actor and not exists (
    select 1 from public.course_registrations r
      where r.course_id = v_course.id and r.user_id = p_user_id and r.status = 'registered'
  ) then
    raise exception 'الطالب غير مسجل في المجلس' using errcode = '42501';
  end if;
  insert into public.course_attendance (session_id, user_id, status, recorded_by, note)
    values (p_session_id, p_user_id, p_status, v_actor, coalesce(p_note,''))
  on conflict (session_id, user_id) do update
    set status = excluded.status, recorded_by = excluded.recorded_by,
        recorded_at = now(), note = excluded.note;
end $$;

create function public.list_course_sessions(p_course_id uuid)
returns table (session_id uuid, session_title text, starts_at timestamptz, ends_at timestamptz,
               meeting_url text, session_status text, notes text)
language sql security definer set search_path = '' as $$
  select s.id, s.title, s.starts_at, s.ends_at, s.meeting_url, s.status, s.notes
    from public.course_sessions s
    join public.courses c on c.id = s.course_id
   where s.course_id = p_course_id
     and (c.status = 'published' or c.teacher_id = (select auth.uid()) or (select public.is_admin()))
   order by s.starts_at;
$$;

create function public.list_course_attendance(p_session_id uuid)
returns table (attendee_id uuid, attendance_status text, recorded_at timestamptz, note text)
language sql security definer set search_path = '' as $$
  select a.user_id, a.status, a.recorded_at, a.note
    from public.course_attendance a
    join public.course_sessions s on s.id = a.session_id
    join public.courses c on c.id = s.course_id
   where a.session_id = p_session_id
     and (c.teacher_id = (select auth.uid()) or (select public.is_admin())
          or a.user_id = (select auth.uid()))
   order by a.recorded_at;
$$;

revoke all on function public.create_course_session(uuid, text, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.cancel_course_session(uuid) from public, anon, authenticated;
revoke all on function public.record_attendance(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_course_sessions(uuid) from public, anon, authenticated;
revoke all on function public.list_course_attendance(uuid) from public, anon, authenticated;
grant execute on function public.create_course_session(uuid, text, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.cancel_course_session(uuid) to authenticated;
grant execute on function public.record_attendance(uuid, uuid, text, text) to authenticated;
grant execute on function public.list_course_sessions(uuid) to anon, authenticated;
grant execute on function public.list_course_attendance(uuid) to authenticated;
