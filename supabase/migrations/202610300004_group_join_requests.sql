-- TAW-004: an invite creates a request, never membership. Only the founder can
-- decide; the group row lock serializes approvals against the member cap.
create table public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  invite_id uuid not null references public.group_invites(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  unique (group_id, user_id),
  check ((status = 'pending' and decided_at is null and decided_by is null)
      or (status <> 'pending' and decided_at is not null and decided_by is not null))
);
create index group_join_requests_group_idx on public.group_join_requests(group_id, status, requested_at);
alter table public.group_join_requests enable row level security;
revoke all on public.group_join_requests from public, anon, authenticated;
grant select on public.group_join_requests to authenticated;
grant select, insert, update, delete on public.group_join_requests to service_role;
create policy own_or_founder_request_read on public.group_join_requests for select to authenticated
  using (user_id = (select auth.uid()) or exists (
    select 1 from public.group_members m
    where m.group_id = group_join_requests.group_id
      and m.user_id = (select auth.uid()) and m.role = 'founder'
  ));

create function public.request_group_join(p_code text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  v_user uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_invite public.group_invites%rowtype;
  v_group public.study_groups%rowtype;
  v_request uuid;
begin
  if v_user is null then
    raise exception 'طلب الانضمام يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if v_code !~ '^[A-HJ-NP-Z2-9]{20}$' then
    raise exception 'رابط الدعوة غير صالح' using errcode = '22023';
  end if;
  select * into v_invite from public.group_invites
   where token_hash = encode(sha256(convert_to('RBYI-' || v_code, 'utf8')), 'hex')
   for update;
  if not found or v_invite.status <> 'active' or v_invite.expires_at <= now()
     or v_invite.uses_count >= v_invite.max_uses then
    raise exception 'رابط الدعوة غير صالح أو انتهت صلاحيته' using errcode = 'P0001';
  end if;
  select * into v_group from public.study_groups where id = v_invite.group_id for update;
  if v_group.status <> 'active' then
    raise exception 'الحلقة مغلقة' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.group_members where group_id = v_group.id and user_id = v_user) then
    raise exception 'أنت عضو في هذه الحلقة بالفعل' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.group_join_requests where group_id = v_group.id and user_id = v_user) then
    raise exception 'سبق إرسال طلب لهذه الحلقة' using errcode = '23505';
  end if;
  if (select count(*) from public.group_members where group_id = v_group.id) >= v_group.member_limit then
    raise exception 'الحلقة ممتلئة' using errcode = 'P0001';
  end if;
  insert into public.group_join_requests(group_id, invite_id, user_id)
    values (v_group.id, v_invite.id, v_user) returning id into v_request;
  update public.group_invites set uses_count = uses_count + 1 where id = v_invite.id;
  return v_request;
end $$;

create function public.decide_group_join_request(p_request_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_founder uuid := (select auth.uid());
  v_request public.group_join_requests%rowtype;
  v_group public.study_groups%rowtype;
begin
  if v_founder is null then
    raise exception 'القرار يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'اختر قبول الطلب أو رفضه' using errcode = '22023';
  end if;
  select * into v_request from public.group_join_requests where id = p_request_id for update;
  if not found then
    raise exception 'طلب غير موجود' using errcode = 'P0001';
  end if;
  select * into v_group from public.study_groups where id = v_request.group_id for update;
  if v_group.founder_id <> v_founder or not exists (
    select 1 from public.group_members m
     where m.group_id = v_group.id and m.user_id = v_founder and m.role = 'founder'
  ) then
    raise exception 'مؤسس الحلقة فقط يراجع الطلبات' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'اتُّخذ قرار في هذا الطلب بالفعل' using errcode = 'P0001';
  end if;
  if v_group.status <> 'active' then
    raise exception 'الحلقة مغلقة' using errcode = 'P0001';
  end if;
  if p_approve then
    if (select count(*) from public.group_members where group_id = v_group.id) >= v_group.member_limit then
      raise exception 'الحلقة ممتلئة' using errcode = 'P0001';
    end if;
    insert into public.group_members(group_id,user_id,role)
      values (v_group.id,v_request.user_id,'member');
  end if;
  update public.group_join_requests set
    status = case when p_approve then 'accepted' else 'rejected' end,
    decided_at = now(), decided_by = v_founder
   where id = v_request.id;
end $$;

revoke all on function public.request_group_join(text) from public, anon, authenticated;
revoke all on function public.decide_group_join_request(uuid, boolean) from public, anon, authenticated;
grant execute on function public.request_group_join(text) to authenticated;
grant execute on function public.decide_group_join_request(uuid, boolean) to authenticated;
