-- ILM-001: requesting to teach never grants publishing privileges. Identity,
-- qualifications, and endorsement are separate review dimensions.
create table public.teacher_applications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  biography text not null default '' check (char_length(biography)<=2000),
  specialties text not null default '' check (char_length(specialties)<=1000),
  qualifications text not null default '' check (char_length(qualifications)<=3000),
  endorsement text not null default '' check (char_length(endorsement)<=3000),
  identity_status text not null default 'pending' check (identity_status in ('pending','approved','rejected')),
  qualification_status text not null default 'pending' check (qualification_status in ('pending','approved','rejected')),
  endorsement_status text not null default 'pending' check (endorsement_status in ('pending','approved','rejected')),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','suspended')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text not null default '' check (char_length(review_note)<=2000),
  updated_at timestamptz not null default now(),
  check (status<>'approved' or (identity_status='approved' and qualification_status='approved' and endorsement_status='approved'))
);
alter table public.teacher_applications enable row level security;
revoke all on public.teacher_applications from public,anon,authenticated;
grant select on public.teacher_applications to authenticated;
grant select,insert,update,delete on public.teacher_applications to service_role;
create policy own_or_admin_teacher_application_read on public.teacher_applications for select to authenticated
  using (user_id=(select auth.uid()) or (select public.is_admin()));

create function public.submit_teacher_application(
  p_display_name text,p_biography text,p_specialties text,p_qualifications text,p_endorsement text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_existing_status text;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 2 and 120
     or p_qualifications is null or btrim(p_qualifications)=''
     or p_endorsement is null or btrim(p_endorsement)=''
     or char_length(coalesce(p_biography,''))>2000 or char_length(coalesce(p_specialties,''))>1000
     or char_length(p_qualifications)>3000 or char_length(p_endorsement)>3000 then
    raise exception 'بيانات طلب المعلم غير صالحة' using errcode='22023';
  end if;
  select status into v_existing_status from public.teacher_applications where user_id=v_actor for update;
  if v_existing_status in ('approved','suspended') then
    raise exception 'لا يمكن تعديل الطلب بعد الاعتماد أو التعليق' using errcode='P0001';
  end if;
  insert into public.teacher_applications(user_id,display_name,biography,specialties,qualifications,endorsement)
    values(v_actor,btrim(p_display_name),btrim(coalesce(p_biography,'')),btrim(coalesce(p_specialties,'')),
      btrim(p_qualifications),btrim(p_endorsement))
    on conflict (user_id) do update set display_name=excluded.display_name,biography=excluded.biography,
      specialties=excluded.specialties,qualifications=excluded.qualifications,endorsement=excluded.endorsement,
      identity_status='pending',qualification_status='pending',endorsement_status='pending',status='submitted',
      submitted_at=now(),reviewed_at=null,reviewed_by=null,review_note='',updated_at=now();
end $$;
revoke all on function public.submit_teacher_application(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_teacher_application(text,text,text,text,text) to authenticated;

create function public.is_approved_teacher()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.teacher_applications
    where user_id=(select auth.uid()) and status='approved'
      and identity_status='approved' and qualification_status='approved' and endorsement_status='approved');
$$;
revoke all on function public.is_approved_teacher() from public,anon,authenticated;
grant execute on function public.is_approved_teacher() to authenticated;
