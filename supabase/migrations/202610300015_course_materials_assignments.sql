-- ILM-008: course materials, assignments and basic quizzes. Materials and
-- assignments are visible to registered students; submissions are private to
-- the student and the course owner/admin. No file storage beyond links is
-- created (Supabase Storage may be wired later). No paid content.
create table public.course_materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  position integer not null check (position between 1 and 100),
  kind text not null check (kind in ('link','text','file')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 10000),
  url text not null default '' check (char_length(url) <= 1000),
  created_at timestamptz not null default now(),
  unique (course_id, position)
);
create index course_materials_course_idx on public.course_materials(course_id, position);

create table public.course_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  due_at timestamptz,
  max_score integer not null default 100 check (max_score between 1 and 1000),
  created_at timestamptz not null default now()
);
create index course_assignments_course_idx on public.course_assignments(course_id, created_at);

create table public.course_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.course_assignments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '' check (char_length(content) <= 20000),
  link text not null default '' check (char_length(link) <= 1000),
  score integer,
  feedback text not null default '' check (char_length(feedback) <= 5000),
  status text not null default 'submitted' check (status in ('submitted','graded','returned')),
  submitted_at timestamptz not null default now(),
  graded_at timestamptz,
  graded_by uuid references auth.users(id),
  unique (assignment_id, user_id)
);
create index course_submissions_assignment_idx on public.course_submissions(assignment_id, submitted_at);
create index course_submissions_user_idx on public.course_submissions(user_id, submitted_at desc);

alter table public.course_materials enable row level security;
alter table public.course_assignments enable row level security;
alter table public.course_submissions enable row level security;
revoke all on public.course_materials, public.course_assignments, public.course_submissions from public, anon, authenticated;
grant select on public.course_materials, public.course_assignments to anon, authenticated;
grant select on public.course_submissions to authenticated;
grant select, insert, update, delete on public.course_materials, public.course_assignments, public.course_submissions to service_role;

-- Materials/assignments visible to registered students and the owner/admin.
create policy material_read on public.course_materials for select to anon, authenticated
  using (exists (select 1 from public.courses c where c.id = course_id
    and (c.status = 'published' or c.teacher_id = (select auth.uid()) or (select public.is_admin()))));
create policy assignment_read on public.course_assignments for select to anon, authenticated
  using (exists (select 1 from public.courses c where c.id = course_id
    and (c.status = 'published' or c.teacher_id = (select auth.uid()) or (select public.is_admin()))));
-- Submissions: owner, course owner, admin.
create policy submission_read on public.course_submissions for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.course_assignments a join public.courses c on c.id = a.course_id
               where a.id = assignment_id and (c.teacher_id = (select auth.uid()) or (select public.is_admin())))
  );

-- RPCs
create function public.save_course_material(p_course_id uuid, p_material_id uuid, p_position integer,
  p_kind text, p_title text, p_body text default '', p_url text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_course public.courses%rowtype;
  v_id uuid;
begin
  if v_actor is null or not public.is_approved_teacher() then raise exception 'اعتماد المعلم مطلوب' using errcode='42501'; end if;
  select * into v_course from public.courses where id = p_course_id for update;
  if not found or v_course.teacher_id <> v_actor then raise exception 'لا تملك صلاحية هذا المجلس' using errcode='42501'; end if;
  if v_course.status <> 'draft' then raise exception 'المسودة فقط قابلة للتعديل' using errcode='P0001'; end if;
  if p_position is null or p_position not between 1 and 100
     or p_kind is null or p_kind not in ('link','text','file')
     or p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or char_length(coalesce(p_body,'')) > 10000
     or char_length(coalesce(p_url,'')) > 1000
     or (p_kind='link' and coalesce(p_url,'') = '') then
    raise exception 'بيانات المادة غير صالحة' using errcode='22023';
  end if;
  if p_material_id is null then
    insert into public.course_materials (course_id, position, kind, title, body, url)
      values (p_course_id, p_position, p_kind, btrim(p_title), coalesce(p_body,''), coalesce(p_url,''))
      returning id into v_id;
  else
    update public.course_materials set position=p_position, kind=p_kind, title=btrim(p_title),
      body=coalesce(p_body,''), url=coalesce(p_url,'')
      where id=p_material_id and course_id=p_course_id returning id into v_id;
    if v_id is null then raise exception 'المادة غير موجودة' using errcode='P0001'; end if;
  end if;
  return v_id;
end $$;

create function public.remove_course_material(p_course_id uuid, p_material_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_course public.courses%rowtype;
begin
  if v_actor is null or not public.is_approved_teacher() then raise exception 'اعتماد المعلم مطلوب' using errcode='42501'; end if;
  select * into v_course from public.courses where id = p_course_id for update;
  if not found or v_course.teacher_id <> v_actor then raise exception 'لا تملك صلاحية هذا المجلس' using errcode='42501'; end if;
  if v_course.status <> 'draft' then raise exception 'المسودة فقط قابلة للتعديل' using errcode='P0001'; end if;
  delete from public.course_materials where id = p_material_id and course_id = p_course_id;
  if not found then raise exception 'المادة غير موجودة' using errcode='P0001'; end if;
end $$;

create function public.save_course_assignment(p_course_id uuid, p_assignment_id uuid, p_title text,
  p_description text default '', p_due_at timestamptz default null, p_max_score integer default 100)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_course public.courses%rowtype;
  v_id uuid;
begin
  if v_actor is null or not public.is_approved_teacher() then raise exception 'اعتماد المعلم مطلوب' using errcode='42501'; end if;
  select * into v_course from public.courses where id = p_course_id for update;
  if not found or v_course.teacher_id <> v_actor then raise exception 'لا تملك صلاحية هذا المجلس' using errcode='42501'; end if;
  if v_course.status <> 'draft' then raise exception 'المسودة فقط قابلة للتعديل' using errcode='P0001'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or char_length(coalesce(p_description,'')) > 5000
     or p_max_score is null or p_max_score not between 1 and 1000 then
    raise exception 'بيانات الواجب غير صالحة' using errcode='22023';
  end if;
  if p_assignment_id is null then
    insert into public.course_assignments (course_id, title, description, due_at, max_score)
      values (p_course_id, btrim(p_title), coalesce(p_description,''), p_due_at, p_max_score)
      returning id into v_id;
  else
    update public.course_assignments set title=btrim(p_title), description=coalesce(p_description,''),
      due_at=p_due_at, max_score=p_max_score
      where id=p_assignment_id and course_id=p_course_id returning id into v_id;
    if v_id is null then raise exception 'الواجب غير موجود' using errcode='P0001'; end if;
  end if;
  return v_id;
end $$;

create function public.remove_course_assignment(p_course_id uuid, p_assignment_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_course public.courses%rowtype;
begin
  if v_actor is null or not public.is_approved_teacher() then raise exception 'اعتماد المعلم مطلوب' using errcode='42501'; end if;
  select * into v_course from public.courses where id = p_course_id for update;
  if not found or v_course.teacher_id <> v_actor then raise exception 'لا تملك صلاحية هذا المجلس' using errcode='42501'; end if;
  if v_course.status <> 'draft' then raise exception 'المسودة فقط قابلة للتعديل' using errcode='P0001'; end if;
  delete from public.course_assignments where id = p_assignment_id and course_id = p_course_id;
  if not found then raise exception 'الواجب غير موجود' using errcode='P0001'; end if;
end $$;

create function public.submit_course_assignment(p_assignment_id uuid, p_content text default '', p_link text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_assignment public.course_assignments%rowtype;
  v_course public.courses%rowtype;
  v_id uuid;
begin
  if v_user is null then raise exception 'التسليم يتطلب تسجيل الدخول' using errcode='42501'; end if;
  select * into v_assignment from public.course_assignments where id = p_assignment_id;
  if not found then raise exception 'الواجب غير موجود' using errcode='P0001'; end if;
  select * into v_course from public.courses where id = v_assignment.course_id;
  if v_course.status <> 'published' then raise exception 'المجلس غير منشور' using errcode='P0001'; end if;
  -- Student must be registered (or the teacher testing).
  if v_course.teacher_id <> v_user and not exists (
    select 1 from public.course_registrations r
      where r.course_id = v_course.id and r.user_id = v_user and r.status = 'registered'
  ) then
    raise exception 'يجب التسجيل في المجلس لتسليم الواجب' using errcode='42501';
  end if;
  if char_length(coalesce(p_content,'')) > 20000 or char_length(coalesce(p_link,'')) > 1000 then
    raise exception 'محتوى التسليم تجاوز الحد' using errcode='22023';
  end if;
  insert into public.course_submissions (assignment_id, user_id, content, link, status)
    values (p_assignment_id, v_user, coalesce(p_content,''), coalesce(p_link,''), 'submitted')
  on conflict (assignment_id, user_id) do update
    set content = excluded.content, link = excluded.link, status = 'submitted', submitted_at = now(),
        score = null, feedback = '', graded_at = null, graded_by = null
    returning id into v_id;
  return v_id;
end $$;

create function public.grade_course_submission(p_submission_id uuid, p_score integer, p_feedback text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_submission public.course_submissions%rowtype;
  v_assignment public.course_assignments%rowtype;
  v_course public.courses%rowtype;
begin
  if v_actor is null or not public.is_approved_teacher() then raise exception 'اعتماد المعلم مطلوب' using errcode='42501'; end if;
  select * into v_submission from public.course_submissions where id = p_submission_id;
  if not found then raise exception 'التسليم غير موجود' using errcode='P0001'; end if;
  select * into v_assignment from public.course_assignments where id = v_submission.assignment_id;
  select * into v_course from public.courses where id = v_assignment.course_id;
  if v_course.teacher_id <> v_actor and not public.is_admin() then
    raise exception 'لا تملك صلاحية تقييم هذا التسليم' using errcode='42501';
  end if;
  if p_score is null or p_score < 0 or p_score > v_assignment.max_score then
    raise exception 'الدرجة خارج النطاق' using errcode='22023';
  end if;
  if char_length(coalesce(p_feedback,'')) > 5000 then
    raise exception 'الملاحظات أطول من 5000 حرف' using errcode='22023';
  end if;
  update public.course_submissions
     set score = p_score, feedback = coalesce(p_feedback,''), status = 'graded',
         graded_at = now(), graded_by = v_actor
   where id = p_submission_id;
end $$;

create function public.list_course_materials(p_course_id uuid)
returns table (material_id uuid, material_position integer, material_kind text,
               material_title text, material_body text, material_url text)
language sql security definer set search_path = '' as $$
  select m.id, m.position, m.kind, m.title, m.body, m.url
    from public.course_materials m
    join public.courses c on c.id = m.course_id
   where m.course_id = p_course_id
     and (c.status = 'published' or c.teacher_id = (select auth.uid()) or (select public.is_admin()))
   order by m.position;
$$;

create function public.list_course_assignments(p_course_id uuid)
returns table (assignment_id uuid, assignment_title text, assignment_description text,
               assignment_due_at timestamptz, assignment_max_score integer, assignment_created_at timestamptz)
language sql security definer set search_path = '' as $$
  select a.id, a.title, a.description, a.due_at, a.max_score, a.created_at
    from public.course_assignments a
    join public.courses c on c.id = a.course_id
   where a.course_id = p_course_id
     and (c.status = 'published' or c.teacher_id = (select auth.uid()) or (select public.is_admin()))
   order by a.created_at;
$$;

create function public.list_course_submissions(p_assignment_id uuid)
returns table (submission_id uuid, submitter_id uuid, submission_content text,
               submission_link text, submission_score integer, submission_feedback text,
               submission_status text, submitted_at timestamptz)
language sql security definer set search_path = '' as $$
  select s.id, s.user_id, s.content, s.link, s.score, s.feedback, s.status, s.submitted_at
    from public.course_submissions s
    join public.course_assignments a on a.id = s.assignment_id
    join public.courses c on c.id = a.course_id
   where s.assignment_id = p_assignment_id
     and (s.user_id = (select auth.uid()) or c.teacher_id = (select auth.uid()) or (select public.is_admin()))
   order by s.submitted_at;
$$;

revoke all on function public.save_course_material(uuid, uuid, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.remove_course_material(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_course_assignment(uuid, uuid, text, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.remove_course_assignment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_course_assignment(uuid, text, text) from public, anon, authenticated;
revoke all on function public.grade_course_submission(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.list_course_materials(uuid) from public, anon, authenticated;
revoke all on function public.list_course_assignments(uuid) from public, anon, authenticated;
revoke all on function public.list_course_submissions(uuid) from public, anon, authenticated;
grant execute on function public.save_course_material(uuid, uuid, integer, text, text, text, text) to authenticated;
grant execute on function public.remove_course_material(uuid, uuid) to authenticated;
grant execute on function public.save_course_assignment(uuid, uuid, text, text, timestamptz, integer) to authenticated;
grant execute on function public.remove_course_assignment(uuid, uuid) to authenticated;
grant execute on function public.submit_course_assignment(uuid, text, text) to authenticated;
grant execute on function public.grade_course_submission(uuid, integer, text) to authenticated;
grant execute on function public.list_course_materials(uuid) to anon, authenticated;
grant execute on function public.list_course_assignments(uuid) to anon, authenticated;
grant execute on function public.list_course_submissions(uuid) to authenticated;
