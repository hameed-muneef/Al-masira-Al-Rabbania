CREATE OR REPLACE FUNCTION public.send_notification(p_recipient_id uuid, p_kind text, p_title text, p_body text DEFAULT ''::text, p_link text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'إرسال إشعار يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_recipient_id is null then
    raise exception 'مستلم الإشعار مطلوب' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('announcement','join_request','join_decision','course','session','report','system') then
    raise exception 'نوع الإشعار غير صالح' using errcode = '22023';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'عنوان الإشعار يجب أن يكون بين 1 و200 حرف' using errcode = '22023';
  end if;
  if char_length(coalesce(p_body,'')) > 2000 or char_length(coalesce(p_link,'')) > 500 then
    raise exception 'محتوى الإشعار تجاوز الحد' using errcode = '22023';
  end if;
  -- Only admins may notify arbitrary users; founders may notify members of their own circles.
  if not public.is_admin() and not exists (
    select 1 from public.group_members m
      join public.study_groups g on g.id = m.group_id
     where m.user_id = p_recipient_id and g.founder_id = v_actor
       and m.group_id in (select group_id from public.group_members where user_id = v_actor and role = 'founder')
  ) then
    raise exception 'لا تملك صلاحية إرسال إشعار لهذا المستخدم' using errcode = '42501';
  end if;
  insert into public.notifications (recipient_id, kind, title, body, link)
    values (p_recipient_id, p_kind, btrim(p_title), coalesce(p_body,''), coalesce(p_link,''))
    returning id into v_id;
  return v_id;
end $function$

;
CREATE OR REPLACE FUNCTION public.admin_list_users(p_search text DEFAULT ''::text, p_role text DEFAULT 'all'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(user_id uuid, email text, email_confirmed boolean, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, first_name text, last_name text, country text, is_admin boolean, teacher_status text, is_approved_teacher boolean, total_count bigint, confirmed_count bigint, admin_count bigint, approved_teacher_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_search text := btrim(coalesce(p_search, ''));
begin
  if (select auth.uid()) is null or not (select public.is_admin()) then
    raise exception 'إدارة قائمة المستخدمين للمشرفين فقط' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('all','admin','approved_teacher','pending_teacher','member')
     or p_limit is null or p_limit not between 1 and 100
     or p_offset is null or p_offset < 0
     or char_length(v_search) > 120 then
    raise exception 'معايير البحث غير صالحة' using errcode = '22023';
  end if;

  return query
  with accounts as (
    select u.id as account_id,
           u.email::text as account_email,
           (u.email_confirmed_at is not null) as confirmed,
           u.created_at as registered_at,
           u.last_sign_in_at as last_seen_at,
           coalesce(p.first_name, '') as given_name,
           coalesce(p.last_name, '') as family_name,
           coalesce(p.country, '') as country_name,
           exists (select 1 from public.admin_accounts a where a.user_id = u.id) as administrator,
           t.status as application_status,
           coalesce(t.status = 'approved'
             and t.identity_status = 'approved'
             and t.qualification_status = 'approved'
             and t.endorsement_status = 'approved', false) as approved_teacher
      from auth.users u
      left join public.user_preferences p on p.user_id = u.id
      left join public.teacher_applications t on t.user_id = u.id
  ), filtered as (
    select a.* from accounts a
     where (v_search = ''
       or coalesce(a.account_email, '') ilike '%' || v_search || '%'
       or (a.given_name || ' ' || a.family_name) ilike '%' || v_search || '%'
       or a.country_name ilike '%' || v_search || '%')
       and case p_role
         when 'admin' then a.administrator
         when 'approved_teacher' then a.approved_teacher
         when 'pending_teacher' then a.application_status = 'submitted'
         when 'member' then not a.administrator and not a.approved_teacher
         else true
       end
  )
  select f.account_id,
         f.account_email,
         f.confirmed,
         f.registered_at,
         f.last_seen_at,
         f.given_name,
         f.family_name,
         f.country_name,
         f.administrator,
         f.application_status,
         f.approved_teacher,
         count(*) over (),
         count(*) filter (where f.confirmed) over (),
         count(*) filter (where f.administrator) over (),
         count(*) filter (where f.approved_teacher) over ()
    from filtered f
   order by f.registered_at desc, f.account_id
   limit p_limit offset p_offset;
end $function$

;
CREATE OR REPLACE FUNCTION public.check_username_available(p_username text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := (select auth.uid()); v_username text := lower(btrim(coalesce(p_username, '')));
begin
  if v_user is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  perform private.consume_share_search(v_user);
  if v_username !~ '^[a-z][a-z0-9_]{2,19}$' then return false; end if;
  return not exists (select 1 from public.member_share_profiles p where p.username = v_username and p.user_id <> v_user);
end $function$

;
CREATE OR REPLACE FUNCTION public.restore_platform_content(p_content_type text, p_content_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$

;
CREATE OR REPLACE FUNCTION public.list_admin_archivable_content(p_archived boolean DEFAULT false, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(content_type text, content_id uuid, content_title text, content_summary text, context_title text, content_created_at timestamp with time zone, archived_at timestamp with time zone, reason text, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.archive_platform_content(p_content_type text, p_content_id uuid, p_reason text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$

;
