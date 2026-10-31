-- AL_MUDARASA Phase 1: study circles foundation. A mudarasa is a private,
-- member-scoped study group bound to one material and one plan. Nothing here
-- is public: membership is granted only by invitation code plus approval.
-- Patterns follow the proven private-groups migrations (hashed invite codes,
-- SECURITY DEFINER RPCs, member-only RLS via a definer helper).

-- ============ الجداول ============

create table public.study_circles (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text not null default '' check (char_length(description) <= 3000),
  goal text not null default '' check (char_length(goal) <= 2000),
  kind text not null check (kind in ('book','series','lectures','topic')),
  category text not null check (category in ('aqeedah','tafsir','hadith','fiqh','seerah','tazkiyah','other')),
  mode text not null check (mode in ('sync','async','supervised')),
  access text not null default 'approval' check (access in ('invite','approval')),
  status text not null default 'active' check (status in ('active','paused','completed','cancelled')),
  starts_on date,
  ends_on date,
  pace_target integer check (pace_target between 1 and 500),
  pace_unit text not null default '' check (pace_unit in ('','pages','chapters','lessons','minutes')),
  pace_period text not null default '' check (pace_period in ('','daily','weekly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index study_circles_creator_idx on public.study_circles(creator_id, created_at desc);

create table public.study_circle_members (
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('creator','supervisor','teacher','member')),
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);
create index study_circle_members_user_idx on public.study_circle_members(user_id);

-- رمز الدعوة يُخزَّن بصمة SHA-256 فقط؛ لا نص خام في القاعدة (نمط group_invites).
create table public.study_circle_invites (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id),
  status text not null default 'active' check (status in ('active','revoked')),
  expires_at timestamptz not null,
  max_uses integer not null default 10 check (max_uses between 1 and 50),
  uses_count integer not null default 0 check (uses_count between 0 and max_uses),
  created_at timestamptz not null default now()
);
create index study_circle_invites_circle_idx on public.study_circle_invites(circle_id, status);

create table public.study_circle_join_requests (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  note text not null default '' check (char_length(note) <= 500),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index study_join_requests_circle_idx on public.study_circle_join_requests(circle_id, status, created_at desc);
create index study_join_requests_user_idx on public.study_circle_join_requests(user_id, created_at desc);
-- طلب معلّق واحد فقط لكل مستخدم في كل مدارسة.
create unique index one_pending_study_request on public.study_circle_join_requests(circle_id, user_id) where status = 'pending';

create table public.study_materials (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  kind text not null check (kind in ('book','video','audio','pdf','other')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  author text not null default '' check (char_length(author) <= 200),
  url text not null default '' check (char_length(url) <= 1000),
  description text not null default '' check (char_length(description) <= 2000),
  position integer not null default 1 check (position between 1 and 100),
  added_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index study_materials_circle_idx on public.study_materials(circle_id, position);

-- circle_id مُردَّدة من المادة لتسريع سياسات العضوية؛ الحذف يتتال من المادة.
create table public.study_material_parts (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.study_materials(id) on delete cascade,
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  position integer not null check (position between 1 and 500),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  page_start integer check (page_start between 1 and 10000),
  page_end integer check (page_end between 1 and 10000),
  url text not null default '' check (char_length(url) <= 1000),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  check (page_end is null or page_start is null or page_end >= page_start)
);
create index study_material_parts_material_idx on public.study_material_parts(material_id, position);
create index study_material_parts_circle_idx on public.study_material_parts(circle_id);

create table public.study_plan_tasks (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  position integer not null check (position between 1 and 500),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  material_id uuid references public.study_materials(id) on delete set null,
  part_id uuid references public.study_material_parts(id) on delete set null,
  target_date date,
  created_at timestamptz not null default now()
);
create index study_plan_tasks_circle_idx on public.study_plan_tasks(circle_id, position);

-- إنجاز العضو خاص به وحده؛ الإجمالي الجماعي يُجمع عبر RPC بلا أسماء.
create table public.study_task_progress (
  task_id uuid not null references public.study_plan_tasks(id) on delete cascade,
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index study_task_progress_user_idx on public.study_task_progress(user_id);

-- ============ الصلاحيات وRLS ============

alter table public.study_circles enable row level security;
alter table public.study_circle_members enable row level security;
alter table public.study_circle_invites enable row level security;
alter table public.study_circle_join_requests enable row level security;
alter table public.study_materials enable row level security;
alter table public.study_material_parts enable row level security;
alter table public.study_plan_tasks enable row level security;
alter table public.study_task_progress enable row level security;

revoke all on public.study_circles, public.study_circle_members, public.study_circle_invites,
  public.study_circle_join_requests, public.study_materials, public.study_material_parts,
  public.study_plan_tasks, public.study_task_progress
  from public, anon, authenticated;
grant select on public.study_circles, public.study_circle_members, public.study_materials,
  public.study_material_parts, public.study_plan_tasks, public.study_circle_invites to authenticated;
grant select on public.study_circle_join_requests to authenticated;
grant select on public.study_task_progress to authenticated;
grant select, insert, update, delete on public.study_circles, public.study_circle_members,
  public.study_circle_invites, public.study_circle_join_requests, public.study_materials,
  public.study_material_parts, public.study_plan_tasks, public.study_task_progress to service_role;

create schema if not exists private;
grant usage on schema private to authenticated, anon, service_role;

-- التحقق من دور الفاعل في مدارسة (لا تُستدعى من العميل).
create function private.study_role(p_circle_id uuid, p_roles text[])
returns text language sql stable security definer set search_path = '' as $$
  select m.role from public.study_circle_members m
   where m.circle_id = p_circle_id and m.user_id = (select auth.uid())
     and m.role = any(p_roles);
$$;
revoke all on function private.study_role(uuid, text[]) from public, anon, authenticated;
grant execute on function private.study_role(uuid, text[]) to authenticated, service_role;

-- مساعد العضوية (SECURITY DEFINER يمنع تداخل السياسات، بنمط is_group_member).
create function public.is_study_member(target_circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.study_circle_members
    where circle_id = target_circle and user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_study_member(uuid) from public, anon, authenticated;
grant execute on function public.is_study_member(uuid) to authenticated;

create policy study_circle_member_read on public.study_circles for select to authenticated
  using ((select public.is_study_member(id)));
create policy study_member_read on public.study_circle_members for select to authenticated
  using ((select public.is_study_member(circle_id)));
create policy study_material_member_read on public.study_materials for select to authenticated
  using ((select public.is_study_member(circle_id)));
-- الطلبات: المخوّلون يرونها، وصاحب الطلب يرى طلبه.
create policy study_request_staff_read on public.study_circle_join_requests for select to authenticated
  using (exists (select 1 from public.study_circle_members m
    where m.circle_id = study_circle_join_requests.circle_id
      and m.user_id = (select auth.uid()) and m.role in ('creator','supervisor','teacher')));
create policy study_request_own_read on public.study_circle_join_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy study_invite_staff_read on public.study_circle_invites for select to authenticated
  using (private.study_role(circle_id, array['creator','supervisor']) is not null);
create policy study_part_member_read on public.study_material_parts for select to authenticated
  using ((select public.is_study_member(circle_id)));
create policy study_task_member_read on public.study_plan_tasks for select to authenticated
  using ((select public.is_study_member(circle_id)));
-- الإنجاز فردي وخاص: لا يقرؤه إلا صاحبه.
create policy study_progress_own_read on public.study_task_progress for select to authenticated
  using (user_id = (select auth.uid()));

-- توسيع قيد نوع الإشعار ليشمل المدارسة.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('announcement','join_request','join_decision','course','session','report','system','mudarasa'));

-- ============ الوظائف الخادمية ============

create function public.create_study_circle(
  p_title text, p_kind text, p_category text, p_mode text,
  p_description text default '', p_goal text default '',
  p_access text default 'approval',
  p_starts_on date default null, p_ends_on date default null,
  p_pace_target integer default null, p_pace_unit text default '', p_pace_period text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then
    raise exception 'إنشاء المدارسة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 3 and 160
     or p_description is null or p_goal is null
     or char_length(p_description) > 3000 or char_length(p_goal) > 2000 then
    raise exception 'بيانات المدارسة غير صالحة' using errcode = '22023';
  end if;
  if p_kind not in ('book','series','lectures','topic')
     or p_category not in ('aqeedah','tafsir','hadith','fiqh','seerah','tazkiyah','other')
     or p_mode not in ('sync','async','supervised')
     or p_access not in ('invite','approval') then
    raise exception 'نوع المدارسة أو تصنيفها أو طريقة مشاركتها غير صالحة' using errcode = '22023';
  end if;
  if (p_ends_on is not null and p_starts_on is not null and p_ends_on < p_starts_on)
     or (p_pace_target is not null and p_pace_target not between 1 and 500)
     or p_pace_unit not in ('','pages','chapters','lessons','minutes')
     or p_pace_period not in ('','daily','weekly') then
    raise exception 'خطة الدراسة غير صالحة' using errcode = '22023';
  end if;
  -- المدارسة وصف المؤسس تُنشآن معًا؛ الهوية من auth.uid() لا من الوسائط.
  with new_circle as (
    insert into public.study_circles (creator_id, title, description, goal, kind, category, mode, access,
      starts_on, ends_on, pace_target, pace_unit, pace_period)
    values (v_user, btrim(p_title), p_description, p_goal, p_kind, p_category, p_mode, p_access,
      p_starts_on, p_ends_on, p_pace_target, p_pace_unit, p_pace_period)
    returning id
  )
  insert into public.study_circle_members (circle_id, user_id, role)
  select id, v_user, 'creator' from new_circle
  returning circle_id into v_id;
  return v_id;
end $$;

create function public.update_study_circle(
  p_circle_id uuid,
  p_title text default null, p_description text default null, p_goal text default null,
  p_kind text default null, p_category text default null, p_mode text default null, p_access text default null,
  p_starts_on date default null, p_ends_on date default null,
  p_pace_target integer default null, p_pace_unit text default null, p_pace_period text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_row public.study_circles%rowtype;
begin
  if v_user is null then
    raise exception 'التعديل يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_row from public.study_circles where id = p_circle_id for update;
  if not found or v_row.creator_id <> v_user then
    raise exception 'منشئ المدارسة فقط يعدّل بياناتها' using errcode = '42501';
  end if;
  if p_title is not null and (char_length(btrim(p_title)) not between 3 and 160) then
    raise exception 'اسم المدارسة غير صالح' using errcode = '22023';
  end if;
  if p_kind is not null and p_kind not in ('book','series','lectures','topic') then
    raise exception 'نوع غير صالح' using errcode = '22023';
  end if;
  if p_category is not null and p_category not in ('aqeedah','tafsir','hadith','fiqh','seerah','tazkiyah','other') then
    raise exception 'تصنيف غير صالح' using errcode = '22023';
  end if;
  if p_mode is not null and p_mode not in ('sync','async','supervised') then
    raise exception 'طريقة مدارسة غير صالحة' using errcode = '22023';
  end if;
  if p_access is not null and p_access not in ('invite','approval') then
    raise exception 'طريقة مشاركة غير صالحة' using errcode = '22023';
  end if;
  if p_pace_unit is not null and p_pace_unit not in ('','pages','chapters','lessons','minutes') then
    raise exception 'وحدة الإنجاز غير صالحة' using errcode = '22023';
  end if;
  if p_pace_period is not null and p_pace_period not in ('','daily','weekly') then
    raise exception 'دورية الإنجاز غير صالحة' using errcode = '22023';
  end if;
  update public.study_circles set
    title = coalesce(nullif(btrim(p_title), ''), title),
    description = coalesce(p_description, description),
    goal = coalesce(p_goal, goal),
    kind = coalesce(p_kind, kind),
    category = coalesce(p_category, category),
    mode = coalesce(p_mode, mode),
    access = coalesce(p_access, access),
    starts_on = coalesce(p_starts_on, starts_on),
    ends_on = coalesce(p_ends_on, ends_on),
    pace_target = coalesce(p_pace_target, pace_target),
    pace_unit = coalesce(p_pace_unit, pace_unit),
    pace_period = coalesce(p_pace_period, pace_period),
    updated_at = now()
  where id = p_circle_id;
end $$;

create function public.set_study_circle_status(p_circle_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_row public.study_circles%rowtype;
begin
  if v_user is null then
    raise exception 'تغيير الحالة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_status not in ('active','paused','completed','cancelled') then
    raise exception 'حالة غير صالحة' using errcode = '22023';
  end if;
  select * into v_row from public.study_circles where id = p_circle_id for update;
  if not found or v_row.creator_id <> v_user then
    raise exception 'منشئ المدارسة فقط يغيّر حالتها' using errcode = '42501';
  end if;
  update public.study_circles set status = p_status, updated_at = now() where id = p_circle_id;
  if p_status = 'completed' then
    insert into public.notifications (recipient_id, kind, title, body, link)
    select m.user_id, 'mudarasa', 'اكتملت مدارسة: ' || v_row.title,
      'اكتملت المدارسة ويمكنكم مراجعة الخلاصة.', '/study'
    from public.study_circle_members m where m.circle_id = p_circle_id and m.user_id <> v_user;
  end if;
end $$;

-- ============ الدعوات (بصمة SHA-256، لا نص خام) ============

create function public.create_study_invite(p_circle_id uuid, p_ttl_hours integer default 72, p_max_uses integer default 10)
returns text
language plpgsql security definer set search_path = 'public, extensions, pg_catalog' as $$
declare
  v_user uuid := (select auth.uid());
  v_status text;
  v_code text;
  v_attempt integer := 0;
begin
  if v_user is null then
    raise exception 'إصدار الدعوة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_ttl_hours is null or p_ttl_hours not between 1 and 720
     or p_max_uses is null or p_max_uses not between 1 and 50 then
    raise exception 'مدة الدعوة أو عدد استخداماتها غير صالح' using errcode = '22023';
  end if;
  if private.study_role(p_circle_id, array['creator','supervisor']) is null then
    raise exception 'المنشئ أو المشرف فقط يصدر دعوات المدارسة' using errcode = '42501';
  end if;
  select status into v_status from public.study_circles where id = p_circle_id;
  if v_status is null then
    raise exception 'المدارسة غير موجودة' using errcode = 'P0001';
  end if;
  if v_status <> 'active' then
    raise exception 'المدارسة ليست نشطة فلا تصدر دعوات' using errcode = 'P0001';
  end if;
  -- ٢٠ حرفًا من أبجدية بلا ملتبسات؛ ١٢٨ بتًا من العشوائية، والمخزن بصمة فقط.
  loop
    v_attempt := v_attempt + 1;
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '')
      into v_code
      from (select public.gen_random_bytes(20) as b) bytes, generate_series(0, 19) i;
    begin
      insert into public.study_circle_invites (circle_id, token_hash, created_by, expires_at, max_uses)
      values (p_circle_id,
              encode(sha256(convert_to('MUD-' || v_code, 'utf8')), 'hex'),
              v_user, now() + make_interval(hours => p_ttl_hours), p_max_uses);
      return v_code;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'تعذر توليد رمز فريد، أعد المحاولة' using errcode = 'P0001';
      end if;
    end;
  end loop;
end $$;

create function public.revoke_study_invite(p_invite_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'إلغاء الدعوة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  update public.study_circle_invites i set status = 'revoked'
  where i.id = p_invite_id and i.status = 'active'
    and private.study_role(i.circle_id, array['creator','supervisor']) is not null;
  if not found then
    raise exception 'الدعوة غير موجودة أو لا تملك صلاحيتها' using errcode = '42501';
  end if;
end $$;

-- صفحة الدعوة العامة: بيانات محدودة فقط، بلا أعضاء ولا مواد.
create function public.resolve_study_invite(p_code text)
returns jsonb
language plpgsql security definer set search_path = 'public, extensions, pg_catalog' as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_row record;
begin
  if v_code !~ '^[A-HJ-NP-Z2-9]{20}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select i.status, i.expires_at, i.max_uses, i.uses_count,
         c.id, c.title, c.kind, c.category, c.mode, c.starts_on, c.ends_on,
         c.pace_target, c.pace_unit, c.pace_period, c.status as circle_status
    into v_row
    from public.study_circle_invites i
    join public.study_circles c on c.id = i.circle_id
   where i.token_hash = encode(sha256(convert_to('MUD-' || v_code, 'utf8')), 'hex')
   limit 1;
  if not found
    or v_row.status <> 'active' or v_row.circle_status <> 'active'
    or v_row.expires_at < now() or v_row.uses_count >= v_row.max_uses then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object('status', 'valid', 'circle', jsonb_build_object(
    'id', v_row.id, 'title', v_row.title, 'kind', v_row.kind, 'category', v_row.category,
    'mode', v_row.mode, 'starts_on', v_row.starts_on, 'ends_on', v_row.ends_on,
    'pace_target', v_row.pace_target, 'pace_unit', v_row.pace_unit, 'pace_period', v_row.pace_period,
    'member_count', (select count(*)::int from public.study_circle_members where circle_id = v_row.id)));
end $$;

-- طلب الانضمام برمز الدعوة: الرابط لا يمنح عضوية؛ القرار للمخوّل.
create function public.request_study_join(p_code text, p_note text default '')
returns uuid
language plpgsql security definer set search_path = 'public, extensions, pg_catalog' as $$
declare
  v_user uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_row record;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'طلب الانضمام يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'ملاحظة الطلب أطول من 500 حرف' using errcode = '22023';
  end if;
  if v_code !~ '^[A-HJ-NP-Z2-9]{20}$' then
    raise exception 'رمز الدعوة غير صالح' using errcode = '22023';
  end if;
  select i.id as invite_id, i.status, i.expires_at, i.max_uses, i.uses_count, c.id as circle_id, c.title
    into v_row
    from public.study_circle_invites i
    join public.study_circles c on c.id = i.circle_id
   where i.token_hash = encode(sha256(convert_to('MUD-' || v_code, 'utf8')), 'hex')
   limit 1;
  if not found or v_row.status <> 'active' or v_row.expires_at < now()
     or v_row.uses_count >= v_row.max_uses then
    raise exception 'رابط الدعوة غير صالح أو منتهٍ' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.study_circle_members where circle_id = v_row.circle_id and user_id = v_user) then
    raise exception 'أنت عضو في هذه المدارسة بالفعل' using errcode = 'P0001';
  end if;
  insert into public.study_circle_join_requests (circle_id, user_id, note)
  values (v_row.circle_id, v_user, coalesce(p_note, ''))
  returning id into v_id;
  -- إشعار المنشئ بطلب جديد.
  insert into public.notifications (recipient_id, kind, title, body, link)
  select c.creator_id, 'mudarasa', 'طلب انضمام إلى: ' || c.title,
    'وصلك طلب انضمام جديد إلى المدارسة، راجعه من صفحة المدارسة.', '/study'
  from public.study_circles c where c.id = v_row.circle_id;
  return v_id;
end $$;

create function public.decide_study_join_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_req public.study_circle_join_requests%rowtype;
  v_circle public.study_circles%rowtype;
  v_invite public.study_circle_invites%rowtype;
begin
  if v_user is null then
    raise exception 'القرار يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_req from public.study_circle_join_requests where id = p_request_id for update;
  if not found then
    raise exception 'الطلب غير موجود' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'البث في هذا الطلب انتهى' using errcode = 'P0001';
  end if;
  select * into v_circle from public.study_circles where id = v_req.circle_id;
  if v_circle.creator_id <> v_user
     and private.study_role(v_req.circle_id, array['supervisor']) is null then
    raise exception 'المنشئ أو المشرف فقط يبتّ في طلبات الانضمام' using errcode = '42501';
  end if;
  update public.study_circle_join_requests
     set status = (case when p_approve then 'accepted' else 'rejected' end),
         decided_by = v_user, decided_at = now()
   where id = p_request_id;
  if p_approve then
    insert into public.study_circle_members (circle_id, user_id, role)
    values (v_req.circle_id, v_req.user_id, 'member')
    on conflict (circle_id, user_id) do nothing;
    -- الاستخدام يُحسب عند القبول لا عند الطلب، فالرفض لا يستهلك الدعوة.
    update public.study_circle_invites i
       set uses_count = uses_count + 1
     where i.circle_id = v_req.circle_id and i.status = 'active'
       and i.uses_count < i.max_uses
       and exists (select 1 from public.study_circle_join_requests r
                    where r.id = p_request_id and r.user_id = v_req.user_id);
  end if;
  insert into public.notifications (recipient_id, kind, title, body, link)
  values (v_req.user_id, 'mudarasa',
          (case when p_approve then 'قُبل انضمامك إلى: ' else 'رُفض طلب الانضمام إلى: ' end) || v_circle.title,
          (case when p_approve then 'يمكنك الآن متابعة المادة والخطة مع الأعضاء.' else 'لم يُقبل طلبك هذه المرة.' end),
          '/study');
end $$;

-- ============ الأعضاء والأدوار ============

create function public.list_study_members(p_circle_id uuid)
returns table (member_id uuid, member_role text, joined_at timestamptz)
language sql security definer set search_path = '' as $$
  select m.user_id, m.role, m.joined_at
    from public.study_circle_members m
   where m.circle_id = p_circle_id
     and (select public.is_study_member(p_circle_id))
   order by m.joined_at;
$$;

create function public.remove_study_member(p_circle_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_circle public.study_circles%rowtype;
begin
  if v_user is null then
    raise exception 'إزالة عضو تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_circle from public.study_circles where id = p_circle_id;
  if not found then
    raise exception 'المدارسة غير موجودة' using errcode = 'P0001';
  end if;
  if v_circle.creator_id <> v_user then
    raise exception 'المنشئ فقط يزيل الأعضاء' using errcode = '42501';
  end if;
  if p_user_id = v_circle.creator_id then
    raise exception 'لا تُزال عضوية المنشئ؛ أغلق المدارسة إن أردت إنهاءها' using errcode = 'P0001';
  end if;
  delete from public.study_circle_members where circle_id = p_circle_id and user_id = p_user_id;
  if not found then
    raise exception 'العضو غير موجود في المدارسة' using errcode = 'P0001';
  end if;
end $$;

create function public.leave_study_circle(p_circle_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_circle public.study_circles%rowtype;
begin
  if v_user is null then
    raise exception 'المغادرة تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_circle from public.study_circles where id = p_circle_id;
  if not found then
    raise exception 'المدارسة غير موجودة' using errcode = 'P0001';
  end if;
  if v_circle.creator_id = v_user then
    raise exception 'المنشئ لا يغادر مدارسته؛ يمكنه إيقافها أو إكمالها' using errcode = 'P0001';
  end if;
  delete from public.study_circle_members where circle_id = p_circle_id and user_id = v_user;
  if not found then
    raise exception 'لست عضوًا في هذه المدارسة' using errcode = 'P0001';
  end if;
end $$;

-- إسناد الأدوار: المنشئ وحده، ودور المعلم لا يُمنح إلا لمعتمد.
create function public.assign_study_role(p_circle_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_circle public.study_circles%rowtype;
begin
  if v_user is null then
    raise exception 'إسناد الدور يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_role not in ('supervisor','teacher','member') then
    raise exception 'دور غير صالح' using errcode = '22023';
  end if;
  select * into v_circle from public.study_circles where id = p_circle_id for update;
  if not found or v_circle.creator_id <> v_user then
    raise exception 'المنشئ فقط يُسند الأدوار' using errcode = '42501';
  end if;
  if p_user_id = v_circle.creator_id then
    raise exception 'دور المنشئ ثابت' using errcode = 'P0001';
  end if;
  if p_role = 'teacher' then
    if not exists (
      select 1 from public.teacher_applications t
       where t.user_id = p_user_id and t.status = 'approved'
         and t.identity_status = 'approved'
         and t.qualification_status = 'approved'
         and t.endorsement_status = 'approved'
    ) then
      raise exception 'دور المعلم يُسند فقط لمعلم معتمد في المنصة' using errcode = '42501';
    end if;
    if not exists (select 1 from public.study_circle_members where circle_id = p_circle_id and user_id = p_user_id) then
      insert into public.study_circle_members (circle_id, user_id, role)
      values (p_circle_id, p_user_id, 'member');
    end if;
  else
    if not exists (select 1 from public.study_circle_members where circle_id = p_circle_id and user_id = p_user_id) then
      raise exception 'المستهدف ليس عضوًا في المدارسة' using errcode = '42501';
    end if;
  end if;
  update public.study_circle_members set role = p_role
   where circle_id = p_circle_id and user_id = p_user_id;
  insert into public.notifications (recipient_id, kind, title, body, link)
  values (p_user_id, 'mudarasa', 'تحديث دورك في مدارسة: ' || v_circle.title,
    'دورك الآن في المدارسة: ' || p_role, '/study');
end $$;

-- ============ المواد وأجزاؤها ============

create function public.add_study_material(p_circle_id uuid, p_kind text, p_title text,
  p_author text default '', p_url text default '', p_description text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_status text;
  v_pos integer;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'إضافة مادة تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_kind not in ('book','video','audio','pdf','other')
     or p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or char_length(coalesce(p_author,'')) > 200
     or char_length(coalesce(p_url,'')) > 1000
     or char_length(coalesce(p_description,'')) > 2000 then
    raise exception 'بيانات المادة غير صالحة' using errcode = '22023';
  end if;
  if private.study_role(p_circle_id, array['creator','supervisor','teacher']) is null then
    raise exception 'إضافة المادة للمنشئ أو المشرف أو المعلم' using errcode = '42501';
  end if;
  select status into v_status from public.study_circles where id = p_circle_id;
  if v_status is null then
    raise exception 'المدارسة غير موجودة' using errcode = 'P0001';
  end if;
  if v_status <> 'active' then
    raise exception 'المدارسة ليست نشطة' using errcode = 'P0001';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.study_materials where circle_id = p_circle_id;
  insert into public.study_materials (circle_id, kind, title, author, url, description, position, added_by)
  values (p_circle_id, p_kind, btrim(p_title), coalesce(p_author,''), coalesce(p_url,''), coalesce(p_description,''), v_pos, v_user)
  returning id into v_id;
  -- إشعار الأعضاء بمادة جديدة.
  insert into public.notifications (recipient_id, kind, title, body, link)
  select m.user_id, 'mudarasa', 'مادة جديدة في: ' || c.title, btrim(p_title), '/study'
  from public.study_circle_members m join public.study_circles c on c.id = m.circle_id
  where m.circle_id = p_circle_id and m.user_id <> v_user;
  return v_id;
end $$;

create function public.remove_study_material(p_material_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_mat public.study_materials%rowtype;
begin
  if v_user is null then
    raise exception 'حذف المادة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_mat from public.study_materials where id = p_material_id;
  if not found then
    raise exception 'المادة غير موجودة' using errcode = 'P0001';
  end if;
  if private.study_role(v_mat.circle_id, array['creator','supervisor','teacher']) is null then
    raise exception 'حذف المادة للمنشئ أو المشرف أو المعلم' using errcode = '42501';
  end if;
  delete from public.study_materials where id = p_material_id;
end $$;

create function public.add_study_part(p_material_id uuid, p_title text,
  p_page_start integer, p_page_end integer, p_url text, p_is_required boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_mat public.study_materials%rowtype;
  v_pos integer;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'إضافة جزء يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_mat from public.study_materials where id = p_material_id;
  if not found then
    raise exception 'المادة غير موجودة' using errcode = 'P0001';
  end if;
  if private.study_role(v_mat.circle_id, array['creator','supervisor','teacher']) is null then
    raise exception 'إضافة الأجزاء للمنشئ أو المشرف أو المعلم' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or (p_page_start is not null and p_page_start not between 1 and 10000)
     or (p_page_end is not null and p_page_end not between 1 and 10000)
     or (p_page_start is not null and p_page_end is not null and p_page_end < p_page_start)
     or char_length(coalesce(p_url,'')) > 1000 then
    raise exception 'بيانات الجزء غير صالحة' using errcode = '22023';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.study_material_parts where material_id = p_material_id;
  insert into public.study_material_parts (material_id, circle_id, position, title, page_start, page_end, url, is_required)
  values (p_material_id, v_mat.circle_id, v_pos, btrim(p_title), p_page_start, p_page_end, coalesce(p_url,''), coalesce(p_is_required, true))
  returning id into v_id;
  return v_id;
end $$;

-- ============ خطة الدراسة والإنجاز ============

-- upsert بالموضع لا delete-all: تعديل الخطة لا يمحو سجلات الإنجاز.
create function public.set_study_plan(p_circle_id uuid, p_tasks jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_task jsonb;
  v_position integer := 0;
  v_existing uuid;
  v_material public.study_materials%rowtype;
begin
  if v_user is null then
    raise exception 'تعديل الخطة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if private.study_role(p_circle_id, array['creator','supervisor']) is null then
    raise exception 'خطة الدراسة للمنشئ أو المشرف' using errcode = '42501';
  end if;
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array'
     or jsonb_array_length(p_tasks) not between 1 and 500 then
    raise exception 'قائمة مهام الخطة غير صالحة' using errcode = '22023';
  end if;
  for v_task in select value from jsonb_array_elements(p_tasks) loop
    v_position := v_position + 1;
    if v_task->>'title' is null or char_length(btrim(v_task->>'title')) not between 1 and 200 then
      raise exception 'مهمة خطة غير صالحة' using errcode = '22023';
    end if;
    select id into v_existing from public.study_plan_tasks
     where circle_id = p_circle_id and position = v_position;
    if v_existing is not null then
      update public.study_plan_tasks set
        title = btrim(v_task->>'title'),
        material_id = (v_task->>'material_id')::uuid,
        part_id = (v_task->>'part_id')::uuid,
        target_date = (v_task->>'target_date')::date
      where id = v_existing;
    else
      insert into public.study_plan_tasks (circle_id, position, title, material_id, part_id, target_date)
      values (p_circle_id, v_position, btrim(v_task->>'title'),
              (v_task->>'material_id')::uuid, (v_task->>'part_id')::uuid, (v_task->>'target_date')::date);
    end if;
  end loop;
  return v_position;
end $$;

create function public.mark_study_task(p_task_id uuid, p_done boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_task public.study_plan_tasks%rowtype;
begin
  if v_user is null then
    raise exception 'تسجيل الإنجاز يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_task from public.study_plan_tasks where id = p_task_id;
  if not found then
    raise exception 'مهمة الخطة غير موجودة' using errcode = 'P0001';
  end if;
  if not public.is_study_member(v_task.circle_id) then
    raise exception 'تسجيل الإنجاز لأعضاء المدارسة فقط' using errcode = '42501';
  end if;
  if p_done then
    insert into public.study_task_progress (task_id, circle_id, user_id)
    values (p_task_id, v_task.circle_id, v_user)
    on conflict (task_id, user_id) do nothing;
  else
    delete from public.study_task_progress where task_id = p_task_id and user_id = v_user;
  end if;
end $$;

-- ملخص التقدم: إنجازي الشخصي + إجمالي جماعي مجهول الاسم (بلا أسماء ولا ترتيب).
create function public.study_progress_summary(p_circle_id uuid)
returns table (total_tasks bigint, my_completed bigint, members_count bigint, group_completed bigint)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*) from public.study_plan_tasks where circle_id = p_circle_id),
    (select count(*) from public.study_task_progress where circle_id = p_circle_id and user_id = (select auth.uid())),
    (select count(*) from public.study_circle_members where circle_id = p_circle_id),
    (select count(*) from public.study_task_progress where circle_id = p_circle_id)
  where (select public.is_study_member(p_circle_id));
$$;

-- ============ المنح ============

revoke all on function public.create_study_circle(text, text, text, text, text, text, text, date, date, integer, text, text) from public, anon, authenticated;
revoke all on function public.update_study_circle(uuid, text, text, text, text, text, text, text, date, date, integer, text, text) from public, anon, authenticated;
revoke all on function public.set_study_circle_status(uuid, text) from public, anon, authenticated;
revoke all on function public.create_study_invite(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.revoke_study_invite(uuid) from public, anon, authenticated;
revoke all on function public.resolve_study_invite(text) from public, anon, authenticated;
revoke all on function public.request_study_join(text, text) from public, anon, authenticated;
revoke all on function public.decide_study_join_request(uuid, boolean) from public, anon, authenticated;
revoke all on function public.list_study_members(uuid) from public, anon, authenticated;
revoke all on function public.remove_study_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_study_circle(uuid) from public, anon, authenticated;
revoke all on function public.assign_study_role(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.add_study_material(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.remove_study_material(uuid) from public, anon, authenticated;
revoke all on function public.add_study_part(uuid, text, integer, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.set_study_plan(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mark_study_task(uuid, boolean) from public, anon, authenticated;
revoke all on function public.study_progress_summary(uuid) from public, anon, authenticated;

grant execute on function public.create_study_circle(text, text, text, text, text, text, text, date, date, integer, text, text) to authenticated;
grant execute on function public.update_study_circle(uuid, text, text, text, text, text, text, text, date, date, integer, text, text) to authenticated;
grant execute on function public.set_study_circle_status(uuid, text) to authenticated;
grant execute on function public.create_study_invite(uuid, integer, integer) to authenticated;
grant execute on function public.revoke_study_invite(uuid) to authenticated;
grant execute on function public.resolve_study_invite(text) to anon, authenticated;
grant execute on function public.request_study_join(text, text) to authenticated;
grant execute on function public.decide_study_join_request(uuid, boolean) to authenticated;
grant execute on function public.list_study_members(uuid) to authenticated;
grant execute on function public.remove_study_member(uuid, uuid) to authenticated;
grant execute on function public.leave_study_circle(uuid) to authenticated;
grant execute on function public.assign_study_role(uuid, uuid, text) to authenticated;
grant execute on function public.add_study_material(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.remove_study_material(uuid) to authenticated;
grant execute on function public.add_study_part(uuid, text, integer, integer, text, boolean) to authenticated;
grant execute on function public.set_study_plan(uuid, jsonb) to authenticated;
grant execute on function public.mark_study_task(uuid, boolean) to authenticated;
grant execute on function public.study_progress_summary(uuid) to authenticated;
