-- REL-001: user reports for abuse/safety without exposing private circle details.
-- A report is a structured notice to platform admins; it never grants them read
-- access to the reported circle's members or content beyond the reported target.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('course','circle','teacher','lesson')),
  target_id uuid not null,
  reason text not null check (reason in ('spam','harassment','inappropriate','misinformation','privacy','other')),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open','reviewed','dismissed','actioned')),
  admin_note text not null default '' check (char_length(admin_note) <= 2000),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_status_idx on public.reports(status, created_at desc);
create index reports_reporter_idx on public.reports(reporter_id, created_at desc);
create index reports_target_idx on public.reports(target_type, target_id);

alter table public.reports enable row level security;
revoke all on public.reports from public, anon, authenticated;
grant select, insert, update, delete on public.reports to service_role;
grant select on public.reports to authenticated;
-- Reporters see their own; administrators see all. Writes only through RPCs.
create policy own_report_read on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));
create policy admin_report_read on public.reports for select to authenticated
  using ((select public.is_admin()));

create function public.submit_report(p_target_type text, p_target_id uuid, p_reason text, p_details text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_open_count integer;
begin
  if v_user is null then
    raise exception 'الإبلاغ يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_target_type is null or p_target_type not in ('course','circle','teacher','lesson') then
    raise exception 'نوع الهدف غير صالح' using errcode = '22023';
  end if;
  if p_target_id is null then
    raise exception 'هدف الإبلاغ مطلوب' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('spam','harassment','inappropriate','misinformation','privacy','other') then
    raise exception 'سبب الإبلاغ غير صالح' using errcode = '22023';
  end if;
  if char_length(coalesce(p_details,'')) > 2000 then
    raise exception 'تفاصيل الإبلاغ أطول من 2000 حرف' using errcode = '22023';
  end if;
  -- Soft rate limit: at most 10 open reports per user.
  select count(*) into v_open_count from public.reports
    where reporter_id = v_user and status = 'open';
  if v_open_count >= 10 then
    raise exception 'لقد وصلت إلى حد الإبلاغات المفتوحة' using errcode = 'P0001';
  end if;
  -- Prevent duplicate open reports on the same target by the same user.
  if exists (select 1 from public.reports
              where reporter_id = v_user and target_type = p_target_type
                and target_id = p_target_id and status = 'open') then
    raise exception 'لقد أرسلت إبلاغًا مفتوحًا على هذا الهدف' using errcode = 'P0001';
  end if;
  insert into public.reports (reporter_id, target_type, target_id, reason, details)
    values (v_user, p_target_type, p_target_id, p_reason, coalesce(p_details,''))
    returning id into v_id;
  return v_id;
end $$;

create function public.list_reports(p_status text default null)
returns table (report_id uuid, reporter_id uuid, target_type text, target_id uuid,
               reason text, details text, report_status text, admin_note text,
               reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz)
language sql security definer set search_path = '' as $$
  select r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.details,
         r.status, r.admin_note, r.reviewed_by, r.reviewed_at, r.created_at
    from public.reports r
   where (select public.is_admin())
     and (p_status is null or r.status = p_status)
   order by r.created_at desc;
$$;

create function public.review_report(p_report_id uuid, p_status text, p_admin_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := (select auth.uid());
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'صلاحيات إدارة مطلوبة' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('reviewed','dismissed','actioned') then
    raise exception 'حالة مراجعة غير صالحة' using errcode = '22023';
  end if;
  if char_length(coalesce(p_admin_note,'')) > 2000 then
    raise exception 'ملاحظة الإدارة أطول من 2000 حرف' using errcode = '22023';
  end if;
  update public.reports
     set status = p_status, admin_note = coalesce(p_admin_note,''),
         reviewed_by = v_admin, reviewed_at = now()
   where id = p_report_id;
  if not found then
    raise exception 'الإبلاغ غير موجود' using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.submit_report(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_reports(text) from public, anon, authenticated;
revoke all on function public.review_report(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_report(text, uuid, text, text) to authenticated;
grant execute on function public.list_reports(text) to authenticated;
grant execute on function public.review_report(uuid, text, text) to authenticated;
