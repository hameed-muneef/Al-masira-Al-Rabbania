-- Keep meeting URLs out of ordinary session queries. A fresh membership check
-- is required for each reveal; Meet itself must still enforce host admission.
revoke select on public.circle_live_sessions from authenticated;

create function public.list_circle_sessions(p_circle_id uuid)
returns table(id uuid, title text, starts_at timestamptz, ends_at timestamptz,
  status text, notes text, has_meeting_link boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.group_members m
    where m.group_id = p_circle_id and m.user_id = auth.uid()
  ) then raise exception 'لا تملك صلاحية عرض جلسات الحلقة' using errcode='42501'; end if;
  return query select s.id,s.title,s.starts_at,s.ends_at,s.status,s.notes,
    (s.meeting_url <> '') from public.circle_live_sessions s
    where s.circle_id = p_circle_id order by s.starts_at desc;
end $$;

create function public.reveal_circle_meeting_url(p_session_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_url text;
begin
  if auth.uid() is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select s.meeting_url into v_url from public.circle_live_sessions s
    join public.study_groups g on g.id = s.circle_id
    join public.group_members m on m.group_id = s.circle_id and m.user_id = auth.uid()
    where s.id = p_session_id and s.status = 'scheduled' and g.status = 'active';
  if not found or v_url = '' then
    raise exception 'رابط اللقاء غير متاح' using errcode='42501';
  end if;
  return v_url;
end $$;

revoke all on function public.list_circle_sessions(uuid) from public, anon, authenticated;
revoke all on function public.reveal_circle_meeting_url(uuid) from public, anon, authenticated;
grant execute on function public.list_circle_sessions(uuid) to authenticated;
grant execute on function public.reveal_circle_meeting_url(uuid) to authenticated;
