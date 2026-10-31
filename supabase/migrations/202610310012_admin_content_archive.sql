-- Admin-managed, reversible archive for shared platform and study-circle content.
-- Source rows stay intact; private reflections, personal notes, submissions, and
-- meeting URLs are intentionally outside the admin listing.

create table public.admin_content_archive (
  content_type text not null check (content_type in (
    'course_lesson','course_material','course_assignment',
    'study_material','study_plan_task','study_note','study_question','study_meeting',
    'circle_announcement','circle_live_session'
  )),
  content_id uuid not null,
  archived_by uuid not null references auth.users(id),
  archived_at timestamptz not null default now(),
  reason text not null default '' check (char_length(reason) <= 500),
  primary key (content_type, content_id)
);
alter table public.admin_content_archive enable row level security;
revoke all on public.admin_content_archive from public, anon, authenticated;

create function private.is_content_archived(p_content_type text, p_content_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_content_archive a
     where a.content_type = p_content_type and a.content_id = p_content_id
  );
$$;
revoke all on function private.is_content_archived(text, uuid) from public;
grant execute on function private.is_content_archived(text, uuid) to anon, authenticated;

create function private.guard_archived_content_mutation()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if tg_op = 'DELETE' then
    v_id := (to_jsonb(old) ->> tg_argv[1])::uuid;
  else
    v_id := (to_jsonb(new) ->> tg_argv[1])::uuid;
  end if;
  if tg_table_name = 'study_plan_tasks' and exists(
    select 1 from public.study_plan_tasks t
     where t.id = v_id and t.material_id is not null
       and private.is_content_archived('study_material', t.material_id)
  ) then
    raise exception 'المادة مؤرشفة؛ استعدها قبل تعديل الخطة' using errcode = '42501';
  end if;
  if tg_table_name = 'study_plan_tasks' and tg_op <> 'DELETE'
     and (to_jsonb(new) ->> 'material_id') is not null
     and private.is_content_archived('study_material', ((to_jsonb(new) ->> 'material_id')::uuid)) then
    raise exception 'المادة مؤرشفة؛ لا يمكن ربط مهمة بها' using errcode = '42501';
  end if;
  if tg_table_name = 'study_task_progress' and exists(
    select 1 from public.study_plan_tasks t
     where t.id = v_id and t.material_id is not null
       and private.is_content_archived('study_material', t.material_id)
  ) then
    raise exception 'المادة مؤرشفة؛ لا يمكن تحديث إنجازها' using errcode = '42501';
  end if;
  if v_id is not null and private.is_content_archived(tg_argv[0], v_id) then
    if tg_op = 'DELETE' and tg_argv[2] = 'purge' and pg_trigger_depth() > 1 then
      delete from public.admin_content_archive
       where content_type = tg_argv[0] and content_id = v_id;
      return old;
    end if;
    raise exception 'المحتوى مؤرشف؛ استعده قبل تعديله' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.guard_archived_content_mutation() from public, anon, authenticated;

create trigger protect_archived_course_lessons before update or delete on public.course_lessons
  for each row execute function private.guard_archived_content_mutation('course_lesson','id','purge');
create trigger protect_archived_course_materials before update or delete on public.course_materials
  for each row execute function private.guard_archived_content_mutation('course_material','id','purge');
create trigger protect_archived_course_assignments before update or delete on public.course_assignments
  for each row execute function private.guard_archived_content_mutation('course_assignment','id','purge');
create trigger protect_archived_study_materials before update or delete on public.study_materials
  for each row execute function private.guard_archived_content_mutation('study_material','id','purge');
create trigger protect_archived_study_plan_tasks before insert or update or delete on public.study_plan_tasks
  for each row execute function private.guard_archived_content_mutation('study_plan_task','id','purge');
create trigger protect_archived_study_notes before update or delete on public.study_notes
  for each row execute function private.guard_archived_content_mutation('study_note','id','purge');
create trigger protect_archived_study_questions before update or delete on public.study_questions
  for each row execute function private.guard_archived_content_mutation('study_question','id','purge');
create trigger protect_archived_study_meetings before update or delete on public.study_meetings
  for each row execute function private.guard_archived_content_mutation('study_meeting','id','purge');
create trigger protect_archived_circle_announcements before update or delete on public.circle_announcements
  for each row execute function private.guard_archived_content_mutation('circle_announcement','id','purge');
create trigger protect_archived_circle_sessions before update or delete on public.circle_live_sessions
  for each row execute function private.guard_archived_content_mutation('circle_live_session','id','purge');
create trigger protect_archived_study_parts before insert or update or delete on public.study_material_parts
  for each row execute function private.guard_archived_content_mutation('study_material','material_id');
create trigger protect_archived_question_replies before insert or update or delete on public.study_question_replies
  for each row execute function private.guard_archived_content_mutation('study_question','question_id');
create trigger protect_archived_task_progress before insert or update or delete on public.study_task_progress
  for each row execute function private.guard_archived_content_mutation('study_plan_task','task_id');
create trigger protect_archived_meeting_attendance before insert or update or delete on public.study_meeting_attendance
  for each row execute function private.guard_archived_content_mutation('study_meeting','meeting_id');
create trigger protect_archived_submissions before insert or update or delete on public.course_submissions
  for each row execute function private.guard_archived_content_mutation('course_assignment','assignment_id');

create function private.assert_admin_archive_page(p_archived boolean, p_limit integer, p_offset integer)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or (select public.is_admin()) is not true then
    raise exception 'صلاحية إدارة المحتوى مطلوبة' using errcode = '42501';
  end if;
  if p_archived is null or p_limit is null or p_limit not between 1 and 100
     or p_offset is null or p_offset < 0 then
    raise exception 'حدود الصفحة غير صالحة' using errcode = '22023';
  end if;
  return true;
end $$;
revoke all on function private.assert_admin_archive_page(boolean, integer, integer) from public, anon, authenticated;

create function public.list_admin_archivable_content(
  p_archived boolean default false, p_limit integer default 100, p_offset integer default 0
)
returns table (
  content_type text, content_id uuid, content_title text, content_summary text, context_title text,
  content_created_at timestamptz, archived_at timestamptz, reason text, total_count bigint
)
language sql stable security definer set search_path = '' as $$
  with items(content_type, content_id, item_title, item_summary, item_container, item_created_at) as (
    select 'course_lesson'::text, lesson_row.id, lesson_row.title, left(lesson_row.description, 500),
      course_row.title, lesson_row.created_at
      from public.course_lessons lesson_row join public.courses course_row on course_row.id = lesson_row.course_id
    union all
    select 'course_material', material_row.id, material_row.title, left(material_row.body, 500),
      course_row.title, material_row.created_at
      from public.course_materials material_row join public.courses course_row on course_row.id = material_row.course_id
    union all
    select 'course_assignment', assignment_row.id, assignment_row.title, left(assignment_row.description, 500),
      course_row.title, assignment_row.created_at
      from public.course_assignments assignment_row join public.courses course_row on course_row.id = assignment_row.course_id
    union all
    select 'study_material', study_material_row.id, study_material_row.title,
      left(study_material_row.description, 500), study_circle_row.title, study_material_row.created_at
      from public.study_materials study_material_row
      join public.study_circles study_circle_row on study_circle_row.id = study_material_row.circle_id
    union all
    select 'study_plan_task', task_row.id, task_row.title, '', study_circle_row.title, task_row.created_at
      from public.study_plan_tasks task_row
      join public.study_circles study_circle_row on study_circle_row.id = task_row.circle_id
    union all
    select 'study_note', note_row.id, coalesce(nullif(note_row.title, ''), note_row.note_type),
      left(note_row.content, 500), study_circle_row.title, note_row.created_at
      from public.study_notes note_row
      join public.study_circles study_circle_row on study_circle_row.id = note_row.circle_id
     where note_row.note_type not in ('personal','reflection')
    union all
    select 'study_question', question_row.id, question_row.title, left(question_row.content, 500),
      study_circle_row.title, question_row.created_at
      from public.study_questions question_row
      join public.study_circles study_circle_row on study_circle_row.id = question_row.circle_id
    union all
    select 'study_meeting', meeting_row.id,
      regexp_replace(meeting_row.title, '(https?://|www[.])[^[:space:]]+|meet[.]google[.]com[^[:space:]]*', '[رابط محجوب]', 'gi'),
      '',
      study_circle_row.title, meeting_row.created_at
      from public.study_meetings meeting_row
      join public.study_circles study_circle_row on study_circle_row.id = meeting_row.circle_id
    union all
    select 'circle_announcement', announcement_row.id, announcement_row.title,
      left(announcement_row.body, 500), study_group_row.name, announcement_row.created_at
      from public.circle_announcements announcement_row
      join public.study_groups study_group_row on study_group_row.id = announcement_row.circle_id
    union all
    select 'circle_live_session', live_session_row.id,
      regexp_replace(live_session_row.title, '(https?://|www[.])[^[:space:]]+|meet[.]google[.]com[^[:space:]]*', '[رابط محجوب]', 'gi'),
      '', study_group_row.name, live_session_row.created_at
      from public.circle_live_sessions live_session_row
      join public.study_groups study_group_row on study_group_row.id = live_session_row.circle_id
  )
  select i.content_type, i.content_id, i.item_title, i.item_summary, i.item_container, i.item_created_at,
         a.archived_at, a.reason, count(*) over()
    from items i
    left join public.admin_content_archive a
      on a.content_type = i.content_type and a.content_id = i.content_id
   where (select private.assert_admin_archive_page(p_archived, p_limit, p_offset))
     and ((p_archived and a.content_id is not null)
      or (not p_archived and a.content_id is null))
   order by coalesce(a.archived_at, i.item_created_at) desc, i.item_title
   limit p_limit offset p_offset;
$$;

create function public.archive_platform_content(p_content_type text, p_content_id uuid, p_reason text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_exists boolean := false;
begin
  if auth.uid() is null or (select public.is_admin()) is not true then
    raise exception 'صلاحية إدارة المحتوى مطلوبة' using errcode = '42501';
  end if;
  if p_content_type is null or p_content_id is null or char_length(coalesce(p_reason,'')) > 500 then
    raise exception 'بيانات الأرشفة غير صالحة' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.admin_content_archive a
     where a.content_type = p_content_type and a.content_id = p_content_id
  ) then
    raise exception 'المحتوى مؤرشف بالفعل' using errcode = 'P0001';
  end if;
  case p_content_type
    when 'course_lesson' then
      select exists(select 1 from public.course_lessons where id = p_content_id) into v_exists;
    when 'course_material' then
      select exists(select 1 from public.course_materials where id = p_content_id) into v_exists;
    when 'course_assignment' then
      select exists(select 1 from public.course_assignments where id = p_content_id) into v_exists;
    when 'study_material' then
      select exists(select 1 from public.study_materials where id = p_content_id) into v_exists;
    when 'study_plan_task' then
      select exists(select 1 from public.study_plan_tasks where id = p_content_id) into v_exists;
    when 'study_note' then
      select exists(select 1 from public.study_notes where id = p_content_id
        and note_type not in ('personal','reflection')) into v_exists;
    when 'study_question' then
      select exists(select 1 from public.study_questions where id = p_content_id) into v_exists;
    when 'study_meeting' then
      select exists(select 1 from public.study_meetings where id = p_content_id) into v_exists;
    when 'circle_announcement' then
      select exists(select 1 from public.circle_announcements where id = p_content_id) into v_exists;
    when 'circle_live_session' then
      select exists(select 1 from public.circle_live_sessions where id = p_content_id) into v_exists;
    else
      raise exception 'نوع المحتوى غير قابل للأرشفة' using errcode = '22023';
  end case;
  if not v_exists then
    raise exception 'المحتوى غير موجود أو غير قابل للأرشفة' using errcode = 'P0001';
  end if;
  insert into public.admin_content_archive(content_type, content_id, archived_by, reason)
  values (p_content_type, p_content_id, auth.uid(), btrim(coalesce(p_reason,'')));
end $$;

create function public.restore_platform_content(p_content_type text, p_content_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (select public.is_admin()) is not true then
    raise exception 'صلاحية إدارة المحتوى مطلوبة' using errcode = '42501';
  end if;
  if p_content_type is null or p_content_id is null then
    raise exception 'بيانات الاستعادة غير صالحة' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.admin_content_archive a
     where a.content_type = p_content_type and a.content_id = p_content_id
  ) then
    raise exception 'المحتوى غير مؤرشف' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.course_lessons where p_content_type = 'course_lesson' and id = p_content_id
    union all select 1 from public.course_materials where p_content_type = 'course_material' and id = p_content_id
    union all select 1 from public.course_assignments where p_content_type = 'course_assignment' and id = p_content_id
    union all select 1 from public.study_materials where p_content_type = 'study_material' and id = p_content_id
    union all select 1 from public.study_plan_tasks where p_content_type = 'study_plan_task' and id = p_content_id
    union all select 1 from public.study_notes where p_content_type = 'study_note' and id = p_content_id
      and note_type not in ('personal','reflection')
    union all select 1 from public.study_questions where p_content_type = 'study_question' and id = p_content_id
    union all select 1 from public.study_meetings where p_content_type = 'study_meeting' and id = p_content_id
    union all select 1 from public.circle_announcements where p_content_type = 'circle_announcement' and id = p_content_id
    union all select 1 from public.circle_live_sessions where p_content_type = 'circle_live_session' and id = p_content_id
  ) then
    raise exception 'تعذر الاستعادة لأن المحتوى الأصلي لم يعد موجودًا' using errcode = 'P0001';
  end if;
  delete from public.admin_content_archive
   where content_type = p_content_type and content_id = p_content_id;
end $$;

revoke all on function public.list_admin_archivable_content(boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.archive_platform_content(text, uuid, text) from public, anon, authenticated;
revoke all on function public.restore_platform_content(text, uuid) from public, anon, authenticated;
grant execute on function public.list_admin_archivable_content(boolean, integer, integer) to authenticated;
grant execute on function public.archive_platform_content(text, uuid, text) to authenticated;
grant execute on function public.restore_platform_content(text, uuid) to authenticated;

drop policy visible_course_lessons_read on public.course_lessons;
create policy visible_course_lessons_read on public.course_lessons for select to anon, authenticated
  using (exists(select 1 from public.courses c where c.id = course_id)
    and not private.is_content_archived('course_lesson', id));

drop policy material_read on public.course_materials;
create policy material_read on public.course_materials for select to anon, authenticated
  using (exists (select 1 from public.courses c where c.id = course_id
    and (c.status = 'published' or c.teacher_id = (select auth.uid()) or (select public.is_admin())))
    and not private.is_content_archived('course_material', id));
drop policy assignment_read on public.course_assignments;
create policy assignment_read on public.course_assignments for select to anon, authenticated
  using (exists (select 1 from public.courses c where c.id = course_id
    and (c.status = 'published' or c.teacher_id = (select auth.uid()) or (select public.is_admin())))
    and not private.is_content_archived('course_assignment', id));

create or replace function public.list_course_materials(p_course_id uuid)
returns table (material_id uuid, material_position integer, material_kind text,
               material_title text, material_body text, material_url text)
language sql security definer set search_path = '' as $$
  select m.id, m.position, m.kind, m.title, m.body, m.url
    from public.course_materials m
    join public.courses c on c.id = m.course_id
   where m.course_id = p_course_id
     and (c.status = 'published' or c.teacher_id = (select auth.uid()) or (select public.is_admin()))
     and not private.is_content_archived('course_material', m.id)
   order by m.position;
$$;

create or replace function public.list_course_assignments(p_course_id uuid)
returns table (assignment_id uuid, assignment_title text, assignment_description text,
               assignment_due_at timestamptz, assignment_max_score integer, assignment_created_at timestamptz)
language sql security definer set search_path = '' as $$
  select a.id, a.title, a.description, a.due_at, a.max_score, a.created_at
    from public.course_assignments a
    join public.courses c on c.id = a.course_id
   where a.course_id = p_course_id
     and (c.status = 'published' or c.teacher_id = (select auth.uid()) or (select public.is_admin()))
     and not private.is_content_archived('course_assignment', a.id)
   order by a.created_at;
$$;

create or replace function public.is_study_note_visible(p_note_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.study_notes n
     where n.id = p_note_id
       and (select public.is_study_member(n.circle_id))
       and not private.is_content_archived('study_note', n.id)
  );
$$;

drop policy study_note_member_read on public.study_notes;
create policy study_note_member_read on public.study_notes for select to authenticated
  using ((select public.is_study_member(circle_id))
    and not private.is_content_archived('study_note', id));
drop policy study_comment_member_read on public.study_note_comments;
create policy study_comment_member_read on public.study_note_comments for select to authenticated
  using ((select public.is_study_member(circle_id)) and public.is_study_note_visible(note_id));
drop policy study_reaction_member_read on public.study_note_reactions;
create policy study_reaction_member_read on public.study_note_reactions for select to authenticated
  using (public.is_study_note_visible(note_id));

create or replace function public.list_study_notes(p_circle_id uuid)
returns table (id uuid, author_id uuid, note_type text, title text, content text, part_id uuid,
  page_start integer, page_end integer, source_ref text, helpful_count bigint, created_at timestamptz)
language sql security definer set search_path = '' as $$
  select n.id, n.author_id, n.note_type, n.title, n.content, n.part_id, n.page_start, n.page_end, n.source_ref,
    (select count(*) from public.study_note_reactions r where r.note_id = n.id and r.is_helpful),
    n.created_at
  from public.study_notes n
  where n.circle_id = p_circle_id
    and (select public.is_study_member(p_circle_id))
    and not private.is_content_archived('study_note', n.id)
$$;

drop policy study_material_member_read on public.study_materials;
create policy study_material_member_read on public.study_materials for select to authenticated
  using ((select public.is_study_member(circle_id))
    and not private.is_content_archived('study_material', id));
drop policy study_part_member_read on public.study_material_parts;
create policy study_part_member_read on public.study_material_parts for select to authenticated
  using ((select public.is_study_member(circle_id))
    and not private.is_content_archived('study_material', material_id));
drop policy study_task_member_read on public.study_plan_tasks;
create policy study_task_member_read on public.study_plan_tasks for select to authenticated
  using ((select public.is_study_member(circle_id))
    and not private.is_content_archived('study_plan_task', id)
    and (material_id is null or not private.is_content_archived('study_material', material_id)));

create or replace function public.is_study_question_visible(p_question_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.study_questions q
    where q.id = p_question_id
      and (select public.is_study_member(q.circle_id))
      and not private.is_content_archived('study_question', q.id)
  );
$$;

create or replace function public.list_study_questions(p_circle_id uuid)
returns table(
  id uuid, asker_id uuid, title text, content text, part_id uuid,
  status text, is_pinned boolean, reply_count bigint, created_at timestamptz,
  reviewed_by uuid, reviewed_at timestamptz
)
language sql security definer set search_path = '' as $$
  select q.id, q.asker_id, q.title, q.content, q.part_id, q.status, q.is_pinned,
    (select count(*) from public.study_question_replies r where r.question_id = q.id),
    q.created_at, q.reviewed_by, q.reviewed_at
  from public.study_questions q
  where q.circle_id = p_circle_id
    and (select public.is_study_member(p_circle_id))
    and not private.is_content_archived('study_question', q.id)
  order by q.is_pinned desc, q.created_at desc
$$;

create or replace function public.list_study_meetings(p_circle_id uuid)
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
  from public.study_meetings m where m.circle_id = p_circle_id
    and not private.is_content_archived('study_meeting', m.id)
  order by m.starts_at desc;
end $$;

create or replace function public.reveal_study_meeting_url(p_meeting_id uuid)
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
    where m.id = p_meeting_id and m.status = 'scheduled' and c.status = 'active'
      and not private.is_content_archived('study_meeting', m.id);
  if not found then
    raise exception 'رابط الاجتماع غير متاح' using errcode = '42501';
  end if;
  return v_url;
end $$;

drop policy circle_announcement_read on public.circle_announcements;
create policy circle_announcement_read on public.circle_announcements for select to authenticated
  using ((select public.is_group_member(circle_id))
    and not private.is_content_archived('circle_announcement', id));
drop policy circle_session_read on public.circle_live_sessions;
create policy circle_session_read on public.circle_live_sessions for select to authenticated
  using ((select public.is_group_member(circle_id))
    and not private.is_content_archived('circle_live_session', id));

create or replace function public.set_study_plan(p_circle_id uuid, p_tasks jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_task jsonb;
  v_position integer := 0;
  v_existing uuid;
  v_max_position integer;
  v_insert_position integer;
  v_material_id uuid;
  v_part_id uuid;
begin
  if v_user is null then
    raise exception 'تعديل الخطة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if private.study_role(p_circle_id, array['creator','supervisor']) is null then
    raise exception 'خطة الدراسة للمنشئ أو المشرف' using errcode = '42501';
  end if;
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array'
     or jsonb_array_length(p_tasks) not between 1 and 500 then
    raise exception 'قائمة مهام الخطة غير صالحة' using errcode = '22023';
  end if;
  for v_task in select value from jsonb_array_elements(p_tasks) loop
    v_position := v_position + 1;
    if v_task->>'title' is null or char_length(btrim(v_task->>'title')) not between 1 and 200 then
      raise exception 'مهمة خطة غير صالحة' using errcode = '22023';
    end if;
    v_material_id := nullif(v_task->>'material_id','')::uuid;
    v_part_id := nullif(v_task->>'part_id','')::uuid;
    if v_material_id is not null and not exists(
      select 1 from public.study_materials m where m.id = v_material_id and m.circle_id = p_circle_id
        and not private.is_content_archived('study_material', m.id)
    ) then
      raise exception 'المادة المحددة غير متاحة في هذه المدارسة' using errcode = '22023';
    end if;
    if v_part_id is not null and not exists(
      select 1 from public.study_material_parts p
       where p.id = v_part_id and p.circle_id = p_circle_id
         and (v_material_id is null or p.material_id = v_material_id)
    ) then
      raise exception 'الجزء المحدد لا يتبع هذه المدارسة' using errcode = '22023';
    end if;
    select active_task.id into v_existing
      from (
        select t.id, row_number() over(order by t.position) as active_position
          from public.study_plan_tasks t
         where t.circle_id = p_circle_id
           and not private.is_content_archived('study_plan_task', t.id)
           and (t.material_id is null or not private.is_content_archived('study_material', t.material_id))
      ) active_task
     where active_task.active_position = v_position;
    if v_existing is not null then
      update public.study_plan_tasks set title = btrim(v_task->>'title'),
        material_id = v_material_id, part_id = v_part_id,
        target_date = (v_task->>'target_date')::date
       where id = v_existing;
    else
      select coalesce(max(t.position),0) into v_max_position
        from public.study_plan_tasks t
       where t.circle_id = p_circle_id
         and not private.is_content_archived('study_plan_task', t.id)
         and (t.material_id is null or not private.is_content_archived('study_material', t.material_id));
      select min(slot) into v_insert_position
        from generate_series(v_max_position + 1, 500) available(slot)
       where not exists(
         select 1 from public.study_plan_tasks t
          where t.circle_id = p_circle_id and t.position = available.slot
       );
      if v_insert_position is null then
        raise exception 'لا توجد مساحة لمهمة جديدة؛ استعد مهمة مؤرشفة أو أزل مهامًا أولًا' using errcode = 'P0001';
      end if;
      insert into public.study_plan_tasks(circle_id,position,title,material_id,part_id,target_date)
      values (p_circle_id,v_insert_position,btrim(v_task->>'title'),v_material_id,v_part_id,
        (v_task->>'target_date')::date);
    end if;
  end loop;
  return v_position;
end $$;

create or replace function public.study_progress_summary(p_circle_id uuid)
returns table (total_tasks bigint, my_completed bigint, members_count bigint, group_completed bigint)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*) from public.study_plan_tasks t where t.circle_id = p_circle_id
      and not private.is_content_archived('study_plan_task', t.id)
      and (t.material_id is null or not private.is_content_archived('study_material', t.material_id))),
    (select count(*) from public.study_task_progress p join public.study_plan_tasks t on t.id = p.task_id
      where p.circle_id = p_circle_id and p.user_id = (select auth.uid())
        and not private.is_content_archived('study_plan_task', t.id)
        and (t.material_id is null or not private.is_content_archived('study_material', t.material_id))),
    (select count(*) from public.study_circle_members where circle_id = p_circle_id),
    (select count(*) from public.study_task_progress p join public.study_plan_tasks t on t.id = p.task_id
      where p.circle_id = p_circle_id
        and not private.is_content_archived('study_plan_task', t.id)
        and (t.material_id is null or not private.is_content_archived('study_material', t.material_id)))
  where (select public.is_study_member(p_circle_id));
$$;

create or replace function public.list_study_meeting_attendance(p_meeting_id uuid)
returns table(user_id uuid, status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_circle uuid;
begin
  select circle_id into v_circle from public.study_meetings where id = p_meeting_id;
  if auth.uid() is null or v_circle is null or (select public.is_study_member(v_circle)) is not true
     or private.is_content_archived('study_meeting', p_meeting_id) then
    raise exception 'لا تملك صلاحية عرض الحضور' using errcode = '42501';
  end if;
  return query select a.user_id, a.status from public.study_meeting_attendance a
    where a.meeting_id = p_meeting_id
      and (a.user_id = auth.uid() or private.study_role(v_circle, array['creator','supervisor','teacher']) is not null);
end $$;
