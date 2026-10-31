create or replace function public.create_study_invite(p_circle_id uuid, p_ttl_hours integer default 72, p_max_uses integer default 10)
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
  loop
    v_attempt := v_attempt + 1;
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '')
      into v_code
      from (select extensions.gen_random_bytes(20) as b) bytes, generate_series(0, 19) i;
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
