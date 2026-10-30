-- TAW-008: progress remains private by default. Sharing only contributes to an
-- anonymous seven-day total; individual completion rows remain owner-only.
create table public.group_progress_sharing (
  group_id uuid not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  share_aggregate boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (group_id,user_id)
);
alter table public.group_progress_sharing enable row level security;
revoke all on public.group_progress_sharing from public,anon,authenticated;
grant select on public.group_progress_sharing to authenticated;
grant select,insert,update,delete on public.group_progress_sharing to service_role;
create policy own_group_sharing_read on public.group_progress_sharing for select to authenticated
  using (user_id=(select auth.uid()) and (select public.is_group_member(group_id)));

create function public.set_group_progress_sharing(p_group_id uuid,p_share boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    raise exception 'عضوية الحلقة مطلوبة' using errcode='42501';
  end if;
  if p_share is null then raise exception 'خيار المشاركة مطلوب' using errcode='22023'; end if;
  insert into public.group_progress_sharing(group_id,user_id,share_aggregate)
    values(p_group_id,auth.uid(),p_share)
    on conflict(group_id,user_id) do update set share_aggregate=excluded.share_aggregate,updated_at=now();
end $$;
revoke all on function public.set_group_progress_sharing(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_group_progress_sharing(uuid,boolean) to authenticated;

create function public.uncomplete_group_task(p_group_id uuid,p_position integer,p_completed_on date default current_date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_revision integer;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    raise exception 'عضوية الحلقة مطلوبة' using errcode='42501';
  end if;
  if p_completed_on is null or p_completed_on>current_date or p_completed_on<current_date-366 then
    raise exception 'تاريخ الإنجاز غير صالح' using errcode='22023';
  end if;
  select current_revision into v_revision from public.group_programs where group_id=p_group_id;
  delete from public.group_task_completions
    where group_id=p_group_id and revision=v_revision and position=p_position
      and user_id=auth.uid() and completed_on=p_completed_on;
end $$;
revoke all on function public.uncomplete_group_task(uuid,integer,date) from public,anon,authenticated;
grant execute on function public.uncomplete_group_task(uuid,integer,date) to authenticated;

create function public.group_progress_summary(p_group_id uuid)
returns table(sharing_members bigint,completion_count bigint,visible boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_revision integer; v_members bigint;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    raise exception 'عضوية الحلقة مطلوبة' using errcode='42501';
  end if;
  select current_revision into v_revision from public.group_programs where group_id=p_group_id;
  select count(*) into v_members from public.group_progress_sharing s
    join public.group_members m on m.group_id=s.group_id and m.user_id=s.user_id
    where s.group_id=p_group_id and s.share_aggregate;
  if v_members<3 or v_revision is null then
    return query select v_members,0::bigint,false;
    return;
  end if;
  return query select v_members,count(*)::bigint,true
    from public.group_task_completions c
    join public.group_progress_sharing s on s.group_id=c.group_id and s.user_id=c.user_id
    join public.group_members m on m.group_id=c.group_id and m.user_id=c.user_id
    where c.group_id=p_group_id and c.revision=v_revision and s.share_aggregate
      and c.completed_on between current_date-6 and current_date;
end $$;
revoke all on function public.group_progress_summary(uuid) from public,anon,authenticated;
grant execute on function public.group_progress_summary(uuid) to authenticated;
