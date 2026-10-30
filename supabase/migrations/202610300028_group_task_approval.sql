-- ILM-012: keep an auditable approval state for council task completion.
alter table public.group_task_completions
  add column status text not null default 'approved' check (status in ('pending','approved','rejected')),
  add column approved_by uuid references auth.users(id),
  add column approved_at timestamptz;

create or replace function public.complete_group_task(p_group_id uuid,p_position integer,p_completed_on date default current_date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_revision integer; v_mode text; v_status text;
begin
  if v_actor is null or not public.is_group_member(p_group_id) then raise exception 'عضوية المجلس العلمي مطلوبة' using errcode='42501'; end if;
  select current_revision,completion_mode into v_revision,v_mode from public.group_programs where group_id=p_group_id;
  if p_completed_on is null or p_completed_on>current_date or p_completed_on<current_date-366 then raise exception 'تاريخ الإنجاز غير صالح' using errcode='22023'; end if;
  if v_revision is null or not exists(select 1 from public.group_program_tasks where group_id=p_group_id and revision=v_revision and position=p_position) then raise exception 'المهمة غير موجودة في البرنامج الحالي' using errcode='P0001'; end if;
  if v_mode='leader' and not exists(select 1 from public.group_members where group_id=p_group_id and user_id=v_actor and role='founder') then v_status:='pending'; else v_status:='approved'; end if;
  insert into public.group_task_completions(group_id,revision,position,user_id,completed_on,status,approved_by,approved_at)
    values(p_group_id,v_revision,p_position,v_actor,p_completed_on,v_status,case when v_status='approved' then v_actor end,case when v_status='approved' then now() end)
    on conflict (group_id,revision,position,user_id,completed_on) do update set status=excluded.status,approved_by=excluded.approved_by,approved_at=excluded.approved_at;
end $$;

create function public.review_group_task_completion(p_group_id uuid,p_user_id uuid,p_revision integer,p_position integer,p_completed_on date,p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not exists(select 1 from public.group_members where group_id=p_group_id and user_id=v_actor and role='founder') then raise exception 'مؤسس المجلس فقط يعتمد الإنجاز' using errcode='42501'; end if;
  update public.group_task_completions set status=case when p_approve then 'approved' else 'rejected' end,approved_by=case when p_approve then v_actor end,approved_at=case when p_approve then now() end
    where group_id=p_group_id and user_id=p_user_id and revision=p_revision and position=p_position and completed_on=p_completed_on;
  if not found then raise exception 'سجل الإنجاز غير موجود' using errcode='P0001'; end if;
end $$;
revoke all on function public.review_group_task_completion(uuid,uuid,integer,integer,date,boolean) from public,anon,authenticated;
grant execute on function public.review_group_task_completion(uuid,uuid,integer,integer,date,boolean) to authenticated;
