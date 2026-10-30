-- ILM-002: only platform admins may decide or suspend teacher approval.
create table public.teacher_review_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  identity_status text not null check (identity_status in ('pending','approved','rejected')),
  qualification_status text not null check (qualification_status in ('pending','approved','rejected')),
  endorsement_status text not null check (endorsement_status in ('pending','approved','rejected')),
  resulting_status text not null check (resulting_status in ('submitted','approved','rejected','suspended')),
  note text not null check (char_length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index teacher_review_events_user_idx on public.teacher_review_events(user_id,created_at desc);
alter table public.teacher_review_events enable row level security;
revoke all on public.teacher_review_events from public,anon,authenticated;
grant select on public.teacher_review_events to authenticated;
grant select,insert,update,delete on public.teacher_review_events to service_role;
create policy admin_teacher_review_read on public.teacher_review_events for select to authenticated
  using ((select public.is_admin()));

create function public.review_teacher_application(
  p_user_id uuid,p_identity_status text,p_qualification_status text,
  p_endorsement_status text,p_note text,p_suspend boolean default false
) returns text language plpgsql security definer set search_path = '' as $$
declare v_reviewer uuid := (select auth.uid()); v_status text;
begin
  if v_reviewer is null or not public.is_admin() then
    raise exception 'إدارة المنصة فقط تراجع المعلمين' using errcode='42501';
  end if;
  if p_identity_status is null or p_identity_status not in ('pending','approved','rejected')
     or p_qualification_status is null or p_qualification_status not in ('pending','approved','rejected')
     or p_endorsement_status is null or p_endorsement_status not in ('pending','approved','rejected')
     or p_note is null or char_length(btrim(p_note)) not between 1 and 2000 then
    raise exception 'قرار المراجعة غير صالح' using errcode='22023';
  end if;
  perform 1 from public.teacher_applications where user_id=p_user_id for update;
  if not found then raise exception 'طلب المعلم غير موجود' using errcode='P0001'; end if;
  v_status := case when p_suspend then 'suspended'
    when 'rejected' in (p_identity_status,p_qualification_status,p_endorsement_status) then 'rejected'
    when p_identity_status='approved' and p_qualification_status='approved' and p_endorsement_status='approved' then 'approved'
    else 'submitted' end;
  update public.teacher_applications set identity_status=p_identity_status,
    qualification_status=p_qualification_status,endorsement_status=p_endorsement_status,
    status=v_status,review_note=btrim(p_note),reviewed_by=v_reviewer,reviewed_at=now(),updated_at=now()
    where user_id=p_user_id;
  insert into public.teacher_review_events(user_id,reviewer_id,identity_status,qualification_status,
    endorsement_status,resulting_status,note)
    values(p_user_id,v_reviewer,p_identity_status,p_qualification_status,p_endorsement_status,v_status,btrim(p_note));
  return v_status;
end $$;
revoke all on function public.review_teacher_application(uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.review_teacher_application(uuid,text,text,text,text,boolean) to authenticated;
