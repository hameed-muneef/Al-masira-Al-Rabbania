-- TAW-011: private, independently approved mentor profiles and appointment requests.
-- All appointment operations go through SECURITY DEFINER RPCs; request details are never public.

create table public.tawasi_mentors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  biography text not null default '' check (char_length(biography) <= 2000),
  mentor_type text not null check (mentor_type in ('scholar','educator','mentor','counselor')),
  qualifications text not null check (char_length(btrim(qualifications)) between 2 and 3000),
  specialties text[] not null default '{}',
  languages text[] not null default '{ar}',
  directory_visible boolean not null default false,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','suspended')),
  review_note text not null default '' check (char_length(review_note) <= 2000),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(specialties) <= 12),
  check (cardinality(languages) between 1 and 8)
);

create table public.tawasi_mentor_review_events (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.tawasi_mentors(user_id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  resulting_status text not null check (resulting_status in ('approved','rejected','suspended')),
  note text not null check (char_length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index tawasi_mentor_review_events_idx on public.tawasi_mentor_review_events(mentor_id,created_at desc);

create table public.tawasi_mentor_slots (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.tawasi_mentors(user_id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'available' check (status in ('available','booked','cancelled','completed')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '3 hours')
);
create index tawasi_mentor_slots_public_idx on public.tawasi_mentor_slots(mentor_id,starts_at) where status='available';

create table public.tawasi_mentorship_requests (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.tawasi_mentor_slots(id),
  mentor_id uuid not null references public.tawasi_mentors(user_id),
  requester_id uuid not null references auth.users(id) on delete cascade,
  topic text not null check (char_length(btrim(topic)) between 2 and 120),
  private_details text not null default '' check (char_length(private_details) <= 2000),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','cancelled','completed')),
  mentor_note text not null default '' check (char_length(mentor_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mentor_id <> requester_id)
);
create index tawasi_requests_mentor_idx on public.tawasi_mentorship_requests(mentor_id,status,created_at desc);
create index tawasi_requests_user_idx on public.tawasi_mentorship_requests(requester_id,status,created_at desc);
create unique index tawasi_active_request_per_slot_idx on public.tawasi_mentorship_requests(slot_id) where status in ('pending','confirmed');

alter table public.tawasi_mentors enable row level security;
alter table public.tawasi_mentor_review_events enable row level security;
alter table public.tawasi_mentor_slots enable row level security;
alter table public.tawasi_mentorship_requests enable row level security;
revoke all on public.tawasi_mentors,public.tawasi_mentor_review_events,public.tawasi_mentor_slots,public.tawasi_mentorship_requests from public,anon,authenticated;
grant select,insert,update,delete on public.tawasi_mentors,public.tawasi_mentor_review_events,public.tawasi_mentor_slots,public.tawasi_mentorship_requests to service_role;

create function public.submit_tawasi_mentor_profile(
  p_display_name text,p_biography text,p_mentor_type text,p_qualifications text,
  p_specialties text[] default '{}',p_languages text[] default '{ar}',p_directory_visible boolean default false
) returns text language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_status text;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 2 and 120
     or char_length(coalesce(p_biography,''))>2000
     or p_mentor_type is null or p_mentor_type not in ('scholar','educator','mentor','counselor')
     or p_qualifications is null or char_length(btrim(p_qualifications)) not between 2 and 3000
     or coalesce(cardinality(p_specialties),0)>12
     or coalesce(cardinality(p_languages),0) not between 1 and 8
     or exists(select 1 from unnest(coalesce(p_specialties,'{}')) as x(value) where char_length(btrim(value)) not between 1 and 80)
     or exists(select 1 from unnest(coalesce(p_languages,'{}')) as x(value) where char_length(btrim(value)) not between 2 and 40) then
    raise exception 'بيانات ملف المرشد غير صالحة' using errcode='22023';
  end if;
  select status into v_status from public.tawasi_mentors where user_id=v_actor for update;
  if v_status in ('approved','suspended') then
    raise exception 'لا يمكن إعادة تقديم الملف بعد الاعتماد أو التعليق' using errcode='P0001';
  end if;
  insert into public.tawasi_mentors(user_id,display_name,biography,mentor_type,qualifications,specialties,languages,directory_visible)
    values(v_actor,btrim(p_display_name),btrim(coalesce(p_biography,'')),p_mentor_type,btrim(p_qualifications),
      coalesce(p_specialties,'{}'),coalesce(p_languages,'{ar}'),coalesce(p_directory_visible,false))
    on conflict(user_id) do update set display_name=excluded.display_name,biography=excluded.biography,
      mentor_type=excluded.mentor_type,qualifications=excluded.qualifications,specialties=excluded.specialties,
      languages=excluded.languages,directory_visible=excluded.directory_visible,status='submitted',
      review_note='',submitted_at=now(),reviewed_at=null,reviewed_by=null,updated_at=now();
  return 'submitted';
end $$;
revoke all on function public.submit_tawasi_mentor_profile(text,text,text,text,text[],text[],boolean) from public,anon,authenticated;
grant execute on function public.submit_tawasi_mentor_profile(text,text,text,text,text[],text[],boolean) to authenticated;

create function public.review_tawasi_mentor(p_mentor_id uuid,p_status text,p_note text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not public.is_admin() then raise exception 'إدارة المنصة فقط تعتمد المرشدين' using errcode='42501'; end if;
  if p_status is null or p_status not in ('approved','rejected','suspended') or p_note is null or char_length(btrim(p_note)) not between 1 and 2000 then
    raise exception 'قرار المراجعة غير صالح' using errcode='22023';
  end if;
  perform 1 from public.tawasi_mentors where user_id=p_mentor_id for update;
  if not found then raise exception 'طلب اعتماد المرشد غير موجود' using errcode='P0001'; end if;
  update public.tawasi_mentors set status=p_status,review_note=btrim(p_note),reviewed_at=now(),reviewed_by=v_actor,updated_at=now() where user_id=p_mentor_id;
  if p_status<>'approved' then
    update public.tawasi_mentorship_requests set status='cancelled',updated_at=now()
      where mentor_id=p_mentor_id and status in ('pending','confirmed');
    update public.tawasi_mentor_slots set status='cancelled' where mentor_id=p_mentor_id and status in ('available','booked');
  end if;
  insert into public.tawasi_mentor_review_events(mentor_id,reviewer_id,resulting_status,note) values(p_mentor_id,v_actor,p_status,btrim(p_note));
  return p_status;
end $$;
revoke all on function public.review_tawasi_mentor(uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_tawasi_mentor(uuid,text,text) to authenticated;

create function public.list_tawasi_mentors()
returns table(user_id uuid,display_name text,biography text,mentor_type text,qualifications text,specialties text[],languages text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  return query select m.user_id,m.display_name,m.biography,m.mentor_type,m.qualifications,m.specialties,m.languages
    from public.tawasi_mentors m where m.status='approved' and m.directory_visible order by m.display_name;
end $$;
revoke all on function public.list_tawasi_mentors() from public,anon,authenticated;
grant execute on function public.list_tawasi_mentors() to authenticated;

create function public.get_my_tawasi_mentor_profile()
returns table(user_id uuid,display_name text,biography text,mentor_type text,qualifications text,specialties text[],languages text[],directory_visible boolean,status text,review_note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  return query select m.user_id,m.display_name,m.biography,m.mentor_type,m.qualifications,m.specialties,m.languages,m.directory_visible,m.status,m.review_note
    from public.tawasi_mentors m where m.user_id=(select auth.uid());
end $$;
revoke all on function public.get_my_tawasi_mentor_profile() from public,anon,authenticated;
grant execute on function public.get_my_tawasi_mentor_profile() to authenticated;

create function public.list_tawasi_mentor_applications()
returns table(user_id uuid,display_name text,biography text,mentor_type text,qualifications text,specialties text[],languages text[],directory_visible boolean,status text,review_note text,submitted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then raise exception 'إدارة المنصة فقط تراجع ملفات المرشدين' using errcode='42501'; end if;
  return query select m.user_id,m.display_name,m.biography,m.mentor_type,m.qualifications,m.specialties,m.languages,m.directory_visible,m.status,m.review_note,m.submitted_at
    from public.tawasi_mentors m order by m.submitted_at desc;
end $$;
revoke all on function public.list_tawasi_mentor_applications() from public,anon,authenticated;
grant execute on function public.list_tawasi_mentor_applications() to authenticated;

create function public.create_tawasi_mentor_slot(p_starts_at timestamptz,p_ends_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at<=now() or p_ends_at<=p_starts_at
    or p_ends_at-p_starts_at>interval '3 hours' or p_starts_at>now()+interval '365 days' then
    raise exception 'موعد التوفر غير صالح' using errcode='22023';
  end if;
  perform 1 from public.tawasi_mentors where user_id=v_actor and status='approved' for update;
  if not found then raise exception 'يجب اعتماد ملفك كمرشد قبل إضافة المواعيد' using errcode='42501'; end if;
  if exists(select 1 from public.tawasi_mentor_slots s where s.mentor_id=v_actor and s.status<>'cancelled'
    and s.starts_at<p_ends_at and s.ends_at>p_starts_at) then
    raise exception 'يتعارض الموعد مع فترة أخرى' using errcode='23P01';
  end if;
  insert into public.tawasi_mentor_slots(mentor_id,starts_at,ends_at) values(v_actor,p_starts_at,p_ends_at) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_tawasi_mentor_slot(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.create_tawasi_mentor_slot(timestamptz,timestamptz) to authenticated;

create function public.list_my_tawasi_mentor_slots()
returns table(slot_id uuid,starts_at timestamptz,ends_at timestamptz,status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  return query select s.id,s.starts_at,s.ends_at,s.status from public.tawasi_mentor_slots s
    where s.mentor_id=(select auth.uid()) and s.status in ('available','booked') order by s.starts_at;
end $$;
revoke all on function public.list_my_tawasi_mentor_slots() from public,anon,authenticated;
grant execute on function public.list_my_tawasi_mentor_slots() to authenticated;

create function public.cancel_tawasi_mentor_slot(p_slot_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_status text;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select status into v_status from public.tawasi_mentor_slots where id=p_slot_id and mentor_id=v_actor for update;
  if not found then raise exception 'الموعد غير موجود أو لا تملك إدارته' using errcode='42501'; end if;
  if v_status<>'available' then raise exception 'لا يمكن إلغاء موعد عليه طلب حجز؛ عالج الطلب أولًا' using errcode='P0001'; end if;
  update public.tawasi_mentor_slots set status='cancelled' where id=p_slot_id;
  return 'cancelled';
end $$;
revoke all on function public.cancel_tawasi_mentor_slot(uuid) from public,anon,authenticated;
grant execute on function public.cancel_tawasi_mentor_slot(uuid) to authenticated;

create function public.list_tawasi_mentor_slots(p_mentor_id uuid,p_from timestamptz,p_to timestamptz)
returns table(slot_id uuid,starts_at timestamptz,ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  if p_mentor_id is null or p_from is null or p_to is null or p_to<=p_from or p_to>p_from+interval '90 days' then
    raise exception 'نطاق البحث عن المواعيد غير صالح' using errcode='22023';
  end if;
  return query select s.id,s.starts_at,s.ends_at from public.tawasi_mentor_slots s
    join public.tawasi_mentors m on m.user_id=s.mentor_id
    where s.mentor_id=p_mentor_id and m.status='approved' and s.status='available'
      and s.starts_at>=p_from and s.starts_at<p_to order by s.starts_at;
end $$;
revoke all on function public.list_tawasi_mentor_slots(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.list_tawasi_mentor_slots(uuid,timestamptz,timestamptz) to authenticated;

create function public.request_tawasi_mentorship(p_slot_id uuid,p_topic text,p_private_details text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_slot public.tawasi_mentor_slots%rowtype; v_request uuid;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  if p_slot_id is null or p_topic is null or char_length(btrim(p_topic)) not between 2 and 120 or char_length(coalesce(p_private_details,''))>2000 then
    raise exception 'بيانات طلب الجلسة غير صالحة' using errcode='22023';
  end if;
  select * into v_slot from public.tawasi_mentor_slots where id=p_slot_id for update;
  if not found or v_slot.status<>'available' or v_slot.starts_at<=now() then
    raise exception 'هذا الموعد لم يعد متاحًا' using errcode='P0001';
  end if;
  if v_slot.mentor_id=v_actor then raise exception 'لا يمكنك حجز موعدك بنفسك' using errcode='42501'; end if;
  if not exists(select 1 from public.tawasi_mentors where user_id=v_slot.mentor_id and status='approved') then
    raise exception 'المرشد غير متاح حاليًا' using errcode='P0001';
  end if;
  insert into public.tawasi_mentorship_requests(slot_id,mentor_id,requester_id,topic,private_details)
    values(v_slot.id,v_slot.mentor_id,v_actor,btrim(p_topic),btrim(coalesce(p_private_details,''))) returning id into v_request;
  update public.tawasi_mentor_slots set status='booked' where id=v_slot.id;
  return v_request;
end $$;
revoke all on function public.request_tawasi_mentorship(uuid,text,text) from public,anon,authenticated;
grant execute on function public.request_tawasi_mentorship(uuid,text,text) to authenticated;

create function public.review_tawasi_mentorship_request(p_request_id uuid,p_decision text,p_mentor_note text default '')
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_request public.tawasi_mentorship_requests%rowtype;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  if p_decision not in ('confirm','reject') or char_length(coalesce(p_mentor_note,''))>1000 then
    raise exception 'قرار الطلب غير صالح' using errcode='22023';
  end if;
  select * into v_request from public.tawasi_mentorship_requests where id=p_request_id for update;
  if not found or (v_request.mentor_id<>v_actor and not public.is_admin()) then
    raise exception 'لا تملك صلاحية مراجعة هذا الطلب' using errcode='42501';
  end if;
  if v_request.status<>'pending' then raise exception 'تمت مراجعة الطلب من قبل' using errcode='P0001'; end if;
  if p_decision='confirm' then
    update public.tawasi_mentorship_requests set status='confirmed',mentor_note=btrim(coalesce(p_mentor_note,'')),updated_at=now() where id=p_request_id;
    return 'confirmed';
  end if;
  update public.tawasi_mentorship_requests set status='rejected',mentor_note=btrim(coalesce(p_mentor_note,'')),updated_at=now() where id=p_request_id;
  update public.tawasi_mentor_slots set status='available' where id=v_request.slot_id and starts_at>now();
  return 'rejected';
end $$;
revoke all on function public.review_tawasi_mentorship_request(uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_tawasi_mentorship_request(uuid,text,text) to authenticated;

create function public.cancel_tawasi_mentorship_request(p_request_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_request public.tawasi_mentorship_requests%rowtype;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select * into v_request from public.tawasi_mentorship_requests where id=p_request_id for update;
  if not found or (v_request.requester_id<>v_actor and v_request.mentor_id<>v_actor and not public.is_admin()) then
    raise exception 'لا تملك صلاحية إلغاء هذا الطلب' using errcode='42501';
  end if;
  if v_request.status not in ('pending','confirmed') then raise exception 'لا يمكن إلغاء هذا الطلب' using errcode='P0001'; end if;
  update public.tawasi_mentorship_requests set status='cancelled',updated_at=now() where id=p_request_id;
  update public.tawasi_mentor_slots set status=case when starts_at>now() then 'available' else 'cancelled' end where id=v_request.slot_id;
  return 'cancelled';
end $$;
revoke all on function public.cancel_tawasi_mentorship_request(uuid) from public,anon,authenticated;
grant execute on function public.cancel_tawasi_mentorship_request(uuid) to authenticated;

create function public.list_my_tawasi_mentorship_requests()
returns table(request_id uuid,slot_id uuid,mentor_id uuid,requester_id uuid,topic text,private_details text,status text,mentor_note text,starts_at timestamptz,ends_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  return query select r.id,r.slot_id,r.mentor_id,r.requester_id,r.topic,r.private_details,r.status,r.mentor_note,s.starts_at,s.ends_at,r.created_at
    from public.tawasi_mentorship_requests r join public.tawasi_mentor_slots s on s.id=r.slot_id
    where r.requester_id=(select auth.uid()) or r.mentor_id=(select auth.uid()) order by s.starts_at desc;
end $$;
revoke all on function public.list_my_tawasi_mentorship_requests() from public,anon,authenticated;
grant execute on function public.list_my_tawasi_mentorship_requests() to authenticated;
