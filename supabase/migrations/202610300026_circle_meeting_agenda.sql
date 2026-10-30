-- Separate the spiritual circle meeting agenda from academic programs.
alter table public.circle_live_sessions
  add column agenda text not null default '' check (char_length(agenda) <= 2000),
  add column discussion_points text not null default '' check (char_length(discussion_points) <= 4000);

create function public.update_circle_session_agenda(p_session_id uuid,p_agenda text,p_discussion_points text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_circle uuid; v_founder uuid;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select s.circle_id,g.founder_id into v_circle,v_founder
    from public.circle_live_sessions s join public.study_groups g on g.id=s.circle_id
    where s.id=p_session_id for update;
  if v_circle is null or (v_founder<>v_actor and not exists(
    select 1 from public.group_members m where m.group_id=v_circle and m.user_id=v_actor and m.role='manager')) then
    raise exception 'مؤسس الحلقة أو مسؤولها فقط يحرر محاور المجلس' using errcode='42501';
  end if;
  if char_length(coalesce(p_agenda,''))>2000 or char_length(coalesce(p_discussion_points,''))>4000 then
    raise exception 'محاور المجلس أطول من الحد المسموح' using errcode='22023';
  end if;
  update public.circle_live_sessions set agenda=coalesce(p_agenda,''),discussion_points=coalesce(p_discussion_points,'')
    where id=p_session_id;
end $$;
revoke all on function public.update_circle_session_agenda(uuid,text,text) from public,anon,authenticated;
grant execute on function public.update_circle_session_agenda(uuid,text,text) to authenticated;

create function public.list_circle_sessions_with_agenda(p_circle_id uuid)
returns table(id uuid,title text,starts_at timestamptz,ends_at timestamptz,status text,notes text,
  agenda text,discussion_points text,has_meeting_link boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.group_members m where m.group_id=p_circle_id and m.user_id=auth.uid()) then
    raise exception 'لا تملك صلاحية عرض جلسات الحلقة' using errcode='42501';
  end if;
  return query select s.id,s.title,s.starts_at,s.ends_at,s.status,s.notes,s.agenda,s.discussion_points,(s.meeting_url<>'')
    from public.circle_live_sessions s where s.circle_id=p_circle_id order by s.starts_at desc;
end $$;
revoke all on function public.list_circle_sessions_with_agenda(uuid) from public,anon,authenticated;
grant execute on function public.list_circle_sessions_with_agenda(uuid) to authenticated;
