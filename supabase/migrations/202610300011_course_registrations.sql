-- ILM-005: free course registration and seat management. Registration is atomic
-- against the course row so two concurrent requests cannot exceed capacity. No
-- payment entitlement or wait-list is created; a full course rejects registration.
create table public.course_registrations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, user_id)
);
create index course_registrations_course_idx on public.course_registrations(course_id, status);
create index course_registrations_user_idx on public.course_registrations(user_id, created_at desc);

alter table public.course_registrations enable row level security;
revoke all on public.course_registrations from public, anon, authenticated;
grant select, insert, update, delete on public.course_registrations to service_role;
grant select on public.course_registrations to authenticated;

-- A student sees their own registrations; a teacher sees registrations for their
-- own courses; administrators see all. Direct writes remain denied.
create policy own_registration_read on public.course_registrations for select to authenticated
  using (user_id = (select auth.uid()));
create policy teacher_registration_read on public.course_registrations for select to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = (select auth.uid())));
create policy admin_registration_read on public.course_registrations for select to authenticated
  using ((select public.is_admin()));

create trigger course_registrations_updated_at before update on public.course_registrations
  for each row execute function private.set_updated_at();

create function public.register_for_course(p_course_id uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_course public.courses%rowtype;
  v_status text;
  v_existing boolean := false;
  v_registered integer;
begin
  if v_user is null then
    raise exception 'التسجيل يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  -- Lock the course row first so concurrent registrations cannot race past capacity.
  select * into v_course from public.courses where id = p_course_id for update;
  if not found then
    raise exception 'المجلس غير موجود' using errcode = 'P0001';
  end if;
  if v_course.status <> 'published' or v_course.access <> 'public'
     or v_course.registration <> 'open'
     or not public.is_teacher_approved(v_course.teacher_id) then
    raise exception 'التسجيل غير متاح لهذا المجلس' using errcode = '42501';
  end if;
  select status into v_status from public.course_registrations
    where course_id = p_course_id and user_id = v_user;
  if found then v_existing := true; end if;
  if v_existing and v_status = 'registered' then
    return 'already_registered';
  end if;
  select count(*) into v_registered from public.course_registrations
    where course_id = p_course_id and status = 'registered';
  if v_registered >= v_course.capacity then
    raise exception 'السعة مكتملة' using errcode = 'P0001';
  end if;
  if v_existing then
    update public.course_registrations set status = 'registered', updated_at = now()
      where course_id = p_course_id and user_id = v_user;
  else
    insert into public.course_registrations (course_id, user_id, status)
      values (p_course_id, v_user, 'registered');
  end if;
  return 'registered';
end $$;

create function public.cancel_course_registration(p_course_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'إلغاء التسجيل يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  update public.course_registrations set status = 'cancelled', updated_at = now()
    where course_id = p_course_id and user_id = v_user and status = 'registered';
  if not found then
    raise exception 'لا يوجد تسجيل نشط لإلغائه' using errcode = 'P0001';
  end if;
end $$;

create function public.list_course_registrations(p_course_id uuid)
returns table (registration_id uuid, registrant_id uuid, registration_status text, registered_at timestamptz)
language sql security definer set search_path = '' as $$
  select r.id, r.user_id, r.status, r.created_at
    from public.course_registrations r
    join public.courses c on c.id = r.course_id
   where r.course_id = p_course_id
     and r.status = 'registered'
     and (c.teacher_id = (select auth.uid()) or (select public.is_admin()))
   order by r.created_at;
$$;

revoke all on function public.register_for_course(uuid) from public, anon, authenticated;
revoke all on function public.cancel_course_registration(uuid) from public, anon, authenticated;
revoke all on function public.list_course_registrations(uuid) from public, anon, authenticated;
grant execute on function public.register_for_course(uuid) to authenticated;
grant execute on function public.cancel_course_registration(uuid) to authenticated;
grant execute on function public.list_course_registrations(uuid) to authenticated;
