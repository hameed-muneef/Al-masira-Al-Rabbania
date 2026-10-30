-- ILM-003: free educational offerings. A lesson, a lesson series, and a course
-- share one lifecycle. No payment entitlement or media recording is created.
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id),
  kind text not null check (kind in ('lesson','series','course')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  summary text not null default '' check (char_length(summary)<=3000),
  objectives text not null default '' check (char_length(objectives)<=3000),
  prerequisites text not null default '' check (char_length(prerequisites)<=2000),
  level text not null default 'all' check (level in ('all','beginner','intermediate','advanced')),
  category text not null default '' check (char_length(category)<=120),
  schedule_description text not null default '' check (char_length(schedule_description)<=1000),
  starts_at timestamptz,
  time_zone text not null default 'Africa/Cairo' check (char_length(time_zone) between 1 and 100),
  capacity integer not null default 30 check (capacity between 1 and 100),
  access text not null default 'public' check (access in ('public','private')),
  registration text not null default 'open' check (registration in ('open','approval','invite')),
  youtube_url text not null default '' check (char_length(youtube_url)<=500),
  status text not null default 'draft' check (status in ('draft','published','closed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index courses_teacher_idx on public.courses(teacher_id,created_at desc);
create index courses_public_idx on public.courses(starts_at,id) where status='published' and access='public';

-- Do not expose a suspended teacher's public offerings. The helper avoids
-- RLS recursion through teacher_applications in the courses policy.
create function public.is_teacher_approved(p_teacher_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.teacher_applications where user_id=p_teacher_id
    and status='approved' and identity_status='approved'
    and qualification_status='approved' and endorsement_status='approved');
$$;
revoke all on function public.is_teacher_approved(uuid) from public,anon,authenticated;
grant execute on function public.is_teacher_approved(uuid) to anon,authenticated;

alter table public.courses enable row level security;
revoke all on public.courses from public,anon,authenticated;
grant select on public.courses to anon,authenticated;
grant select,insert,update,delete on public.courses to service_role;
create policy published_course_read on public.courses for select to anon,authenticated
  using (status='published' and access='public' and (select public.is_teacher_approved(teacher_id)));
create policy own_or_admin_course_read on public.courses for select to authenticated
  using (teacher_id=(select auth.uid()) or (select public.is_admin()));

create function private.validate_course_fields(p_kind text,p_title text,p_level text,p_category text,
  p_capacity integer,p_access text,p_registration text,p_time_zone text,p_youtube_url text,
  p_summary text,p_objectives text,p_prerequisites text,p_schedule_description text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_kind is null or p_kind not in ('lesson','series','course')
     or p_title is null or char_length(btrim(p_title)) not between 3 and 160
     or p_level is null or p_level not in ('all','beginner','intermediate','advanced')
     or p_capacity is null or p_capacity not between 1 and 100
     or p_access is null or p_access not in ('public','private')
     or p_registration is null or p_registration not in ('open','approval','invite')
     or (p_access='private' and p_registration='open')
     or p_time_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_time_zone)
     or char_length(coalesce(p_category,''))>120
     or char_length(coalesce(p_youtube_url,''))>500
     or (coalesce(p_youtube_url,'')<>'' and p_youtube_url !~* '^https://(www\.)?(youtube\.com|youtu\.be)/')
     or char_length(coalesce(p_summary,''))>3000 or char_length(coalesce(p_objectives,''))>3000
     or char_length(coalesce(p_prerequisites,''))>2000 or char_length(coalesce(p_schedule_description,''))>1000 then
    raise exception 'بيانات الدورة غير صالحة' using errcode='22023';
  end if;
end $$;
revoke all on function private.validate_course_fields(text,text,text,text,integer,text,text,text,text,text,text,text,text) from public,anon,authenticated;

create function public.create_course(
  p_kind text,p_title text,p_summary text default '',p_objectives text default '',
  p_prerequisites text default '',p_level text default 'all',p_category text default '',
  p_schedule_description text default '',p_starts_at timestamptz default null,
  p_time_zone text default 'Africa/Cairo',p_capacity integer default 30,
  p_access text default 'public',p_registration text default 'open',p_youtube_url text default ''
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_teacher uuid := (select auth.uid()); v_id uuid;
begin
  if v_teacher is null or not public.is_approved_teacher() then
    raise exception 'اعتماد المعلم مطلوب' using errcode='42501';
  end if;
  perform private.validate_course_fields(p_kind,p_title,p_level,p_category,p_capacity,
    p_access,p_registration,p_time_zone,p_youtube_url,p_summary,p_objectives,p_prerequisites,p_schedule_description);
  insert into public.courses(teacher_id,kind,title,summary,objectives,prerequisites,level,category,
    schedule_description,starts_at,time_zone,capacity,access,registration,youtube_url)
    values(v_teacher,p_kind,btrim(p_title),coalesce(p_summary,''),coalesce(p_objectives,''),
      coalesce(p_prerequisites,''),p_level,coalesce(p_category,''),coalesce(p_schedule_description,''),
      p_starts_at,p_time_zone,p_capacity,p_access,p_registration,coalesce(p_youtube_url,'')) returning id into v_id;
  return v_id;
end $$;

create function public.update_course(
  p_course_id uuid,p_kind text,p_title text,p_summary text,p_objectives text,
  p_prerequisites text,p_level text,p_category text,p_schedule_description text,
  p_starts_at timestamptz,p_time_zone text,p_capacity integer,p_access text,
  p_registration text,p_youtube_url text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_teacher uuid := (select auth.uid()); v_course public.courses%rowtype;
begin
  if v_teacher is null or not public.is_approved_teacher() then raise exception 'اعتماد المعلم مطلوب' using errcode='42501'; end if;
  select * into v_course from public.courses where id=p_course_id for update;
  if not found or v_course.teacher_id<>v_teacher then raise exception 'لا تملك صلاحية تعديل هذا المجلس' using errcode='42501'; end if;
  if v_course.status<>'draft' then raise exception 'المسودة فقط قابلة للتعديل' using errcode='P0001'; end if;
  perform private.validate_course_fields(p_kind,p_title,p_level,p_category,p_capacity,
    p_access,p_registration,p_time_zone,p_youtube_url,p_summary,p_objectives,p_prerequisites,p_schedule_description);
  update public.courses set kind=p_kind,title=btrim(p_title),summary=coalesce(p_summary,''),
    objectives=coalesce(p_objectives,''),prerequisites=coalesce(p_prerequisites,''),level=p_level,
    category=coalesce(p_category,''),schedule_description=coalesce(p_schedule_description,''),
    starts_at=p_starts_at,time_zone=p_time_zone,capacity=p_capacity,access=p_access,
    registration=p_registration,youtube_url=coalesce(p_youtube_url,''),updated_at=now() where id=p_course_id;
end $$;

create function public.set_course_status(p_course_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_course public.courses%rowtype;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select * into v_course from public.courses where id=p_course_id for update;
  if not found or v_course.teacher_id<>v_actor then raise exception 'لا تملك صلاحية هذا المجلس' using errcode='42501'; end if;
  if p_status='published' then
    if not public.is_approved_teacher() then raise exception 'اعتماد المعلم مطلوب للنشر' using errcode='42501'; end if;
    if v_course.status<>'draft' or v_course.summary='' or v_course.objectives='' or v_course.schedule_description='' or v_course.starts_at is null then
      raise exception 'أكمل وصف المجلس وأهدافه وجدوله قبل النشر' using errcode='P0001';
    end if;
  elsif p_status in ('closed','cancelled') then
    if v_course.status not in ('draft','published') then raise exception 'المجلس مغلق بالفعل' using errcode='P0001'; end if;
  else raise exception 'حالة غير صالحة' using errcode='22023'; end if;
  update public.courses set status=p_status,updated_at=now() where id=p_course_id;
end $$;
revoke all on function public.create_course(text,text,text,text,text,text,text,text,timestamptz,text,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.update_course(uuid,text,text,text,text,text,text,text,text,timestamptz,text,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.set_course_status(uuid,text) from public,anon,authenticated;
grant execute on function public.create_course(text,text,text,text,text,text,text,text,timestamptz,text,integer,text,text,text) to authenticated;
grant execute on function public.update_course(uuid,text,text,text,text,text,text,text,text,timestamptz,text,integer,text,text,text) to authenticated;
grant execute on function public.set_course_status(uuid,text) to authenticated;
