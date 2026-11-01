-- دعوة عضو إلى مدارسة باسم المستخدم (بدل الرابط فقط). القبول بيد المدعو.
create table public.study_member_invites (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index study_member_invites_pending_idx
  on public.study_member_invites (circle_id, invitee_id) where status = 'pending';
create index study_member_invites_invitee_idx on public.study_member_invites (invitee_id, status);
alter table public.study_member_invites enable row level security;
revoke all on public.study_member_invites from public, anon, authenticated;

create function public.invite_study_member(p_circle_id uuid, p_username text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_name text := lower(btrim(coalesce(p_username, '')));
  v_invitee uuid;
  v_title text;
  v_status text;
begin
  if v_user is null then
    raise exception 'الدعوة تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if private.study_role(p_circle_id, array['creator','supervisor']) is null then
    raise exception 'المنشئ أو المشرف فقط يدعو الأعضاء' using errcode = '42501';
  end if;
  select title, status into v_title, v_status from public.study_circles where id = p_circle_id;
  if v_status is distinct from 'active' then
    raise exception 'المدارسة ليست نشطة فلا تصدر دعوات' using errcode = 'P0001';
  end if;
  perform private.consume_share_search(v_user);
  select p.user_id into v_invitee from public.member_share_profiles p
   where p.username = v_name and p.discoverable and p.user_id <> v_user
     and not exists (select 1 from public.member_blocks b
           where (b.blocker_id = p.user_id and b.blocked_id = v_user)
              or (b.blocker_id = v_user and b.blocked_id = p.user_id));
  if v_invitee is null then
    raise exception 'تعذّرت دعوة هذا الاسم. تأكد من اسم المستخدم.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.study_circle_members where circle_id = p_circle_id and user_id = v_invitee) then
    raise exception 'هذا العضو في المدارسة بالفعل' using errcode = 'P0001';
  end if;
  begin
    insert into public.study_member_invites (circle_id, invitee_id, invited_by)
    values (p_circle_id, v_invitee, v_user);
  exception when unique_violation then
    raise exception 'سبق إرسال دعوة لهذا العضو وهي بانتظار رده' using errcode = 'P0001';
  end;
  insert into public.notifications (recipient_id, kind, title, body, link)
  values (v_invitee, 'mudarasa', 'دعوة إلى مدارسة: ' || v_title,
          'وصلتك دعوة للانضمام، افتح المدارسة لقبولها أو رفضها.', 'study');
end $$;

create function public.list_my_study_invites()
returns table (invite_id uuid, circle_title text, inviter_name text, created_at timestamptz)
language sql security definer set search_path = '' as $$
  select i.id, c.title,
         coalesce((select p.display_name from public.member_share_profiles p where p.user_id = i.invited_by), 'أحد الأعضاء'),
         i.created_at
    from public.study_member_invites i
    join public.study_circles c on c.id = i.circle_id
   where i.invitee_id = (select auth.uid()) and i.status = 'pending' and c.status = 'active'
   order by i.created_at desc limit 50;
$$;

create function public.respond_study_invite(p_invite_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_inv public.study_member_invites%rowtype;
  v_title text;
begin
  if v_user is null then
    raise exception 'الرد يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_inv from public.study_member_invites
   where id = p_invite_id and invitee_id = v_user and status = 'pending' for update;
  if not found then
    raise exception 'الدعوة غير موجودة أو انتهت' using errcode = 'P0001';
  end if;
  select title into v_title from public.study_circles where id = v_inv.circle_id and status = 'active';
  if v_title is null then
    raise exception 'المدارسة لم تعد نشطة' using errcode = 'P0001';
  end if;
  update public.study_member_invites
     set status = case when p_accept then 'accepted' else 'declined' end, decided_at = now()
   where id = v_inv.id;
  if p_accept then
    insert into public.study_circle_members (circle_id, user_id, role)
    values (v_inv.circle_id, v_user, 'member') on conflict (circle_id, user_id) do nothing;
  end if;
  insert into public.notifications (recipient_id, kind, title, body, link)
  values (v_inv.invited_by, 'mudarasa',
          (case when p_accept then 'قبل دعوتك: ' else 'اعتذر عن دعوتك: ' end) || v_title,
          (case when p_accept then 'انضم عضو جديد إلى المدارسة.' else 'لم ينضم العضو هذه المرة.' end), 'study');
end $$;

revoke all on function public.invite_study_member(uuid, text) from public, anon, authenticated;
revoke all on function public.list_my_study_invites() from public, anon, authenticated;
revoke all on function public.respond_study_invite(uuid, boolean) from public, anon, authenticated;
grant execute on function public.invite_study_member(uuid, text) to authenticated;
grant execute on function public.list_my_study_invites() to authenticated;
grant execute on function public.respond_study_invite(uuid, boolean) to authenticated;
