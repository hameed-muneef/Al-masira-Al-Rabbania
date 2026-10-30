-- ILM-006 (DST): keep recurring course sessions on the same local wall clock.
-- Occurrence arithmetic now runs on the course time zone (naive local time) before
-- converting back to UTC, so weekly/biweekly/monthly shifts survive DST transitions
-- instead of shifting the local time by the DST offset.
create or replace function public.generate_course_sessions(p_course_id uuid, p_title text, p_starts_at timestamptz,
  p_duration_minutes integer, p_count integer, p_recurrence text default 'weekly',
  p_meeting_url text default '', p_notes text default '')
returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_course public.courses%rowtype;
  v_rule text;
  v_i integer;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
begin
  if v_actor is null or not public.is_approved_teacher() then
    raise exception 'اعتماد المعلم مطلوب' using errcode='42501';
  end if;
  select * into v_course from public.courses where id = p_course_id for update;
  if not found or v_course.teacher_id <> v_actor then
    raise exception 'لا تملك صلاحية هذا المجلس' using errcode='42501';
  end if;
  if v_course.status <> 'published' then raise exception 'المجلس غير منشور' using errcode='P0001'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'عنوان الجلسة غير صالح' using errcode='22023';
  end if;
  if p_starts_at is null or p_duration_minutes is null or p_duration_minutes not between 15 and 480 then
    raise exception 'مدة الجلسة يجب أن تكون بين 15 و480 دقيقة' using errcode='22023';
  end if;
  if p_count is null or p_count not between 1 and 52 then
    raise exception 'عدد التكرارات يجب أن يكون بين 1 و52' using errcode='22023';
  end if;
  if p_recurrence not in ('daily','weekly','biweekly','monthly') then
    raise exception 'قاعدة التكرار غير صالحة' using errcode='22023';
  end if;
  v_rule := p_recurrence;
  for v_i in 0..(p_count - 1) loop
    v_start := (p_starts_at AT TIME ZONE v_course.time_zone + case v_rule
      when 'daily' then (v_i || ' days')::interval
      when 'weekly' then (v_i || ' weeks')::interval
      when 'biweekly' then ((v_i * 2) || ' weeks')::interval
      when 'monthly' then (v_i || ' months')::interval
    end) AT TIME ZONE v_course.time_zone;
    v_end := v_start + (p_duration_minutes || ' minutes')::interval;
    insert into public.course_sessions (course_id, title, starts_at, ends_at, meeting_url, notes, created_by, recurrence_rule)
      values (p_course_id, btrim(p_title), v_start, v_end, coalesce(p_meeting_url,''), coalesce(p_notes,''), v_actor, v_rule)
      returning id into v_id;
    return next v_id;
  end loop;
  return;
end $$;

revoke all on function public.generate_course_sessions(uuid, text, timestamptz, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.generate_course_sessions(uuid, text, timestamptz, integer, integer, text, text, text) to authenticated;
