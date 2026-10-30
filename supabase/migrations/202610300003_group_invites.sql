-- TAW-003: random invite links for private circles. The raw code is shown to the
-- founder once; the table stores only its SHA-256 fingerprint, so a database leak
-- cannot mint usable links. Links expire, carry a use cap, and can be revoked;
-- redemption (membership requests) is TAW-004. Direct table access stays denied.
create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id),
  status text not null default 'active' check (status in ('active','revoked')),
  expires_at timestamptz not null,
  max_uses integer not null default 10 check (max_uses between 1 and 50),
  uses_count integer not null default 0 check (uses_count between 0 and max_uses),
  created_at timestamptz not null default now()
);
create index group_invites_group_idx on public.group_invites(group_id, status);

alter table public.group_invites enable row level security;
revoke all on public.group_invites from public, anon, authenticated;
grant select, insert, update, delete on public.group_invites to service_role;
-- No policies on purpose: only the narrowly scoped functions below touch this table.
-- The random bytes live in pgcrypto: `public` on plain Postgres, `extensions` on
-- Supabase; the fixed search path below covers both without accepting untrusted paths.

create function public.create_group_invite(p_group_id uuid, p_ttl_hours integer default 72, p_max_uses integer default 10)
returns text
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  v_user uuid := (select auth.uid());
  v_status text;
  v_code text;
  v_attempt integer := 0;
begin
  if v_user is null then
    raise exception 'إصدار دعوة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_ttl_hours is null or p_ttl_hours not between 1 and 720 then
    raise exception 'مدة صلاحية الرابط يجب أن تكون بين ساعة و720 ساعة' using errcode = '22023';
  end if;
  if p_max_uses is null or p_max_uses not between 1 and 50 then
    raise exception 'عدد استخدامات الرابط يجب أن يكون بين 1 و50' using errcode = '22023';
  end if;
  select g.status into v_status
    from public.study_groups g
    join public.group_members m on m.group_id = g.id and m.user_id = v_user and m.role = 'founder'
   where g.id = p_group_id and g.founder_id = v_user;
  if not found then
    raise exception 'المؤسس فقط يصدر روابط الدعوة' using errcode = '42501';
  end if;
  if v_status = 'closed' then
    raise exception 'الحلقة مغلقة ولا تصدر دعوات' using errcode = 'P0001';
  end if;
  -- 20 letters from a 31-character alphabet without 0/O/1/I/L; 99 bits of entropy far beyond
  -- sequential guessing, and the stored value is only the hashed fingerprint.
  loop
    v_attempt := v_attempt + 1;
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '')
      into v_code
      from (select gen_random_bytes(20) as b) bytes, generate_series(0, 19) i;
    begin
      insert into public.group_invites (group_id, token_hash, created_by, expires_at, max_uses)
      values (p_group_id,
              encode(sha256(convert_to('RBYI-' || v_code, 'utf8')), 'hex'),
              v_user, now() + make_interval(hours => p_ttl_hours), p_max_uses);
      return v_code;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'تعذر توليد رمز فريد، أعد المحاولة' using errcode = 'P0001';
      end if;
    end;
  end loop;
end $$;

create function public.list_group_invites(p_group_id uuid)
returns table (invite_id uuid, invite_status text, invite_expires_at timestamptz,
               invite_max_uses integer, invite_uses_count integer, invite_created_at timestamptz)
language sql security definer set search_path = public, extensions, pg_catalog as $$
  select i.id, i.status, i.expires_at, i.max_uses, i.uses_count, i.created_at
    from public.group_invites i
    join public.study_groups g on g.id = i.group_id
    join public.group_members m on m.group_id = g.id and m.user_id = (select auth.uid()) and m.role = 'founder'
   where i.group_id = p_group_id and g.founder_id = (select auth.uid())
   order by i.created_at desc;
$$;

create function public.revoke_group_invite(p_invite_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'إلغاء الدعوة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  -- Founder-only by construction: the join filters on both the founder member row
  -- and the group owner; anything else lands in «not found».
  update public.group_invites i set status = 'revoked'
   where i.id = p_invite_id and i.status = 'active'
     and exists (
       select 1 from public.study_groups g
         join public.group_members m on m.group_id = g.id and m.user_id = v_user and m.role = 'founder'
        where g.id = i.group_id and g.founder_id = v_user);
  if not found then
    if exists (
      select 1 from public.group_invites i
        join public.study_groups g on g.id = i.group_id
        join public.group_members m on m.group_id = g.id and m.user_id = v_user and m.role = 'founder'
       where i.id = p_invite_id and i.status = 'revoked' and g.founder_id = v_user
    ) then
      return;
    end if;
    raise exception 'المؤسس فقط يلغي روابط دعوة حلقاته' using errcode = '42501';
  end if;
end $$;

-- أخف بيانات صفحة الدعوة: اسم الدائرة ونوعها وهدفها وعدد أماكنها وتواريخها فقط.
-- لا أعضاء ولا سجلات هنا؛ الطلب والقبول في TAW-004.
create function public.resolve_group_invite(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_row record;
begin
  if v_code !~ '^[A-HJ-NP-Z2-9]{20}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select i.status, i.expires_at, i.max_uses, i.uses_count,
         g.id, g.status as group_status, g.name, g.kind, g.goal,
         g.starts_on, g.ends_on, g.member_limit
    into v_row
    from public.group_invites i
    join public.study_groups g on g.id = i.group_id
   where i.token_hash = encode(sha256(convert_to('RBYI-' || v_code, 'utf8')), 'hex')
   limit 1;
  if not found
    or v_row.status <> 'active' or v_row.group_status <> 'active'
    or v_row.expires_at < now() or v_row.uses_count >= v_row.max_uses then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object('status', 'valid', 'group', jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'kind', v_row.kind,
    'goal', v_row.goal,
    'starts_on', v_row.starts_on,
    'ends_on', v_row.ends_on,
    'member_limit', v_row.member_limit,
    'member_count', (select count(*)::int from public.group_members where group_id = v_row.id)));
end $$;

revoke all on function public.create_group_invite(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.list_group_invites(uuid) from public, anon, authenticated;
revoke all on function public.revoke_group_invite(uuid) from public, anon, authenticated;
revoke all on function public.resolve_group_invite(text) from public, anon, authenticated;
grant execute on function public.create_group_invite(uuid, integer, integer) to authenticated;
grant execute on function public.list_group_invites(uuid) to authenticated;
grant execute on function public.revoke_group_invite(uuid) to authenticated;
grant execute on function public.resolve_group_invite(text) to anon, authenticated;
