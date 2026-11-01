-- SHR-001: limited member sharing (resource, activity invitation, predefined
-- notification, educational recommendation). This is NOT a messaging system:
-- there is no reply, comment, thread or free-form text channel. Every table is
-- RLS-protected with no direct grants to members; all access goes through
-- security-definer RPCs that return only safe columns (no user ids, e-mail or
-- phone). Recipients are addressed by public username only.

create table public.member_share_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[a-z][a-z0-9_]{2,19}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  discoverable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index member_share_profiles_username_key on public.member_share_profiles(username);

create table public.share_settings (
  id boolean primary key default true check (id),
  max_per_day integer not null default 20 check (max_per_day between 1 and 500),
  max_per_recipient integer not null default 3 check (max_per_recipient between 1 and 50),
  recipient_window_hours integer not null default 24 check (recipient_window_hours between 1 and 720),
  max_description_length integer not null default 280 check (max_description_length between 0 and 1000),
  search_per_hour integer not null default 30 check (search_per_hour between 1 and 500),
  invitation_ttl_days integer not null default 14 check (invitation_ttl_days between 1 and 90),
  retention_days integer not null default 180 check (retention_days between 30 and 1095),
  allowed_types text[] not null default array['resource','activity_invitation','notification','recommendation']
    check (allowed_types <@ array['resource','activity_invitation','notification','recommendation']::text[]),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.share_settings(id) values (true);

create table public.member_shares (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  share_type text not null check (share_type in ('resource','activity_invitation','notification','recommendation')),
  ref_kind text not null check (ref_kind in ('course','resource','unit','url')),
  ref_key text not null default '' check (char_length(ref_key) <= 500),
  ref_title text not null check (char_length(btrim(ref_title)) between 1 and 200),
  template_key text not null default '' check (template_key in ('','session_reminder','materials_ready','confirm_attendance','schedule_changed')),
  description text not null default '' check (char_length(description) <= 1000),
  status text not null default 'sent' check (status in ('sent','accepted','declined')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  archived_at timestamptz,
  sender_hidden_at timestamptz,
  responded_at timestamptz,
  unique (sender_id, request_key),
  check (sender_id <> recipient_id),
  check (
    (share_type = 'resource' and ref_kind in ('course','resource','url') and template_key = '')
    or (share_type = 'recommendation' and ref_kind in ('course','resource','unit') and template_key = '')
    or (share_type = 'activity_invitation' and ref_kind = 'course' and template_key = '' and expires_at is not null)
    or (share_type = 'notification' and ref_kind = 'course' and template_key <> '' and description = '')
  )
);
create index member_shares_recipient_idx on public.member_shares(recipient_id, created_at desc);
create index member_shares_sender_idx on public.member_shares(sender_id, created_at desc);

create table public.member_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index member_blocks_blocked_idx on public.member_blocks(blocked_id);

create table public.share_restrictions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  restricted_until timestamptz,
  reason text not null default '' check (char_length(reason) <= 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.share_search_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index share_search_log_user_idx on public.share_search_log(user_id, created_at desc);

create table public.share_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  event text not null check (char_length(event) between 1 and 60),
  share_id uuid,
  target_user_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index share_events_created_idx on public.share_events(created_at desc);

do $$
declare t text;
begin
  foreach t in array array['member_share_profiles','share_settings','member_shares','member_blocks','share_restrictions','share_search_log','share_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- Existing systems reused: the notification table accepts a new 'share' kind and
-- the reports table accepts 'share' targets.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('announcement','join_request','join_decision','course','session','report','system','mudarasa','share'));
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('course','circle','teacher','lesson','share'));

insert into public.platform_features(key,title,description,enabled,requires_premium)
values ('member_shares','المشاركات','مشاركة محدودة للمصادر والدعوات والتنبيهات بين الأعضاء',true,false)
on conflict (key) do nothing;

-- ---------- private helpers ----------
create function private.share_restricted(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.share_restrictions r
    where r.user_id = p_user and (r.restricted_until is null or r.restricted_until > now()));
$$;

create function private.is_safe_share_url(p_url text) returns boolean
language sql immutable set search_path = '' as $$
  select p_url is not null and char_length(p_url) <= 500
    and p_url ~* '^https?://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?([/?#][^\s<>"''\\]*)?$'
    and p_url !~* '^https?://([0-9]{1,3}\.){3}[0-9]{1,3}'
    and p_url !~* '^https?://[^/?#]*\.(local|internal|localhost|lan|test|invalid)(:|/|\?|#|$)';
$$;

create function private.log_share_event(p_actor uuid, p_event text, p_share uuid, p_target uuid, p_details jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.share_events(actor_id, event, share_id, target_user_id, details)
  values (p_actor, p_event, p_share, p_target, coalesce(p_details, '{}'::jsonb));
$$;

create function private.consume_share_search(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_used integer;
begin
  delete from public.share_search_log where user_id = p_user and created_at < now() - interval '2 days';
  select search_per_hour into v_limit from public.share_settings where id;
  select count(*) into v_used from public.share_search_log
   where user_id = p_user and created_at > now() - interval '1 hour';
  if v_used >= v_limit then
    raise exception 'كثرت عمليات البحث، حاول لاحقًا' using errcode = 'P0001';
  end if;
  insert into public.share_search_log(user_id) values (p_user);
end $$;

create function private.resolve_share_ref(p_kind text, p_key text, p_hint text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_title text; v_has_curriculum boolean;
begin
  if p_kind = 'course' then
    if p_key !~ '^[0-9a-fA-F-]{36}$' then raise exception 'مرجع المجلس غير صالح' using errcode = '22023'; end if;
    select c.title into v_title from public.courses c
     where c.id = p_key::uuid and c.status = 'published' and c.access = 'public'
       and public.is_teacher_approved(c.teacher_id);
  elsif p_kind in ('resource','unit') then
    if p_key !~ '^[A-Za-z0-9_.:-]{1,80}$' then raise exception 'مرجع المحتوى غير صالح' using errcode = '22023'; end if;
    select exists (select 1 from public.platform_curriculum where id = 'main') into v_has_curriculum;
    if v_has_curriculum then
      if p_kind = 'resource' then
        select r.value ->> 'title' into v_title
          from public.platform_curriculum pc,
               jsonb_path_query(pc.payload, '$.units[*] ? (@.status == "published")') u,
               jsonb_path_query(u, '$.resources[*]') r(value)
         where pc.id = 'main' and r.value ->> 'id' = p_key limit 1;
      else
        select u ->> 'title' into v_title
          from public.platform_curriculum pc,
               jsonb_path_query(pc.payload, '$.units[*] ? (@.status == "published")') u
         where pc.id = 'main' and u ->> 'id' = p_key limit 1;
      end if;
    elsif char_length(btrim(coalesce(p_hint, ''))) > 0 then
      -- The shared curriculum has not been saved to the database yet, so only the
      -- reference format can be validated; the title comes from the sender.
      v_title := left(btrim(p_hint), 200);
    end if;
  end if;
  if v_title is null or char_length(btrim(v_title)) = 0 then
    raise exception 'المحتوى المحدد غير متاح للمشاركة' using errcode = 'P0001';
  end if;
  return left(btrim(v_title), 200);
end $$;

-- ---------- member profile ----------
create function public.get_my_share_profile()
returns table (username text, display_name text, discoverable boolean)
language sql security definer set search_path = '' as $$
  select p.username, p.display_name, p.discoverable from public.member_share_profiles p
   where p.user_id = (select auth.uid());
$$;

create function public.save_my_share_profile(p_username text, p_display_name text, p_discoverable boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if v_user is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  if v_username !~ '^[a-z][a-z0-9_]{2,19}$' then
    raise exception 'اسم المستخدم من 3 إلى 20 حرفًا: إنجليزية صغيرة وأرقام و_ ويبدأ بحرف' using errcode = '22023';
  end if;
  if v_username in ('admin','administrator','support','system','moderator','rabbaniyun','rabbaniyyun','alrabbaniyun') then
    raise exception 'اسم المستخدم محجوز' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'الاسم الظاهر يجب أن يكون بين 1 و60 حرفًا' using errcode = '22023';
  end if;
  begin
    insert into public.member_share_profiles(user_id, username, display_name, discoverable)
    values (v_user, v_username, v_name, coalesce(p_discoverable, true))
    on conflict (user_id) do update set username = excluded.username,
      display_name = excluded.display_name, discoverable = excluded.discoverable, updated_at = now();
  exception when unique_violation then
    raise exception 'اسم المستخدم مستخدم من قبل' using errcode = 'P0001';
  end;
end $$;

create function public.check_username_available(p_username text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_username text := lower(btrim(coalesce(p_username, '')));
begin
  if v_user is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  perform private.consume_share_search(v_user);
  if v_username !~ '^[a-z][a-z0-9_]{2,19}$' then return false; end if;
  return not exists (select 1 from public.member_share_profiles p where p.username = v_username and p.user_id <> v_user);
end $$;

create function public.search_share_members(p_query text)
returns table (username text, display_name text)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_q text := lower(btrim(coalesce(p_query, '')));
begin
  if v_user is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  if not exists (select 1 from public.member_share_profiles where user_id = v_user) then
    raise exception 'أنشئ اسم مستخدم أولًا' using errcode = 'P0001';
  end if;
  if char_length(v_q) < 3 or char_length(v_q) > 20 then return; end if;
  perform private.consume_share_search(v_user);
  return query
    select p.username, p.display_name from public.member_share_profiles p
     where left(p.username, char_length(v_q)) = v_q and p.discoverable and p.user_id <> v_user
       and not exists (select 1 from public.member_blocks b
             where (b.blocker_id = p.user_id and b.blocked_id = v_user)
                or (b.blocker_id = v_user and b.blocked_id = p.user_id))
     order by p.username limit 5;
end $$;

create function public.get_share_config()
returns table (allowed_types text[], max_description_length integer, invitation_ttl_days integer, restricted boolean)
language sql security definer set search_path = '' as $$
  select s.allowed_types, s.max_description_length, s.invitation_ttl_days,
         private.share_restricted((select auth.uid()))
    from public.share_settings s where s.id and (select auth.uid()) is not null;
$$;

-- ---------- sending ----------
create function public.send_member_share(
  p_request_key uuid, p_recipient_username text, p_type text, p_ref_kind text,
  p_ref_key text default '', p_description text default '',
  p_template_key text default '', p_title_hint text default ''
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_sender uuid := (select auth.uid());
  v_cfg public.share_settings%rowtype;
  v_recipient uuid;
  v_username text := lower(btrim(coalesce(p_recipient_username, '')));
  v_desc text := btrim(coalesce(p_description, ''));
  v_key text := btrim(coalesce(p_ref_key, ''));
  v_template text := btrim(coalesce(p_template_key, ''));
  v_title text;
  v_expires timestamptz;
  v_course public.courses%rowtype;
  v_existing uuid;
  v_share uuid;
begin
  if v_sender is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  if p_request_key is null then raise exception 'معرّف الطلب مطلوب' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_sender::text, 17));
  select m.id into v_existing from public.member_shares m
   where m.sender_id = v_sender and m.request_key = p_request_key;
  if found then return v_existing; end if;

  select * into v_cfg from public.share_settings where id;
  if not exists (select 1 from public.member_share_profiles where user_id = v_sender) then
    raise exception 'أنشئ اسم مستخدم أولًا' using errcode = 'P0001';
  end if;
  if private.share_restricted(v_sender) then
    raise exception 'المشاركات متوقفة مؤقتًا لهذا الحساب' using errcode = '42501';
  end if;
  if p_type is null or not (p_type = any (v_cfg.allowed_types)) then
    raise exception 'هذا النوع من المشاركات غير متاح حاليًا' using errcode = '22023';
  end if;

  select p.user_id into v_recipient from public.member_share_profiles p
   where p.username = v_username and p.discoverable and p.user_id <> v_sender
     and not exists (select 1 from public.member_blocks b
           where (b.blocker_id = p.user_id and b.blocked_id = v_sender)
              or (b.blocker_id = v_sender and b.blocked_id = p.user_id));
  if v_recipient is null then
    raise exception 'تعذر الإرسال إلى هذا المستخدم' using errcode = 'P0001';
  end if;

  if (select count(*) from public.member_shares m
       where m.sender_id = v_sender and m.created_at > now() - interval '24 hours') >= v_cfg.max_per_day then
    raise exception 'بلغت الحد اليومي للمشاركات' using errcode = 'P0001';
  end if;
  if (select count(*) from public.member_shares m
       where m.sender_id = v_sender and m.recipient_id = v_recipient
         and m.created_at > now() - make_interval(hours => v_cfg.recipient_window_hours)) >= v_cfg.max_per_recipient then
    raise exception 'بلغت الحد المسموح للمشاركات إلى هذا المستخدم' using errcode = 'P0001';
  end if;

  if p_type = 'notification' then
    if v_desc <> '' or p_ref_kind is distinct from 'course' then
      raise exception 'التنبيه يستخدم نصًا جاهزًا ومرتبطًا بنشاط فقط' using errcode = '22023';
    end if;
    if v_template not in ('session_reminder','materials_ready','confirm_attendance','schedule_changed') then
      raise exception 'نص التنبيه غير صالح' using errcode = '22023';
    end if;
    if v_key !~ '^[0-9a-fA-F-]{36}$' then raise exception 'مرجع النشاط غير صالح' using errcode = '22023'; end if;
    select * into v_course from public.courses where id = v_key::uuid and status = 'published';
    if not found then raise exception 'النشاط غير متاح' using errcode = 'P0001'; end if;
    if not (v_course.teacher_id = v_sender or exists (select 1 from public.course_registrations r
          where r.course_id = v_course.id and r.user_id = v_sender and r.status = 'registered'))
       or not exists (select 1 from public.course_registrations r
          where r.course_id = v_course.id and r.user_id = v_recipient and r.status = 'registered') then
      raise exception 'التنبيه متاح لمن يشاركك النشاط نفسه فقط' using errcode = '42501';
    end if;
    v_title := left(v_course.title, 200);
  else
    if p_type = 'activity_invitation' and p_ref_kind is distinct from 'course' then
      raise exception 'الدعوة تكون إلى مجلس علم قائم فقط' using errcode = '22023';
    elsif p_type = 'recommendation' and p_ref_kind not in ('course','resource','unit') then
      raise exception 'التوصية تكون بمحتوى داخل المنصة فقط' using errcode = '22023';
    elsif p_type = 'resource' and p_ref_kind not in ('course','resource','url') then
      raise exception 'نوع المصدر غير صالح' using errcode = '22023';
    elsif p_ref_kind is null then
      raise exception 'نوع المرجع مطلوب' using errcode = '22023';
    end if;
    if v_template <> '' then raise exception 'نص جاهز غير مسموح لهذا النوع' using errcode = '22023'; end if;
    if char_length(v_desc) > v_cfg.max_description_length then
      raise exception 'الوصف أطول من الحد المسموح' using errcode = '22023';
    end if;
    if v_desc ~ '[\u0001-\u0008\u000B\u000C\u000E-\u001F]' or v_desc ~* '(https?:|www\.|://)' then
      raise exception 'الوصف لا يقبل روابط أو رموزًا غير صالحة' using errcode = '22023';
    end if;
    if p_ref_kind = 'url' then
      if not private.is_safe_share_url(v_key) then
        raise exception 'الرابط غير صالح؛ يُقبل http أو https بنطاق عام فقط' using errcode = '22023';
      end if;
      v_title := left(coalesce(substring(v_key from '^https?://([^/?#:]+)'), 'رابط خارجي'), 200);
    else
      v_title := private.resolve_share_ref(p_ref_kind, v_key, p_title_hint);
    end if;
    if p_type = 'activity_invitation' then
      select * into v_course from public.courses where id = v_key::uuid;
      if v_course.registration <> 'open' or (v_course.starts_at is not null and v_course.starts_at <= now()) then
        raise exception 'التسجيل في هذا المجلس غير متاح للدعوة' using errcode = 'P0001';
      end if;
      v_expires := least(now() + make_interval(days => v_cfg.invitation_ttl_days),
                         coalesce(v_course.starts_at, now() + make_interval(days => v_cfg.invitation_ttl_days)));
    end if;
  end if;

  if exists (select 1 from public.member_shares m
              where m.sender_id = v_sender and m.recipient_id = v_recipient and m.share_type = p_type
                and m.ref_kind = p_ref_kind and m.ref_key = v_key and m.template_key = v_template
                and m.created_at > now() - interval '7 days') then
    raise exception 'سبق إرسال مشاركة مطابقة إلى هذا المستخدم' using errcode = 'P0001';
  end if;

  insert into public.member_shares(request_key, sender_id, recipient_id, share_type, ref_kind, ref_key,
                                   ref_title, template_key, description, expires_at)
  values (p_request_key, v_sender, v_recipient, p_type, p_ref_kind, v_key, v_title, v_template, v_desc, v_expires)
  returning id into v_share;

  insert into public.notifications(recipient_id, kind, title, body, link)
  values (v_recipient, 'share',
          case p_type when 'activity_invitation' then 'دعوة إلى نشاط' when 'notification' then 'تنبيه جديد' else 'وصلتك مشاركة جديدة' end,
          '', 'shares');
  return v_share;
end $$;

-- ---------- inbox / outbox ----------
create function public.list_received_shares(p_archived boolean default false, p_limit integer default 50)
returns table (share_id uuid, share_type text, sender_username text, sender_name text, ref_kind text,
               ref_key text, ref_title text, template_key text, description text, share_status text,
               expires_at timestamptz, created_at timestamptz, read_at timestamptz, archived_at timestamptz)
language sql security definer set search_path = '' as $$
  select s.id, s.share_type, p.username, p.display_name, s.ref_kind, s.ref_key, s.ref_title, s.template_key,
         s.description,
         case when s.status = 'sent' and s.expires_at is not null and s.expires_at <= now() then 'expired' else s.status end,
         s.expires_at, s.created_at, s.read_at, s.archived_at
    from public.member_shares s
    left join public.member_share_profiles p on p.user_id = s.sender_id
   where s.recipient_id = (select auth.uid())
     and (s.archived_at is not null) = coalesce(p_archived, false)
   order by s.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create function public.list_sent_shares(p_limit integer default 50)
returns table (share_id uuid, share_type text, recipient_username text, recipient_name text, ref_kind text,
               ref_key text, ref_title text, template_key text, description text, share_status text,
               expires_at timestamptz, created_at timestamptz)
language sql security definer set search_path = '' as $$
  select s.id, s.share_type, p.username, p.display_name, s.ref_kind, s.ref_key, s.ref_title, s.template_key,
         s.description,
         case when s.status = 'sent' and s.expires_at is not null and s.expires_at <= now() then 'expired' else s.status end,
         s.expires_at, s.created_at
    from public.member_shares s
    left join public.member_share_profiles p on p.user_id = s.recipient_id
   where s.sender_id = (select auth.uid()) and s.sender_hidden_at is null
   order by s.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create function public.unread_share_count() returns integer
language sql security definer set search_path = '' as $$
  select count(*)::int from public.member_shares s
   where s.recipient_id = (select auth.uid()) and s.read_at is null and s.archived_at is null;
$$;

create function public.mark_share_read(p_share_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  update public.member_shares set read_at = now()
   where id = p_share_id and recipient_id = (select auth.uid()) and read_at is null;
end $$;

create function public.mark_all_shares_read() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  update public.member_shares set read_at = now()
   where recipient_id = (select auth.uid()) and read_at is null;
end $$;

create function public.archive_share(p_share_id uuid, p_archived boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  update public.member_shares
     set archived_at = case when coalesce(p_archived, true) then coalesce(archived_at, now()) else null end,
         read_at = coalesce(read_at, now())
   where id = p_share_id and recipient_id = (select auth.uid());
  if not found then raise exception 'المشاركة غير موجودة' using errcode = 'P0001'; end if;
end $$;

create function public.hide_sent_share(p_share_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  update public.member_shares set sender_hidden_at = coalesce(sender_hidden_at, now())
   where id = p_share_id and sender_id = (select auth.uid());
  if not found then raise exception 'المشاركة غير موجودة' using errcode = 'P0001'; end if;
end $$;

create function public.respond_share_invitation(p_share_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_share public.member_shares%rowtype;
begin
  if v_user is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  if p_accept is null then raise exception 'القرار مطلوب' using errcode = '22023'; end if;
  select * into v_share from public.member_shares where id = p_share_id and recipient_id = v_user for update;
  if not found or v_share.share_type <> 'activity_invitation' then
    raise exception 'الدعوة غير موجودة' using errcode = 'P0001';
  end if;
  if v_share.status <> 'sent' then raise exception 'سبق الرد على هذه الدعوة' using errcode = 'P0001'; end if;
  if v_share.expires_at is not null and v_share.expires_at <= now() then
    raise exception 'انتهت صلاحية الدعوة' using errcode = 'P0001';
  end if;
  if p_accept then
    perform public.register_for_course(v_share.ref_key::uuid);
  end if;
  update public.member_shares
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now(), read_at = coalesce(read_at, now())
   where id = v_share.id;
  insert into public.notifications(recipient_id, kind, title, body, link)
  values (v_share.sender_id, 'share', 'ردّ على دعوتك',
          case when p_accept then 'قُبلت الدعوة' else 'اعتُذر عن الدعوة' end, 'shares');
  return case when p_accept then 'accepted' else 'declined' end;
end $$;

-- ---------- block / report ----------
create function public.block_share_sender(p_share_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_sender uuid;
begin
  if v_user is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  select sender_id into v_sender from public.member_shares where id = p_share_id and recipient_id = v_user;
  if v_sender is null then raise exception 'المشاركة غير موجودة' using errcode = 'P0001'; end if;
  insert into public.member_blocks(blocker_id, blocked_id) values (v_user, v_sender) on conflict do nothing;
  update public.member_shares set archived_at = coalesce(archived_at, now()), read_at = coalesce(read_at, now())
   where recipient_id = v_user and sender_id = v_sender;
  perform private.log_share_event(v_user, 'member_blocked', p_share_id, v_sender, '{}'::jsonb);
end $$;

create function public.unblock_member(p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_target uuid;
begin
  if v_user is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  select user_id into v_target from public.member_share_profiles where username = lower(btrim(coalesce(p_username, '')));
  delete from public.member_blocks where blocker_id = v_user and blocked_id = v_target;
  if v_target is not null then
    perform private.log_share_event(v_user, 'member_unblocked', null, v_target, '{}'::jsonb);
  end if;
end $$;

create function public.list_my_blocks()
returns table (username text, display_name text, blocked_at timestamptz)
language sql security definer set search_path = '' as $$
  select p.username, p.display_name, b.created_at
    from public.member_blocks b
    join public.member_share_profiles p on p.user_id = b.blocked_id
   where b.blocker_id = (select auth.uid())
   order by b.created_at desc;
$$;

create function public.report_share(p_share_id uuid, p_reason text, p_details text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_sender uuid; v_id uuid;
begin
  if v_user is null then raise exception 'تسجيل الدخول مطلوب' using errcode = '42501'; end if;
  if p_reason is null or p_reason not in ('spam','harassment','inappropriate','misinformation','privacy','other') then
    raise exception 'سبب الإبلاغ غير صالح' using errcode = '22023';
  end if;
  if char_length(coalesce(p_details, '')) > 2000 then
    raise exception 'تفاصيل الإبلاغ أطول من 2000 حرف' using errcode = '22023';
  end if;
  select sender_id into v_sender from public.member_shares where id = p_share_id and recipient_id = v_user;
  if v_sender is null then raise exception 'المشاركة غير موجودة' using errcode = 'P0001'; end if;
  if exists (select 1 from public.reports where reporter_id = v_user and target_type = 'share'
              and target_id = p_share_id and status = 'open') then
    raise exception 'لقد أرسلت إبلاغًا مفتوحًا على هذه المشاركة' using errcode = 'P0001';
  end if;
  if (select count(*) from public.reports where reporter_id = v_user and status = 'open') >= 10 then
    raise exception 'لقد وصلت إلى حد الإبلاغات المفتوحة' using errcode = 'P0001';
  end if;
  insert into public.reports(reporter_id, target_type, target_id, reason, details)
  values (v_user, 'share', p_share_id, p_reason, coalesce(p_details, '')) returning id into v_id;
  perform private.log_share_event(v_user, 'share_reported', p_share_id, v_sender, jsonb_build_object('reason', p_reason));
  return v_id;
end $$;

-- ---------- administration ----------
create function public.admin_get_share_settings()
returns table (max_per_day integer, max_per_recipient integer, recipient_window_hours integer,
               max_description_length integer, search_per_hour integer, invitation_ttl_days integer,
               retention_days integer, allowed_types text[])
language sql security definer set search_path = '' as $$
  select s.max_per_day, s.max_per_recipient, s.recipient_window_hours, s.max_description_length,
         s.search_per_hour, s.invitation_ttl_days, s.retention_days, s.allowed_types
    from public.share_settings s where s.id and (select public.is_admin());
$$;

create function public.admin_save_share_settings(
  p_max_per_day integer, p_max_per_recipient integer, p_recipient_window_hours integer,
  p_max_description_length integer, p_search_per_hour integer, p_invitation_ttl_days integer,
  p_retention_days integer, p_allowed_types text[]
) returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := (select auth.uid()); v_before jsonb;
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'صلاحيات إدارة مطلوبة' using errcode = '42501';
  end if;
  select to_jsonb(s) - 'updated_by' - 'updated_at' into v_before from public.share_settings s where s.id;
  begin
    update public.share_settings set max_per_day = p_max_per_day, max_per_recipient = p_max_per_recipient,
      recipient_window_hours = p_recipient_window_hours, max_description_length = p_max_description_length,
      search_per_hour = p_search_per_hour, invitation_ttl_days = p_invitation_ttl_days,
      retention_days = p_retention_days, allowed_types = coalesce(p_allowed_types, '{}'::text[]),
      updated_at = now(), updated_by = v_admin
     where id;
  exception when check_violation or not_null_violation then
    raise exception 'قيم الإعدادات خارج الحدود المسموحة' using errcode = '22023';
  end;
  perform private.log_share_event(v_admin, 'settings_changed', null, null, jsonb_build_object('before', v_before));
end $$;

create function public.admin_set_share_restriction(p_username text, p_restricted boolean,
  p_hours integer default null, p_reason text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := (select auth.uid()); v_target uuid;
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'صلاحيات إدارة مطلوبة' using errcode = '42501';
  end if;
  select user_id into v_target from public.member_share_profiles where username = lower(btrim(coalesce(p_username, '')));
  if v_target is null then raise exception 'اسم المستخدم غير موجود' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_reason, '')) > 500 or (p_hours is not null and p_hours not between 1 and 8760) then
    raise exception 'قيم غير صالحة' using errcode = '22023';
  end if;
  if coalesce(p_restricted, false) then
    insert into public.share_restrictions(user_id, restricted_until, reason, created_by)
    values (v_target, case when p_hours is null then null else now() + make_interval(hours => p_hours) end,
            coalesce(p_reason, ''), v_admin)
    on conflict (user_id) do update set restricted_until = excluded.restricted_until,
      reason = excluded.reason, created_by = excluded.created_by, created_at = now();
  else
    delete from public.share_restrictions where user_id = v_target;
  end if;
  perform private.log_share_event(v_admin, case when coalesce(p_restricted, false) then 'restricted' else 'restriction_lifted' end,
    null, v_target, jsonb_build_object('hours', p_hours, 'reason', coalesce(p_reason, '')));
end $$;

create function public.admin_share_stats()
returns table (total bigint, last_24h bigint, by_type jsonb, blocks bigint, open_reports bigint, restricted bigint)
language sql security definer set search_path = '' as $$
  select (select count(*) from public.member_shares),
         (select count(*) from public.member_shares where created_at > now() - interval '24 hours'),
         coalesce((select jsonb_object_agg(t.share_type, t.n) from
                    (select share_type, count(*) as n from public.member_shares group by share_type) t), '{}'::jsonb),
         (select count(*) from public.member_blocks),
         (select count(*) from public.reports where target_type = 'share' and status = 'open'),
         (select count(*) from public.share_restrictions where restricted_until is null or restricted_until > now())
   where (select public.is_admin());
$$;

create function public.admin_list_share_events(p_limit integer default 50)
returns table (event text, actor_id uuid, target_user_id uuid, share_id uuid, details jsonb, created_at timestamptz)
language sql security definer set search_path = '' as $$
  select e.event, e.actor_id, e.target_user_id, e.share_id, e.details, e.created_at
    from public.share_events e where (select public.is_admin())
   order by e.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

-- Content of a share is visible to administrators only through a report on it,
-- and every view is written to the audit log.
create function public.admin_review_reported_share(p_report_id uuid)
returns table (share_type text, sender_username text, recipient_username text, ref_title text,
               description text, share_status text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := (select auth.uid()); v_share uuid;
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'صلاحيات إدارة مطلوبة' using errcode = '42501';
  end if;
  select r.target_id into v_share from public.reports r where r.id = p_report_id and r.target_type = 'share';
  if v_share is null then raise exception 'لا يوجد إبلاغ على مشاركة بهذا المعرّف' using errcode = 'P0001'; end if;
  perform private.log_share_event(v_admin, 'report_content_viewed', v_share, null, jsonb_build_object('report_id', p_report_id));
  return query
    select s.share_type, sp.username, rp.username, s.ref_title, s.description, s.status, s.created_at
      from public.member_shares s
      left join public.member_share_profiles sp on sp.user_id = s.sender_id
      left join public.member_share_profiles rp on rp.user_id = s.recipient_id
     where s.id = v_share;
end $$;

-- Retention: shares older than share_settings.retention_days are removed for both
-- sides together; hiding or archiving never deletes the other member's record.
create function public.admin_purge_old_shares() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := (select auth.uid()); v_days integer; v_count integer;
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'صلاحيات إدارة مطلوبة' using errcode = '42501';
  end if;
  select retention_days into v_days from public.share_settings where id;
  delete from public.member_shares where created_at < now() - make_interval(days => v_days);
  get diagnostics v_count = row_count;
  perform private.log_share_event(v_admin, 'retention_purge', null, null, jsonb_build_object('deleted', v_count));
  return v_count;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'get_my_share_profile()','save_my_share_profile(text,text,boolean)','check_username_available(text)',
    'search_share_members(text)','get_share_config()',
    'send_member_share(uuid,text,text,text,text,text,text,text)',
    'list_received_shares(boolean,integer)','list_sent_shares(integer)','unread_share_count()',
    'mark_share_read(uuid)','mark_all_shares_read()','archive_share(uuid,boolean)','hide_sent_share(uuid)',
    'respond_share_invitation(uuid,boolean)','block_share_sender(uuid)','unblock_member(text)','list_my_blocks()',
    'report_share(uuid,text,text)','admin_get_share_settings()',
    'admin_save_share_settings(integer,integer,integer,integer,integer,integer,integer,text[])',
    'admin_set_share_restriction(text,boolean,integer,text)','admin_share_stats()',
    'admin_list_share_events(integer)','admin_review_reported_share(uuid)','admin_purge_old_shares()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
