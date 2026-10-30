-- TAW-005: role changes and membership lifecycle are server-only. The group
-- row lock serializes ownership transfer and member removal with approvals.
create function public.set_group_member_role(p_group_id uuid,p_user_id uuid,p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_group public.study_groups%rowtype;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  if p_role not in ('manager','assistant','member') or p_role is null then
    raise exception 'دور غير صالح' using errcode='22023';
  end if;
  select * into v_group from public.study_groups where id=p_group_id for update;
  if not found or v_group.founder_id<>v_actor or not exists (
    select 1 from public.group_members where group_id=p_group_id and user_id=v_actor and role='founder') then
    raise exception 'المؤسس فقط يعيّن الأدوار' using errcode='42501';
  end if;
  if v_group.status<>'active' then raise exception 'الحلقة مغلقة' using errcode='P0001'; end if;
  update public.group_members set role=p_role
   where group_id=p_group_id and user_id=p_user_id and role<>'founder';
  if not found then raise exception 'العضو غير موجود أو هو المؤسس' using errcode='P0001'; end if;
end $$;

create function public.remove_group_member(p_group_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_group public.study_groups%rowtype; v_actor_role text; v_target_role text;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select * into v_group from public.study_groups where id=p_group_id for update;
  select role into v_actor_role from public.group_members where group_id=p_group_id and user_id=v_actor;
  select role into v_target_role from public.group_members where group_id=p_group_id and user_id=p_user_id;
  if v_group.status<>'active' then raise exception 'الحلقة مغلقة' using errcode='P0001'; end if;
  if v_actor_role not in ('founder','manager') or v_target_role is null
     or v_target_role='founder' or (v_actor_role='manager' and v_target_role='manager') then
    raise exception 'لا تملك صلاحية إزالة هذا العضو' using errcode='42501';
  end if;
  delete from public.group_members where group_id=p_group_id and user_id=p_user_id;
end $$;

create function public.leave_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_role text;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  perform 1 from public.study_groups where id=p_group_id for update;
  select role into v_role from public.group_members where group_id=p_group_id and user_id=v_actor;
  if v_role is null then raise exception 'لست عضوًا في الحلقة' using errcode='42501'; end if;
  if v_role='founder' then raise exception 'انقل ملكية الحلقة قبل مغادرتها' using errcode='P0001'; end if;
  delete from public.group_members where group_id=p_group_id and user_id=v_actor;
end $$;

create function public.transfer_group_foundership(p_group_id uuid,p_new_founder uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_group public.study_groups%rowtype;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select * into v_group from public.study_groups where id=p_group_id for update;
  if not found or v_group.founder_id<>v_actor or not exists (
    select 1 from public.group_members where group_id=p_group_id and user_id=v_actor and role='founder') then
    raise exception 'المؤسس فقط ينقل الملكية' using errcode='42501';
  end if;
  if v_group.status<>'active' then raise exception 'الحلقة مغلقة' using errcode='P0001'; end if;
  if p_new_founder=v_actor or not exists (
    select 1 from public.group_members where group_id=p_group_id and user_id=p_new_founder) then
    raise exception 'اختر عضوًا آخر في الحلقة' using errcode='22023';
  end if;
  update public.group_members set role='manager' where group_id=p_group_id and user_id=v_actor;
  update public.group_members set role='founder' where group_id=p_group_id and user_id=p_new_founder;
  update public.study_groups set founder_id=p_new_founder where id=p_group_id;
end $$;

-- Managers can review join requests, but neither assistants nor ordinary
-- members can. The group lock also enforces capacity under concurrent reviews.
create or replace function public.decide_group_join_request(p_request_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_request public.group_join_requests%rowtype;
        v_group public.study_groups%rowtype; v_role text;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  if p_approve is null then raise exception 'اختر قبول الطلب أو رفضه' using errcode='22023'; end if;
  select * into v_request from public.group_join_requests where id=p_request_id for update;
  if not found then raise exception 'طلب غير موجود' using errcode='P0001'; end if;
  select * into v_group from public.study_groups where id=v_request.group_id for update;
  select role into v_role from public.group_members where group_id=v_group.id and user_id=v_actor;
  if v_role not in ('founder','manager') or v_role is null then
    raise exception 'المسؤول فقط يراجع الطلبات' using errcode='42501';
  end if;
  if v_request.status<>'pending' then raise exception 'اتُّخذ قرار في هذا الطلب بالفعل' using errcode='P0001'; end if;
  if v_group.status<>'active' then raise exception 'الحلقة مغلقة' using errcode='P0001'; end if;
  if p_approve then
    if (select count(*) from public.group_members where group_id=v_group.id)>=v_group.member_limit then
      raise exception 'الحلقة ممتلئة' using errcode='P0001';
    end if;
    insert into public.group_members(group_id,user_id,role) values(v_group.id,v_request.user_id,'member');
  end if;
  update public.group_join_requests set status=case when p_approve then 'accepted' else 'rejected' end,
    decided_at=now(),decided_by=v_actor where id=v_request.id;
end $$;

revoke all on function public.set_group_member_role(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.remove_group_member(uuid,uuid) from public,anon,authenticated;
revoke all on function public.leave_group(uuid) from public,anon,authenticated;
revoke all on function public.transfer_group_foundership(uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_group_member_role(uuid,uuid,text) to authenticated;
grant execute on function public.remove_group_member(uuid,uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.transfer_group_foundership(uuid,uuid) to authenticated;

drop policy own_or_founder_request_read on public.group_join_requests;
create policy own_or_moderator_request_read on public.group_join_requests for select to authenticated
  using (user_id=(select auth.uid()) or exists (
    select 1 from public.group_members m where m.group_id=group_join_requests.group_id
      and m.user_id=(select auth.uid()) and m.role in ('founder','manager')));
