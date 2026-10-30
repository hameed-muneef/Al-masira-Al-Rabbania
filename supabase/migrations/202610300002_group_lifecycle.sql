-- TAW-002: private circle lifecycle. Groups are created, edited and closed only
-- through these narrowly scoped server operations; direct browser writes remain
-- denied by grants from the foundation migration. Editing requires the founder
-- role on the server, and a closed circle becomes read-only for everyone.

create function private.validate_group_fields(p_kind text, p_member_limit integer, p_starts_on date, p_ends_on date)
returns void language plpgsql as $$
begin
  if p_kind is not null and p_kind not in ('friends','book','quran','mentoring','course','program') then
    raise exception 'نوع الحلقة غير معروف' using errcode = '22023';
  end if;
  if p_member_limit is not null and p_member_limit not between 2 and 100 then
    raise exception 'سعة الحلقة يجب أن تكون بين 2 و100' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_starts_on is not null and p_ends_on < p_starts_on then
    raise exception 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساويًا له' using errcode = '22023';
  end if;
end $$;
revoke all on function private.validate_group_fields(text, integer, date, date) from public, anon, authenticated;

-- Kind is checked in TAW-001 only as a set; keep long free-text fields bounded at
-- the table so future maintenance tools cannot store unbounded payloads.
alter table public.study_groups
  add constraint description_len check (char_length(description) <= 2000),
  add constraint goal_len check (char_length(goal) <= 2000),
  add constraint participation_rules_len check (char_length(participation_rules) <= 2000);

create function public.create_group(
  p_name text,
  p_kind text,
  p_description text default '',
  p_goal text default '',
  p_participation_rules text default '',
  p_member_limit integer default 12,
  p_starts_on date default null,
  p_ends_on date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_founder uuid := (select auth.uid());
  v_name text := p_name;
  v_description text := coalesce(p_description, '');
  v_goal text := coalesce(p_goal, '');
  v_rules text := coalesce(p_participation_rules, '');
  v_limit integer := coalesce(p_member_limit, 12);
  v_new_group uuid;
begin
  -- Identity comes from auth.uid(); arguments never choose the founder.
  if v_founder is null then
    raise exception 'إنشاء الحلقة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'اسم الحلقة مطلوب' using errcode = '22023';
  end if;
  v_name := btrim(v_name);
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'اسم الحلقة يجب أن يكون بين 1 و120 حرفًا' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('friends','book','quran','mentoring','course','program') then
    raise exception 'اختر نوع الحلقة' using errcode = '22023';
  end if;
  if char_length(v_description) > 2000 or char_length(v_goal) > 2000 or char_length(v_rules) > 2000 then
    raise exception 'أحد الحقول تجاوز الحد المسموح' using errcode = '22023';
  end if;
  perform private.validate_group_fields(p_kind, v_limit, p_starts_on, p_ends_on);
  -- One statement keeps the group row and the founder roster entry atomic.
  with new_group as (
    insert into public.study_groups
      (founder_id, name, description, goal, kind, member_limit, starts_on, ends_on, participation_rules)
    values
      (v_founder, v_name, v_description, v_goal, p_kind, v_limit, p_starts_on, p_ends_on, v_rules)
    returning id
  )
  insert into public.group_members (group_id, user_id, role)
  select id, v_founder, 'founder' from new_group
  returning group_id into v_new_group;
  return v_new_group;
end $$;

create function public.update_group(
  p_group_id uuid,
  p_name text default null,
  p_kind text default null,
  p_description text default null,
  p_goal text default null,
  p_participation_rules text default null,
  p_member_limit integer default null,
  p_starts_on date default null,
  p_ends_on date default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_founder uuid := (select auth.uid());
  v_kind text;
  v_limit integer;
  v_starts date;
  v_ends date;
  v_status text;
  v_name text;
begin
  if v_founder is null then
    raise exception 'تعديل الحلقة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  -- The caller must be the founder member of this exact group.
  select g.status into v_status
    from public.study_groups g
    join public.group_members m on m.group_id = g.id and m.user_id = v_founder
   where g.id = p_group_id and g.founder_id = v_founder and m.role = 'founder';
  if not found then
    raise exception 'المؤسس فقط يعدّل بيانات الحلقة' using errcode = '42501';
  end if;
  if v_status = 'closed' then
    raise exception 'الحلقة مغلقة، ولا يمكن تعديل بياناتها' using errcode = 'P0001';
  end if;
  -- Stored row first, then merge provided fields over it for validation.
  select name, kind, member_limit, starts_on, ends_on
    into v_name, v_kind, v_limit, v_starts, v_ends
    from public.study_groups where id = p_group_id;
  v_name := coalesce(btrim(p_name), v_name);
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'اسم الحلقة يجب أن يكون بين 1 و120 حرفًا' using errcode = '22023';
  end if;
  if length(coalesce(p_description,'')) > 2000
    or length(coalesce(p_goal,'')) > 2000
    or length(coalesce(p_participation_rules,'')) > 2000 then
    raise exception 'أحد الحقول تجاوز الحد المسموح' using errcode = '22023';
  end if;
  -- Effective values combine provided fields with the stored row for validation.
  select coalesce(btrim(p_kind), g.kind),
         coalesce(p_member_limit, g.member_limit),
         coalesce(p_starts_on, g.starts_on),
         coalesce(p_ends_on, g.ends_on)
    into v_kind, v_limit, v_starts, v_ends
    from public.study_groups g where g.id = p_group_id;
  perform private.validate_group_fields(v_kind, v_limit, v_starts, v_ends);
  update public.study_groups g set
    name = coalesce(v_name, g.name),
    kind = coalesce(btrim(p_kind), g.kind),
    description = coalesce(p_description, g.description),
    goal = coalesce(p_goal, g.goal),
    participation_rules = coalesce(p_participation_rules, g.participation_rules),
    member_limit = coalesce(p_member_limit, g.member_limit),
    starts_on = coalesce(p_starts_on, g.starts_on),
    ends_on = coalesce(p_ends_on, g.ends_on)
   where g.id = p_group_id and g.founder_id = v_founder;
end $$;

create function public.close_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_founder uuid := (select auth.uid());
begin
  if v_founder is null then
    raise exception 'إغلاق الحلقة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  -- Founders only; closing is idempotent for an already closed circle. There is
  -- no reopen operation; a live circle becomes a new one through creation.
  update public.study_groups g set status = 'closed'
   where g.id = p_group_id and g.founder_id = v_founder and g.status = 'active';
  if not found then
    if exists (
      select 1 from public.study_groups g
        join public.group_members m on m.group_id = g.id and m.user_id = v_founder
       where g.id = p_group_id and g.founder_id = v_founder and m.role = 'founder'
         and g.status = 'closed'
    ) then
      return; -- already closed by the founder; no-op keeps repeat clicks safe.
    end if;
    raise exception 'المؤسس فقط يغلق الحلقة' using errcode = '42501';
  end if;
end $$;

revoke all on function public.create_group(text, text, text, text, text, integer, date, date)
  from public, anon, authenticated;
revoke all on function public.update_group(uuid, text, text, text, text, text, integer, date, date)
  from public, anon, authenticated;
revoke all on function public.close_group(uuid) from public, anon, authenticated;

grant execute on function public.create_group(text, text, text, text, text, integer, date, date) to authenticated;
grant execute on function public.update_group(uuid, text, text, text, text, text, integer, date, date) to authenticated;
grant execute on function public.close_group(uuid) to authenticated;
