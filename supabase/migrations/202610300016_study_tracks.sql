-- INT-001: book study tracks with parts, questions and progress. A track may be
-- linked to a course, a private circle, or a curriculum station; access follows
-- those owners. No recording or media storage; materials are text/links only.
create table public.study_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  book_title text not null default '' check (char_length(book_title) <= 300),
  description text not null default '' check (char_length(description) <= 3000),
  course_id uuid references public.courses(id) on delete set null,
  circle_id uuid references public.study_groups(id) on delete set null,
  station_id text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index study_tracks_course_idx on public.study_tracks(course_id);
create index study_tracks_circle_idx on public.study_tracks(circle_id);

create table public.study_parts (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.study_tracks(id) on delete cascade,
  position integer not null check (position between 1 and 200),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  content text not null default '' check (char_length(content) <= 20000),
  question text not null default '' check (char_length(question) <= 2000),
  unique (track_id, position)
);
create index study_parts_track_idx on public.study_parts(track_id, position);

create table public.study_progress (
  track_id uuid not null references public.study_tracks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  part_position integer not null check (part_position >= 1),
  completed_at timestamptz not null default now(),
  primary key (track_id, user_id, part_position)
);

alter table public.study_tracks enable row level security;
alter table public.study_parts enable row level security;
alter table public.study_progress enable row level security;
revoke all on public.study_tracks, public.study_parts, public.study_progress from public, anon, authenticated;
grant select on public.study_tracks, public.study_parts to anon, authenticated;
grant select, insert, update, delete on public.study_tracks, public.study_parts to service_role;
grant select on public.study_progress to authenticated;
grant select, insert, update, delete on public.study_progress to service_role;

-- Read access: course members (registered/published), circle members, or creator/admin.
create policy study_track_read on public.study_tracks for select to anon, authenticated
  using (
    created_by = (select auth.uid())
    or (select public.is_admin())
    or (course_id is not null and exists (select 1 from public.courses c where c.id = course_id
          and (c.status = 'published' or c.teacher_id = (select auth.uid()))))
    or (circle_id is not null and (select public.is_group_member(circle_id)))
  );
create policy study_part_read on public.study_parts for select to anon, authenticated
  using (exists (select 1 from public.study_tracks t where t.id = track_id
    and (t.created_by = (select auth.uid()) or (select public.is_admin())
         or (t.course_id is not null and exists (select 1 from public.courses c where c.id = t.course_id
               and (c.status='published' or c.teacher_id=(select auth.uid()))))
         or (t.circle_id is not null and (select public.is_group_member(t.circle_id))))));

create policy study_progress_own on public.study_progress for select to authenticated
  using (user_id = (select auth.uid()));
create policy study_progress_insert on public.study_progress for insert to authenticated
  with check (user_id = (select auth.uid()));

create function public.create_study_track(p_title text, p_book_title text default '', p_description text default '',
  p_course_id uuid default null, p_circle_id uuid default null, p_station_id text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'عنوان مسار الدراسة غير صالح' using errcode='22023';
  end if;
  if char_length(coalesce(p_book_title,'')) > 300 or char_length(coalesce(p_description,'')) > 3000 then
    raise exception 'بيانات مسار الدراسة تجاوزت الحد' using errcode='22023';
  end if;
  -- If linked to a circle, caller must be a founder.
  if p_circle_id is not null and not exists (
    select 1 from public.group_members m where m.group_id = p_circle_id and m.user_id = v_actor and m.role = 'founder'
  ) then
    raise exception 'المؤسس فقط ينشئ مسار دراسة للحلقة' using errcode='42501';
  end if;
  -- If linked to a course, caller must be the approved teacher owner.
  if p_course_id is not null and not exists (
    select 1 from public.courses c where c.id = p_course_id and c.teacher_id = v_actor
  ) then
    raise exception 'معلم المجلس فقط ينشئ مسار دراسة للدورة' using errcode='42501';
  end if;
  insert into public.study_tracks (title, book_title, description, course_id, circle_id, station_id, created_by)
    values (btrim(p_title), coalesce(p_book_title,''), coalesce(p_description,''), p_course_id, p_circle_id, nullif(btrim(coalesce(p_station_id,'')),''), v_actor)
    returning id into v_id;
  return v_id;
end $$;

create function public.add_study_part(p_track_id uuid, p_position integer, p_title text,
  p_content text default '', p_question text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_track public.study_tracks%rowtype;
  v_id uuid;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select * into v_track from public.study_tracks where id = p_track_id;
  if not found then raise exception 'مسار الدراسة غير موجود' using errcode='P0001'; end if;
  if v_track.created_by <> v_actor and not public.is_admin() then
    raise exception 'لا تملك صلاحية تعديل هذا المسار' using errcode='42501';
  end if;
  if p_position is null or p_position not between 1 and 200
     or p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or char_length(coalesce(p_content,'')) > 20000
     or char_length(coalesce(p_question,'')) > 2000 then
    raise exception 'بيانات الجزء غير صالحة' using errcode='22023';
  end if;
  insert into public.study_parts (track_id, position, title, content, question)
    values (p_track_id, p_position, btrim(p_title), coalesce(p_content,''), coalesce(p_question,''))
    returning id into v_id;
  return v_id;
end $$;

create function public.mark_study_part_complete(p_track_id uuid, p_part_position integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  if p_part_position is null or p_part_position < 1 then
    raise exception 'موضع الجزء غير صالح' using errcode='22023';
  end if;
  if not exists (select 1 from public.study_tracks t where t.id = p_track_id
    and (t.created_by = v_user or (select public.is_admin())
         or (t.course_id is not null and exists (select 1 from public.courses c where c.id=t.course_id and c.status='published'))
         or (t.circle_id is not null and (select public.is_group_member(t.circle_id))))) then
    raise exception 'لا يمكنك الوصول إلى هذا المسار' using errcode='42501';
  end if;
  insert into public.study_progress (track_id, user_id, part_position)
    values (p_track_id, v_user, p_part_position)
  on conflict (track_id, user_id, part_position) do nothing;
end $$;

create function public.list_study_tracks(p_course_id uuid default null, p_circle_id uuid default null)
returns table (track_id uuid, track_title text, track_book_title text, track_description text,
               track_course_id uuid, track_circle_id uuid, track_station_id text, track_created_at timestamptz)
language sql security definer set search_path = '' as $$
  select t.id, t.title, t.book_title, t.description, t.course_id, t.circle_id, t.station_id, t.created_at
    from public.study_tracks t
   where (p_course_id is null or t.course_id = p_course_id)
     and (p_circle_id is null or t.circle_id = p_circle_id)
     and (t.created_by = (select auth.uid()) or (select public.is_admin())
          or (t.course_id is not null and exists (select 1 from public.courses c where c.id=t.course_id
                and (c.status='published' or c.teacher_id=(select auth.uid()))))
          or (t.circle_id is not null and (select public.is_group_member(t.circle_id))))
   order by t.created_at desc;
$$;

create function public.list_study_parts(p_track_id uuid)
returns table (part_id uuid, part_position integer, part_title text, part_content text, part_question text)
language sql security definer set search_path = '' as $$
  select p.id, p.position, p.title, p.content, p.question
    from public.study_parts p
    join public.study_tracks t on t.id = p.track_id
   where p.track_id = p_track_id
     and (t.created_by = (select auth.uid()) or (select public.is_admin())
          or (t.course_id is not null and exists (select 1 from public.courses c where c.id=t.course_id
                and (c.status='published' or c.teacher_id=(select auth.uid()))))
          or (t.circle_id is not null and (select public.is_group_member(t.circle_id))))
   order by p.position;
$$;

revoke all on function public.create_study_track(text, text, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.add_study_part(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.mark_study_part_complete(uuid, integer) from public, anon, authenticated;
revoke all on function public.list_study_tracks(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_study_parts(uuid) from public, anon, authenticated;
grant execute on function public.create_study_track(text, text, text, uuid, uuid, text) to authenticated;
grant execute on function public.add_study_part(uuid, integer, text, text, text) to authenticated;
grant execute on function public.mark_study_part_complete(uuid, integer) to authenticated;
grant execute on function public.list_study_tracks(uuid, uuid) to anon, authenticated;
grant execute on function public.list_study_parts(uuid) to anon, authenticated;
grant select on public.study_progress to authenticated;
