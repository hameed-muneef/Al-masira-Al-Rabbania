-- INV-001: activity-based invitations with one reusable read/respond layer.
-- Sending always starts inside the activity that owns the invitation:
--   المدارسة  -> study_member_invites (already exists, managed here)
--   مجالس العلم -> course_invitations
--   التواصي    -> tawasi_session_invitations
-- list_my_activity_invitations()/respond_activity_invitation() give future
-- activities one place to plug in without a second invitation inbox.
-- No table grants or policies: access is RPC-only, as with the rest of the
-- private activity modules.

-- ============ 1) مجالس العلم ============
create table public.course_invitations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','expired')),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz not null
);
create unique index course_invitations_pending_idx
  on public.course_invitations (course_id, invitee_id) where status = 'pending';
create index course_invitations_course_idx on public.course_invitations(course_id, status, created_at desc);
create index course_invitations_invitee_idx on public.course_invitations(invitee_id, status);

-- ============ 2) جلسات التواصي ============
create table public.tawasi_session_invitations (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.tawasi_mentor_slots(id) on delete cascade,
  mentor_id uuid not null references public.tawasi_mentors(user_id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  topic text not null check (char_length(btrim(topic)) between 2 and 120),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','expired')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz not null,
  check (mentor_id <> invitee_id)
);
create unique index tawasi_session_invitations_pending_idx
  on public.tawasi_session_invitations (slot_id, invitee_id) where status = 'pending';
create index tawasi_session_invitations_slot_idx on public.tawasi_session_invitations(slot_id, status);
create index tawasi_session_invitations_invitee_idx on public.tawasi_session_invitations(invitee_id, status);

alter table public.course_invitations enable row level security;
alter table public.tawasi_session_invitations enable row level security;
revoke all on public.course_invitations, public.tawasi_session_invitations from public, anon, authenticated;

-- ============ 3) shared helpers ============
create function private.consume_activity_invite(p_user uuid)
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
    into v_used;
  if v_used >= coalesce(v_max, 20) then
    raise exception 'بلغت الحد اليومي للدعوات' using errcode = 'P0001';
  end if;
end $$;

create function private.activity_invite_ttl()
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select invitation_ttl_days from public.share_settings where id), 14);
$$;

-- ============ 4) إدارة دعوات المدارسة ============
create function public.list_study_circle_invites(p_circle_id uuid)
returns table (invite_id uuid, invitee_username text, invitee_name text, status text, created_at timestamptz, decided_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'الدعوات تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if private.study_role(p_circle_id, array['creator','supervisor']) is null then
    raise exception 'المنشئ أو المشرف فقط يرى الدعوات' using errcode = '42501';
  end if;
  return query
    select i.id, p.username, p.display_name, i.status, i.created_at, i.decided_at
      from public.study_member_invites i
      left join public.member_share_profiles p on p.user_id = i.invitee_id
     where i.circle_id = p_circle_id
     order by i.created_at desc
     limit 100;
end $$;

create function public.cancel_study_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.study_member_invites%rowtype;
  v_title text;
begin
  if (select auth.uid()) is null then
    raise exception 'إلغاء الدعوة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_inv from public.study_member_invites where id = p_invite_id for update;
  if not found then
    raise exception 'الدعوة غير موجودة' using errcode = 'P0001';
  end if;
  if private.study_role(v_inv.circle_id, array['creator','supervisor']) is null then
    raise exception 'المنشئ أو المشرف فقط يلغي الدعوات' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'لا يمكن إلغاء دعوة حُسمت' using errcode = 'P0001';
  end if;
  select title into v_title from public.study_circles where id = v_inv.circle_id;
  update public.study_member_invites set status = 'cancelled', decided_at = now() where id = v_inv.id;
  perform private.notify(v_inv.invitee_id, 'invitation', 'أُلغيت دعوة مدارسة: ' || coalesce(v_title, ''),
    'لم تعد الدعوة قائمة.', 'study');
end $$;

-- ============ 5) دعوات مجالس العلم ============
create function public.invite_course_member(p_course_id uuid, p_username text, p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_course public.courses%rowtype;
  v_name text := lower(btrim(coalesce(p_username, '')));
  v_invitee uuid;
  v_ttl integer;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'الدعوة تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'المجلس غير موجود' using errcode = 'P0001';
  end if;
  if v_course.teacher_id <> v_user and not public.is_admin() then
    raise exception 'معلم المجلس فقط يدعو المشاركين' using errcode = '42501';
  end if;
  if v_course.status <> 'published' or v_course.access <> 'public'
     or v_course.registration <> 'open' or not public.is_teacher_approved(v_course.teacher_id) then
    raise exception 'الدعوة متاحة للمجالس المنشورة المفتوحة التسجيل فقط' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_note, '')) > 300 then
    raise exception 'ملاحظة الدعوة طويلة' using errcode = '22023';
  end if;
  perform private.consume_share_search(v_user);
  select p.user_id into v_invitee from public.member_share_profiles p
   where p.username = v_name and p.discoverable and p.user_id <> v_user
     and not exists (select 1 from public.member_blocks b
           where (b.blocker_id = p.user_id and b.blocked_id = v_user)
              or (b.blocker_id = v_user and b.blocked_id = p.user_id));
  if v_invitee is null then
    raise exception 'تعذّرت الدعوة. تحقق من اسم المستخدم.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.course_registrations r
              where r.course_id = p_course_id and r.user_id = v_invitee and r.status = 'registered') then
    raise exception 'العضو مسجل في المجلس بالفعل' using errcode = 'P0001';
  end if;
  perform private.consume_activity_invite(v_user);
  v_ttl := private.activity_invite_ttl();
  begin
    insert into public.course_invitations (course_id, invitee_id, invited_by, note, expires_at)
    values (p_course_id, v_invitee, v_user, btrim(coalesce(p_note, '')), now() + make_interval(days => v_ttl))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'سبق إرسال دعوة لهذا العضو وهي بانتظار رده' using errcode = 'P0001';
  end;
  perform private.notify(v_invitee, 'invitation', 'دعوة إلى مجلس علم: ' || v_course.title,
    'وصلتك دعوة للانضمام إلى المجلس، افتح مجالس العلم لقبولها أو رفضها.', 'courses');
  return v_id;
end $$;

create function public.list_course_invites(p_course_id uuid)
returns table (invite_id uuid, invitee_username text, invitee_name text, status text, created_at timestamptz, expires_at timestamptz, decided_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_course public.courses%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'الدعوات تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'المجلس غير موجود' using errcode = 'P0001';
  end if;
  if v_course.teacher_id <> (select auth.uid()) and not public.is_admin() then
    raise exception 'معلم المجلس فقط يرى الدعوات' using errcode = '42501';
  end if;
  return query
    select i.id, p.username, p.display_name, i.status, i.created_at, i.expires_at, i.decided_at
      from public.course_invitations i
      left join public.member_share_profiles p on p.user_id = i.invitee_id
     where i.course_id = p_course_id
     order by i.created_at desc
     limit 100;
end $$;

create function public.cancel_course_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.course_invitations%rowtype;
  v_course public.courses%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'إلغاء الدعوة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_inv from public.course_invitations where id = p_invite_id for update;
  if not found then
    raise exception 'الدعوة غير موجودة' using errcode = 'P0001';
  end if;
  select * into v_course from public.courses where id = v_inv.course_id;
  if v_course.teacher_id <> (select auth.uid()) and not public.is_admin() then
    raise exception 'معلم المجلس فقط يلغي الدعوات' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'لا يمكن إلغاء دعوة حُسمت' using errcode = 'P0001';
  end if;
  update public.course_invitations set status = 'cancelled', decided_at = now() where id = v_inv.id;
  perform private.notify(v_inv.invitee_id, 'invitation', 'أُلغيت دعوة مجلس: ' || v_course.title,
    'لم تعد الدعوة قائمة.', 'courses');
end $$;

create function public.respond_course_invitation(p_invitation_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_inv public.course_invitations%rowtype;
  v_course public.courses%rowtype;
  v_registered integer;
begin
  if v_user is null then
    raise exception 'الرد يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_inv from public.course_invitations
   where id = p_invitation_id and invitee_id = v_user for update;
  if not found then
    raise exception 'الدعوة غير موجودة أو لا تملك الرد عليها' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'حُسمت هذه الدعوة من قبل' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() then
    update public.course_invitations set status = 'expired', decided_at = now() where id = v_inv.id;
    return 'expired';
  end if;
  select * into v_course from public.courses where id = v_inv.course_id for update;
  if not found or v_course.status <> 'published' or v_course.access <> 'public'
     or v_course.registration <> 'open' or not public.is_teacher_approved(v_course.teacher_id) then
    raise exception 'المجلس لم يعد يقبل التسجيل' using errcode = 'P0001';
  end if;
  if p_accept then
    if exists (select 1 from public.course_registrations r
                where r.course_id = v_course.id and r.user_id = v_user and r.status = 'registered') then
      update public.course_invitations set status = 'accepted', decided_at = now() where id = v_inv.id;
      return 'already_registered';
    end if;
    select count(*) into v_registered from public.course_registrations
     where course_id = v_course.id and status = 'registered';
    if v_registered >= v_course.capacity then
      raise exception 'السعة مكتملة' using errcode = 'P0001';
    end if;
    insert into public.course_registrations (course_id, user_id, status)
    values (v_course.id, v_user, 'registered')
    on conflict (course_id, user_id) do update set status = 'registered', updated_at = now();
    update public.course_invitations set status = 'accepted', decided_at = now() where id = v_inv.id;
    perform private.notify(v_inv.invited_by, 'invitation', 'قبل دعوتك: ' || v_course.title,
      'انضم العضو إلى المجلس.', 'courses');
    return 'accepted';
  end if;
  update public.course_invitations set status = 'declined', decided_at = now() where id = v_inv.id;
  perform private.notify(v_inv.invited_by, 'invitation', 'اعتذر عن دعوتك: ' || v_course.title,
    'لم ينضم العضو هذه المرة.', 'courses');
  return 'declined';
end $$;

-- ============ 6) دعوات جلسات التواصي ============
create function public.invite_tawasi_member(p_slot_id uuid, p_username text, p_topic text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_slot public.tawasi_mentor_slots%rowtype;
  v_name text := lower(btrim(coalesce(p_username, '')));
  v_invitee uuid;
  v_ttl integer;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'الدعوة تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tawasi_mentors where user_id = v_user and status = 'approved') then
    raise exception 'اعتماد المرشد مطلوب قبل الدعوة' using errcode = '42501';
  end if;
  select * into v_slot from public.tawasi_mentor_slots where id = p_slot_id for update;
  if not found or v_slot.mentor_id <> v_user then
    raise exception 'الموعد غير موجود أو لا تملكه' using errcode = '42501';
  end if;
  if v_slot.status <> 'available' or v_slot.starts_at <= now() then
    raise exception 'الموعد لم يعد متاحًا' using errcode = 'P0001';
  end if;
  if p_topic is null or char_length(btrim(p_topic)) not between 2 and 120 then
    raise exception 'موضوع الجلسة غير صالح' using errcode = '22023';
  end if;
  perform private.consume_share_search(v_user);
  select p.user_id into v_invitee from public.member_share_profiles p
   where p.username = v_name and p.discoverable and p.user_id <> v_user
     and not exists (select 1 from public.member_blocks b
           where (b.blocker_id = p.user_id and b.blocked_id = v_user)
              or (b.blocker_id = v_user and b.blocked_id = p.user_id));
  if v_invitee is null then
    raise exception 'تعذّرت الدعوة. تحقق من اسم المستخدم.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tawasi_mentorship_requests r
              where r.slot_id = p_slot_id and r.status in ('pending','confirmed')) then
    raise exception 'الموعد محجوز أو عليه طلب' using errcode = 'P0001';
  end if;
  perform private.consume_activity_invite(v_user);
  v_ttl := private.activity_invite_ttl();
  begin
    insert into public.tawasi_session_invitations (slot_id, mentor_id, invitee_id, topic, expires_at)
    values (p_slot_id, v_user, v_invitee, btrim(p_topic), least(v_slot.starts_at, now() + make_interval(days => v_ttl)))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'سبق إرسال دعوة لهذا العضو على الموعد نفسه' using errcode = 'P0001';
  end;
  perform private.notify(v_invitee, 'invitation', 'دعوة إلى جلسة تواصٍ',
    'دعاك مرشد معتمد إلى جلسة خاصة، افتح التواصي لقبولها أو رفضها.', 'circles');
  return v_id;
end $$;

create function public.list_tawasi_slot_invitations()
returns table (invite_id uuid, slot_id uuid, invitee_username text, invitee_name text, topic text, status text, starts_at timestamptz, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'الدعوات تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  return query
    select i.id, i.slot_id, p.username, p.display_name, i.topic, i.status, s.starts_at, i.created_at, i.expires_at
      from public.tawasi_session_invitations i
      join public.tawasi_mentor_slots s on s.id = i.slot_id
      left join public.member_share_profiles p on p.user_id = i.invitee_id
     where i.mentor_id = (select auth.uid())
     order by i.created_at desc
     limit 100;
end $$;

create function public.cancel_tawasi_slot_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.tawasi_session_invitations%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'إلغاء الدعوة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_inv from public.tawasi_session_invitations where id = p_invitation_id for update;
  if not found then
    raise exception 'الدعوة غير موجودة' using errcode = 'P0001';
  end if;
  if v_inv.mentor_id <> (select auth.uid()) then
    raise exception 'المرشد صاحب الدعوة فقط يلغيها' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'لا يمكن إلغاء دعوة حُسمت' using errcode = 'P0001';
  end if;
  update public.tawasi_session_invitations set status = 'cancelled', decided_at = now() where id = v_inv.id;
  perform private.notify(v_inv.invitee_id, 'invitation', 'أُلغيت دعوة جلسة تواصٍ',
    'لم تعد الدعوة قائمة.', 'circles');
end $$;

create function public.respond_tawasi_invitation(p_invitation_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_inv public.tawasi_session_invitations%rowtype;
  v_slot public.tawasi_mentor_slots%rowtype;
  v_mentor_name text;
begin
  if v_user is null then
    raise exception 'الرد يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_inv from public.tawasi_session_invitations
   where id = p_invitation_id and invitee_id = v_user for update;
  if not found then
    raise exception 'الدعوة غير موجودة أو لا تملك الرد عليها' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'حُسمت هذه الدعوة من قبل' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() then
    update public.tawasi_session_invitations set status = 'expired', decided_at = now() where id = v_inv.id;
    return 'expired';
  end if;
  select * into v_slot from public.tawasi_mentor_slots where id = v_inv.slot_id for update;
  if not found or v_slot.status <> 'available' or v_slot.starts_at <= now() then
    update public.tawasi_session_invitations set status = 'expired', decided_at = now() where id = v_inv.id;
    return 'unavailable';
  end if;
  select display_name into v_mentor_name from public.tawasi_mentors where user_id = v_inv.mentor_id;
  if p_accept then
    if exists (select 1 from public.tawasi_mentorship_requests r
                where r.slot_id = v_inv.slot_id and r.status in ('pending','confirmed')) then
      update public.tawasi_session_invitations set status = 'expired', decided_at = now() where id = v_inv.id;
      return 'unavailable';
    end if;
    insert into public.tawasi_mentorship_requests (slot_id, mentor_id, requester_id, topic, private_details, status)
    values (v_inv.slot_id, v_inv.mentor_id, v_user, v_inv.topic, '', 'confirmed');
    update public.tawasi_mentor_slots set status = 'booked' where id = v_inv.slot_id;
    update public.tawasi_session_invitations set status = 'accepted', decided_at = now() where id = v_inv.id;
    perform private.notify(v_inv.mentor_id, 'invitation', 'قبل دعوتك إلى جلسة تواصٍ',
      'أصبح الموعد مؤكدًا مع ' || coalesce(v_mentor_name, 'العضو') || '.', 'circles');
    return 'accepted';
  end if;
  update public.tawasi_session_invitations set status = 'declined', decided_at = now() where id = v_inv.id;
  perform private.notify(v_inv.mentor_id, 'invitation', 'اعتذر عن دعوة جلسة تواصٍ',
    'بقي الموعد متاحًا.', 'circles');
  return 'declined';
end $$;

-- ============ 7) reusable read/respond layer for future activities ============
-- The listing is volatile on purpose: it lazily moves expired pending invites to
-- 'expired' before returning, so the recipient and organizer feeds agree.
create function public.list_my_activity_invitations(p_activity_type text default null)
returns table (activity_type text, invitation_id uuid, activity_id uuid, activity_title text,
               inviter_name text, status text, created_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'الدعوات تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_activity_type is not null and p_activity_type not in ('study_circle','course','tawasi_session') then
    raise exception 'نوع النشاط غير صالح' using errcode = '22023';
  end if;
  update public.course_invitations ci set status = 'expired', decided_at = now()
   where ci.invitee_id = v_user and ci.status = 'pending' and ci.expires_at <= now();
  update public.tawasi_session_invitations ti set status = 'expired', decided_at = now()
   where ti.invitee_id = v_user and ti.status = 'pending' and (ti.expires_at <= now());
  return query
    select 'study_circle'::text, i.id, c.id, c.title,
           coalesce(p.display_name, 'أحد الأعضاء'), i.status, i.created_at, null::timestamptz
      from public.study_member_invites i
      join public.study_circles c on c.id = i.circle_id
      left join public.member_share_profiles p on p.user_id = i.invited_by
     where i.invitee_id = v_user and i.status = 'pending' and c.status = 'active'
       and (p_activity_type is null or p_activity_type = 'study_circle')
    union all
    select 'course'::text, i.id, c.id, c.title,
           coalesce(p.display_name, 'معلم المجلس'), i.status, i.created_at, i.expires_at
      from public.course_invitations i
      join public.courses c on c.id = i.course_id
      left join public.member_share_profiles p on p.user_id = i.invited_by
     where i.invitee_id = v_user and i.status = 'pending' and c.status = 'published' and c.access = 'public'
       and (p_activity_type is null or p_activity_type = 'course')
    union all
    select 'tawasi_session'::text, i.id, s.id, 'جلسة تواصٍ مع ' || m.display_name,
           m.display_name, i.status, i.created_at, i.expires_at
      from public.tawasi_session_invitations i
      join public.tawasi_mentor_slots s on s.id = i.slot_id
      join public.tawasi_mentors m on m.user_id = i.mentor_id
     where i.invitee_id = v_user and i.status = 'pending'
       and s.status = 'available' and s.starts_at > now() and m.status = 'approved'
       and (p_activity_type is null or p_activity_type = 'tawasi_session')
    order by created_at desc
    limit 50;
end $$;

create function public.respond_activity_invitation(p_activity_type text, p_invitation_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_activity_type = 'study_circle' then
    perform public.respond_study_invite(p_invitation_id, p_accept);
  elsif p_activity_type = 'course' then
    return public.respond_course_invitation(p_invitation_id, p_accept);
  elsif p_activity_type = 'tawasi_session' then
    return public.respond_tawasi_invitation(p_invitation_id, p_accept);
  else
    raise exception 'نوع النشاط غير صالح' using errcode = '22023';
  end if;
  return case when p_accept then 'accepted' else 'declined' end;
end $$;

-- ============ 8) grants ============
revoke all on function private.consume_activity_invite(uuid) from public, anon, authenticated;
revoke all on function private.activity_invite_ttl() from public, anon, authenticated;
revoke all on function public.list_study_circle_invites(uuid) from public, anon, authenticated;
revoke all on function public.cancel_study_invite(uuid) from public, anon, authenticated;
revoke all on function public.invite_course_member(uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_course_invites(uuid) from public, anon, authenticated;
revoke all on function public.cancel_course_invite(uuid) from public, anon, authenticated;
revoke all on function public.respond_course_invitation(uuid, boolean) from public, anon, authenticated;
revoke all on function public.invite_tawasi_member(uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_tawasi_slot_invitations() from public, anon, authenticated;
revoke all on function public.cancel_tawasi_slot_invitation(uuid) from public, anon, authenticated;
revoke all on function public.respond_tawasi_invitation(uuid, boolean) from public, anon, authenticated;
revoke all on function public.list_my_activity_invitations(text) from public, anon, authenticated;
revoke all on function public.respond_activity_invitation(text, uuid, boolean) from public, anon, authenticated;

grant execute on function public.list_study_circle_invites(uuid) to authenticated;
grant execute on function public.cancel_study_invite(uuid) to authenticated;
grant execute on function public.invite_course_member(uuid, text, text) to authenticated;
grant execute on function public.list_course_invites(uuid) to authenticated;
grant execute on function public.cancel_course_invite(uuid) to authenticated;
grant execute on function public.respond_course_invitation(uuid, boolean) to authenticated;
grant execute on function public.invite_tawasi_member(uuid, text, text) to authenticated;
grant execute on function public.list_tawasi_slot_invitations() to authenticated;
grant execute on function public.cancel_tawasi_slot_invitation(uuid) to authenticated;
grant execute on function public.respond_tawasi_invitation(uuid, boolean) to authenticated;
grant execute on function public.list_my_activity_invitations(text) to authenticated;
grant execute on function public.respond_activity_invitation(text, uuid, boolean) to authenticated;
