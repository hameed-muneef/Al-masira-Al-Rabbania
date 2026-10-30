-- ILM-011: a scientific council controls whether students self-record completion
-- or the founder/teacher must approve it.
alter table public.group_programs
  add column completion_mode text not null default 'self'
  check (completion_mode in ('self','leader'));

create or replace function public.complete_group_task(p_group_id uuid,p_position integer,p_completed_on date default current_date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_revision integer; v_mode text;
begin
  if v_actor is null or not public.is_group_member(p_group_id) then
    raise exception 'عضوية المجلس العلمي مطلوبة' using errcode='42501';
  end if;
  select current_revision,completion_mode into v_revision,v_mode from public.group_programs where group_id=p_group_id;
  if v_mode<>'self' and not exists(select 1 from public.group_members where group_id=p_group_id and user_id=v_actor and role='founder') then
    raise exception 'اعتماد الشيخ أو مؤسس المجلس مطلوب' using errcode='42501';
  end if;
  if p_completed_on is null or p_completed_on>current_date or p_completed_on<current_date-366 then
    raise exception 'تاريخ الإنجاز غير صالح' using errcode='22023';
  end if;
  if v_revision is null or not exists(select 1 from public.group_program_tasks where group_id=p_group_id and revision=v_revision and position=p_position) then
    raise exception 'المهمة غير موجودة في البرنامج الحالي' using errcode='P0001';
  end if;
  insert into public.group_task_completions(group_id,revision,position,user_id,completed_on)
    values(p_group_id,v_revision,p_position,v_actor,p_completed_on) on conflict do nothing;
end $$;

create function public.set_group_program_completion_mode(p_group_id uuid,p_mode text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null or p_mode not in ('self','leader') then raise exception 'إعداد غير صالح' using errcode='22023'; end if;
  if not exists(select 1 from public.group_members where group_id=p_group_id and user_id=v_actor and role='founder') then
    raise exception 'المؤسس فقط يغيّر إعداد اعتماد الإنجاز' using errcode='42501';
  end if;
  update public.group_programs set completion_mode=p_mode,updated_at=now() where group_id=p_group_id;
  if not found then raise exception 'لا يوجد برنامج للمجلس' using errcode='P0001'; end if;
end $$;
revoke all on function public.set_group_program_completion_mode(uuid,text) from public,anon,authenticated;
grant execute on function public.set_group_program_completion_mode(uuid,text) to authenticated;
