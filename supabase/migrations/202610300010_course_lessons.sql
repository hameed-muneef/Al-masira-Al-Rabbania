-- ILM-003: lesson items for a series or course. Draft-only editing avoids
-- changing material after people see a published offering.
create table public.course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  position integer not null check (position between 1 and 100),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text not null default '' check (char_length(description)<=3000),
  starts_at timestamptz,
  youtube_url text not null default '' check (char_length(youtube_url)<=500),
  created_at timestamptz not null default now(),
  unique (course_id,position)
);
create index course_lessons_course_idx on public.course_lessons(course_id,position);
alter table public.course_lessons enable row level security;
revoke all on public.course_lessons from public,anon,authenticated;
grant select on public.course_lessons to anon,authenticated;
grant select,insert,update,delete on public.course_lessons to service_role;
create policy visible_course_lessons_read on public.course_lessons for select to anon,authenticated
  using (exists(select 1 from public.courses where id=course_id));

create function public.save_course_lesson(p_course_id uuid,p_lesson_id uuid,p_position integer,
  p_title text,p_description text default '',p_starts_at timestamptz default null,p_youtube_url text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_course public.courses%rowtype; v_id uuid;
begin
  if v_actor is null or not public.is_approved_teacher() then raise exception 'اعتماد المعلم مطلوب' using errcode='42501'; end if;
  select * into v_course from public.courses where id=p_course_id for update;
  if not found or v_course.teacher_id<>v_actor then raise exception 'لا تملك صلاحية هذا المجلس' using errcode='42501'; end if;
  if v_course.status<>'draft' then raise exception 'المسودة فقط قابلة للتعديل' using errcode='P0001'; end if;
  if v_course.kind='lesson' or p_position is null or p_position not between 1 and 100
     or p_title is null or char_length(btrim(p_title)) not between 3 and 160
     or char_length(coalesce(p_description,''))>3000 or char_length(coalesce(p_youtube_url,''))>500
     or (coalesce(p_youtube_url,'')<>'' and p_youtube_url !~* '^https://(www\.)?(youtube\.com|youtu\.be)/') then
    raise exception 'بيانات الدرس غير صالحة' using errcode='22023';
  end if;
  if p_lesson_id is null then
    insert into public.course_lessons(course_id,position,title,description,starts_at,youtube_url)
      values(p_course_id,p_position,btrim(p_title),coalesce(p_description,''),p_starts_at,coalesce(p_youtube_url,''))
      returning id into v_id;
  else
    update public.course_lessons set position=p_position,title=btrim(p_title),description=coalesce(p_description,''),
      starts_at=p_starts_at,youtube_url=coalesce(p_youtube_url,'') where id=p_lesson_id and course_id=p_course_id returning id into v_id;
    if v_id is null then raise exception 'الدرس غير موجود' using errcode='P0001'; end if;
  end if;
  return v_id;
end $$;

create function public.remove_course_lesson(p_course_id uuid,p_lesson_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_course public.courses%rowtype;
begin
  if v_actor is null or not public.is_approved_teacher() then raise exception 'اعتماد المعلم مطلوب' using errcode='42501'; end if;
  select * into v_course from public.courses where id=p_course_id for update;
  if not found or v_course.teacher_id<>v_actor then raise exception 'لا تملك صلاحية هذا المجلس' using errcode='42501'; end if;
  if v_course.status<>'draft' then raise exception 'المسودة فقط قابلة للتعديل' using errcode='P0001'; end if;
  delete from public.course_lessons where id=p_lesson_id and course_id=p_course_id;
  if not found then raise exception 'الدرس غير موجود' using errcode='P0001'; end if;
end $$;

create or replace function public.set_course_status(p_course_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_course public.courses%rowtype; v_count integer;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select * into v_course from public.courses where id=p_course_id for update;
  if not found or v_course.teacher_id<>v_actor then raise exception 'لا تملك صلاحية هذا المجلس' using errcode='42501'; end if;
  if p_status='published' then
    if not public.is_approved_teacher() then raise exception 'اعتماد المعلم مطلوب للنشر' using errcode='42501'; end if;
    if v_course.status<>'draft' or v_course.summary='' or v_course.objectives='' or v_course.schedule_description='' or v_course.starts_at is null then
      raise exception 'أكمل وصف المجلس وأهدافه وجدوله قبل النشر' using errcode='P0001';
    end if;
    if v_course.kind in ('series','course') then
      select count(*) into v_count from public.course_lessons where course_id=p_course_id;
      if (v_course.kind='series' and v_count<2) or (v_course.kind='course' and v_count<1) then
        raise exception 'أضف دروس المجلس قبل النشر' using errcode='P0001';
      end if;
    end if;
  elsif p_status in ('closed','cancelled') then
    if v_course.status not in ('draft','published') then raise exception 'المجلس مغلق بالفعل' using errcode='P0001'; end if;
  else raise exception 'حالة غير صالحة' using errcode='22023'; end if;
  update public.courses set status=p_status,updated_at=now() where id=p_course_id;
end $$;
revoke all on function public.save_course_lesson(uuid,uuid,integer,text,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.remove_course_lesson(uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_course_lesson(uuid,uuid,integer,text,text,timestamptz,text) to authenticated;
grant execute on function public.remove_course_lesson(uuid,uuid) to authenticated;
