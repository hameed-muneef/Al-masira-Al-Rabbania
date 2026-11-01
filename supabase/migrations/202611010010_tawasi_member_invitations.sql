-- Direct, username-based invitations to private Tawasi circles.
-- Invitation acceptance is required before membership is created; link invites
-- remain available as a separate path.
create table public.group_member_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','cancelled','expired')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz not null,
  check (invited_by <> invitee_id)
);
create unique index group_member_invitations_pending_idx
  on public.group_member_invitations(group_id, invitee_id) where status = 'pending';
create index group_member_invitations_invitee_idx
  on public.group_member_invitations(invitee_id, status, created_at desc);
create index group_member_invitations_group_idx
  on public.group_member_invitations(group_id, status, created_at desc);

alter table public.group_member_invitations enable row level security;
revoke all on public.group_member_invitations from public, anon, authenticated;
grant select, insert, update, delete on public.group_member_invitations to service_role;

create or replace function private.consume_activity_invite(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_max integer;
  v_used integer;
begin
  if private.share_restricted(p_user) then
    raise exception 'الدعوات متوقفة مؤقتًا لهذا الحساب' using errcode = '42501';
  end if;
  select max_per_day into v_max from public.share_settings where id;
  select
    (select count(*) from public.study_member_invites where invited_by = p_user and created_at > now() - interval '24 hours')
    + (select count(*) from public.course_invitations where invited_by = p_user and created_at > now() - interval '24 hours')
    + (select count(*) from public.tawasi_session_invitations where mentor_id = p_user and created_at > now() - interval '24 hours')
    + (select count(*) from public.group_member_invitations where invited_by = p_user and created_at > now() - interval '24 hours')
    into v_used;
  if v_used >= coalesce(v_max, 20) then
    raise exception 'بلغت الحد اليومي للدعوات' using errcode = 'P0001';
  end if;
end $$;

create function public.invite_group_member(p_group_id uuid, p_username text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_group public.study_groups%rowtype;
  v_invitee uuid;
  v_ttl integer;
  v_invitation uuid;
  v_role text;
begin
  if v_user is null then
    raise exception 'الدعوة تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_group from public.study_groups where id = p_group_id for update;
  select role into v_role from public.group_members where group_id = p_group_id and user_id = v_user;
  if v_role not in ('founder','manager') or v_role is null then
    raise exception 'مؤسس الحلقة أو مسؤولها فقط يدعو الأعضاء' using errcode = '42501';
  end if;
  if v_group.status is distinct from 'active' then
    raise exception 'الحلقة مغلقة ولا تقبل دعوات جديدة' using errcode = 'P0001';
  end if;
  if (select count(*) from public.group_members where group_id = p_group_id) >= v_group.member_limit then
    raise exception 'الحلقة ممتلئة' using errcode = 'P0001';
  end if;

  perform private.consume_share_search(v_user);
  select p.user_id into v_invitee
    from public.member_share_profiles p
   where p.username = v_username and p.discoverable and p.user_id <> v_user
     and not exists (
       select 1 from public.member_blocks b
        where (b.blocker_id = p.user_id and b.blocked_id = v_user)
           or (b.blocker_id = v_user and b.blocked_id = p.user_id)
     );
  if v_invitee is null then
    raise exception 'تعذّرت دعوة هذا الاسم. تأكد من اسم المستخدم وإتاحة ظهوره.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.group_members where group_id = p_group_id and user_id = v_invitee) then
    raise exception 'هذا العضو في الحلقة بالفعل' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.group_join_requests where group_id = p_group_id and user_id = v_invitee and status = 'pending') then
    raise exception 'لدى هذا العضو طلب انضمام ينتظر قرار الحلقة' using errcode = 'P0001';
  end if;

  perform private.consume_activity_invite(v_user);
  v_ttl := private.activity_invite_ttl();
  begin
    insert into public.group_member_invitations(group_id, invitee_id, invited_by, expires_at)
    values (p_group_id, v_invitee, v_user, now() + make_interval(days => v_ttl))
    returning id into v_invitation;
  exception when unique_violation then
    raise exception 'سبق إرسال دعوة لهذا العضو وهي بانتظار رده' using errcode = 'P0001';
  end;
  perform private.notify(v_invitee, 'invitation', 'دعوة إلى حلقة تواصٍ: ' || v_group.name,
    'دعاك مؤسس الحلقة أو مسؤولها. افتح تبويب الدعوات لقبول الدعوة أو رفضها.', 'circles');
  return v_invitation;
end $$;

create function public.list_group_member_invites(p_group_id uuid)
returns table (
  invitation_id uuid, invitee_username text, invitee_name text, status text,
  created_at timestamptz, expires_at timestamptz, decided_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'الدعوات تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.user_id = v_user and m.role in ('founder','manager')
  ) then
    raise exception 'مؤسس الحلقة أو مسؤولها فقط يرى الدعوات' using errcode = '42501';
  end if;
  return query
    select i.id, p.username, p.display_name, i.status, i.created_at, i.expires_at, i.decided_at
      from public.group_member_invitations i
      left join public.member_share_profiles p on p.user_id = i.invitee_id
     where i.group_id = p_group_id
     order by i.created_at desc
     limit 100;
end $$;

create function public.cancel_group_member_invite(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_invite public.group_member_invitations%rowtype;
  v_group_name text;
begin
  if v_user is null then
    raise exception 'إلغاء الدعوة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_invite from public.group_member_invitations where id = p_invitation_id for update;
  if not found then
    raise exception 'الدعوة غير موجودة' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.group_members m
     where m.group_id = v_invite.group_id and m.user_id = v_user and m.role in ('founder','manager')
  ) then
    raise exception 'مؤسس الحلقة أو مسؤولها فقط يلغي الدعوات' using errcode = '42501';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'لا يمكن إلغاء دعوة حُسمت' using errcode = 'P0001';
  end if;
  update public.group_member_invitations
     set status = 'cancelled', decided_at = now()
   where id = p_invitation_id;
  select name into v_group_name from public.study_groups where id = v_invite.group_id;
  perform private.notify(v_invite.invitee_id, 'invitation', 'أُلغيت دعوة حلقة تواصٍ: ' || coalesce(v_group_name, ''),
    'لم تعد الدعوة قائمة.', 'circles');
end $$;

create function public.list_my_group_member_invites()
returns table (
  invitation_id uuid, group_id uuid, group_name text, inviter_name text,
  created_at timestamptz, expires_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'الدعوات تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  update public.group_member_invitations i
     set status = 'expired', decided_at = now()
   where i.invitee_id = v_user and i.status = 'pending' and i.expires_at <= now();
  return query
    select i.id, g.id, g.name,
           coalesce(p.display_name, 'أحد أعضاء الحلقة'),
           i.created_at, i.expires_at
      from public.group_member_invitations i
      join public.study_groups g on g.id = i.group_id
      left join public.member_share_profiles p on p.user_id = i.invited_by
     where i.invitee_id = v_user and i.status = 'pending'
       and i.expires_at > now() and g.status = 'active'
     order by i.created_at desc
     limit 50;
end $$;

create function public.respond_group_member_invite(p_invitation_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_invite public.group_member_invitations%rowtype;
  v_group public.study_groups%rowtype;
begin
  if v_user is null then
    raise exception 'الرد على الدعوة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_accept is null then
    raise exception 'اختر قبول الدعوة أو رفضها' using errcode = '22023';
  end if;
  select * into v_invite
    from public.group_member_invitations
   where id = p_invitation_id and invitee_id = v_user
   for update;
  if not found then
    raise exception 'الدعوة غير موجودة' using errcode = '42501';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'الدعوة لم تعد معلقة' using errcode = 'P0001';
  end if;
  select * into v_group from public.study_groups where id = v_invite.group_id for update;
  if v_invite.expires_at <= now() or v_group.status <> 'active' then
    update public.group_member_invitations set status = 'expired', decided_at = now() where id = v_invite.id;
    return 'expired';
  end if;
  if not p_accept then
    update public.group_member_invitations set status = 'declined', decided_at = now() where id = v_invite.id;
    perform private.notify(v_invite.invited_by, 'invitation', 'اعتذر عضو عن دعوة حلقة تواصٍ: ' || v_group.name,
      'لم ينضم العضو هذه المرة.', 'circles');
    return 'declined';
  end if;
  if exists (select 1 from public.group_members where group_id = v_group.id and user_id = v_user) then
    update public.group_member_invitations set status = 'accepted', decided_at = now() where id = v_invite.id;
    return 'accepted';
  end if;
  if (select count(*) from public.group_members where group_id = v_group.id) >= v_group.member_limit then
    update public.group_member_invitations set status = 'expired', decided_at = now() where id = v_invite.id;
    perform private.notify(v_invite.invited_by, 'invitation', 'تعذر قبول دعوة حلقة تواصٍ: ' || v_group.name,
      'اكتملت سعة الحلقة قبل قبول الدعوة.', 'circles');
    return 'full';
  end if;
  insert into public.group_members(group_id, user_id, role)
  values (v_group.id, v_user, 'member');
  update public.group_member_invitations set status = 'accepted', decided_at = now() where id = v_invite.id;
  update public.group_join_requests
     set status = 'accepted', decided_at = now(), decided_by = v_invite.invited_by
   where group_id = v_group.id and user_id = v_user and status = 'pending';
  perform private.notify(v_invite.invited_by, 'invitation', 'قبل دعوتك إلى حلقة تواصٍ: ' || v_group.name,
    'انضم العضو إلى الحلقة.', 'circles');
  return 'accepted';
end $$;

revoke all on function public.invite_group_member(uuid, text) from public, anon, authenticated;
revoke all on function public.list_group_member_invites(uuid) from public, anon, authenticated;
revoke all on function public.cancel_group_member_invite(uuid) from public, anon, authenticated;
revoke all on function public.list_my_group_member_invites() from public, anon, authenticated;
revoke all on function public.respond_group_member_invite(uuid, boolean) from public, anon, authenticated;
grant execute on function public.invite_group_member(uuid, text) to authenticated;
grant execute on function public.list_group_member_invites(uuid) to authenticated;
grant execute on function public.cancel_group_member_invite(uuid) to authenticated;
grant execute on function public.list_my_group_member_invites() to authenticated;
grant execute on function public.respond_group_member_invite(uuid, boolean) to authenticated;
