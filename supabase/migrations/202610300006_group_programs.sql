-- TAW-007: a circle's program is versioned. Tasks in prior revisions remain
-- immutable so later progress can refer to the exact wording the member saw.
create table public.group_programs (
  group_id uuid primary key references public.study_groups(id) on delete cascade,
  template_kind text not null check (template_kind in ('prayer','quran','dhikr','book','sirah','tazkiyah','comprehensive','custom')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  current_revision integer not null check (current_revision > 0),
  updated_at timestamptz not null default now()
);

create table public.group_program_revisions (
  group_id uuid not null references public.study_groups(id) on delete cascade,
  revision integer not null check (revision > 0),
  template_kind text not null check (template_kind in ('prayer','quran','dhikr','book','sirah','tazkiyah','comprehensive','custom')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (group_id, revision)
);

create table public.group_program_tasks (
  group_id uuid not null,
  revision integer not null,
  position integer not null check (position between 1 and 30),
  category text not null check (category in ('prayer','quran','dhikr','book','sirah','tazkiyah','beneficial')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  cadence text not null check (cadence in ('daily','weekly','monthly')),
  source_note text not null default '' check (char_length(source_note) <= 500),
  primary key (group_id, revision, position),
  foreign key (group_id, revision) references public.group_program_revisions(group_id, revision) on delete cascade
);

create index group_program_revisions_recent on public.group_program_revisions(group_id, revision desc);
alter table public.group_programs enable row level security;
alter table public.group_program_revisions enable row level security;
alter table public.group_program_tasks enable row level security;
revoke all on public.group_programs, public.group_program_revisions, public.group_program_tasks from public, anon, authenticated;
grant select on public.group_programs, public.group_program_revisions, public.group_program_tasks to authenticated;
grant select, insert, update, delete on public.group_programs, public.group_program_revisions, public.group_program_tasks to service_role;
create policy member_program_read on public.group_programs for select to authenticated
  using ((select public.is_group_member(group_id)));
create policy member_program_revision_read on public.group_program_revisions for select to authenticated
  using ((select public.is_group_member(group_id)));
create policy member_program_task_read on public.group_program_tasks for select to authenticated
  using ((select public.is_group_member(group_id)));

create function public.save_group_program(p_group_id uuid, p_template_kind text, p_title text, p_tasks jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_group public.study_groups%rowtype;
        v_revision integer; v_task jsonb; v_position integer := 0;
begin
  if v_actor is null then raise exception 'تسجيل الدخول مطلوب' using errcode='42501'; end if;
  select * into v_group from public.study_groups where id=p_group_id for update;
  if not found or v_group.founder_id<>v_actor or not exists (
    select 1 from public.group_members where group_id=p_group_id and user_id=v_actor and role='founder') then
    raise exception 'المؤسس فقط يغيّر البرنامج' using errcode='42501';
  end if;
  if v_group.status<>'active' then raise exception 'الحلقة مغلقة' using errcode='P0001'; end if;
  if p_template_kind is null or p_template_kind not in ('prayer','quran','dhikr','book','sirah','tazkiyah','comprehensive','custom')
     or p_title is null or char_length(btrim(p_title)) not between 1 and 120
     or p_tasks is null or jsonb_typeof(p_tasks)<>'array' or jsonb_array_length(p_tasks) not between 1 and 30 then
    raise exception 'بيانات البرنامج غير صالحة' using errcode='22023';
  end if;
  select coalesce(current_revision,0)+1 into v_revision from public.group_programs where group_id=p_group_id;
  v_revision := coalesce(v_revision,1);
  insert into public.group_program_revisions(group_id,revision,template_kind,title,created_by)
    values(p_group_id,v_revision,p_template_kind,btrim(p_title),v_actor);
  for v_task in select value from jsonb_array_elements(p_tasks) loop
    v_position := v_position+1;
    if jsonb_typeof(v_task)<>'object' or v_task->>'category' not in ('prayer','quran','dhikr','book','sirah','tazkiyah','beneficial')
       or v_task->>'cadence' not in ('daily','weekly','monthly')
       or v_task->>'title' is null or char_length(btrim(v_task->>'title')) not between 1 and 200
       or char_length(coalesce(v_task->>'source_note',''))>500 then
      raise exception 'مهمة برنامج غير صالحة' using errcode='22023';
    end if;
    insert into public.group_program_tasks(group_id,revision,position,category,title,cadence,source_note)
      values(p_group_id,v_revision,v_position,v_task->>'category',btrim(v_task->>'title'),v_task->>'cadence',coalesce(v_task->>'source_note',''));
  end loop;
  insert into public.group_programs(group_id,template_kind,title,current_revision)
    values(p_group_id,p_template_kind,btrim(p_title),v_revision)
    on conflict (group_id) do update set template_kind=excluded.template_kind,
      title=excluded.title,current_revision=excluded.current_revision,updated_at=now();
  return v_revision;
end $$;
revoke all on function public.save_group_program(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_group_program(uuid,text,text,jsonb) to authenticated;

-- A completion references the exact task revision. Replacing a program does
-- not rewrite or delete this history. TAW-008 will add the member tracking UI.
create table public.group_task_completions (
  group_id uuid not null,
  revision integer not null,
  position integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_on date not null,
  created_at timestamptz not null default now(),
  primary key (group_id,revision,position,user_id,completed_on),
  foreign key (group_id,revision,position) references public.group_program_tasks(group_id,revision,position) on delete cascade
);
create index group_task_completions_user_idx on public.group_task_completions(user_id,completed_on desc);
alter table public.group_task_completions enable row level security;
revoke all on public.group_task_completions from public,anon,authenticated;
grant select on public.group_task_completions to authenticated;
grant select,insert,update,delete on public.group_task_completions to service_role;
create policy own_group_completion_read on public.group_task_completions for select to authenticated
  using (user_id=(select auth.uid()) and (select public.is_group_member(group_id)));

create function public.complete_group_task(p_group_id uuid,p_position integer,p_completed_on date default current_date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_revision integer;
begin
  if v_actor is null or not public.is_group_member(p_group_id) then
    raise exception 'عضوية الحلقة مطلوبة' using errcode='42501';
  end if;
  if p_completed_on is null or p_completed_on>current_date or p_completed_on<current_date-366 then
    raise exception 'تاريخ الإنجاز غير صالح' using errcode='22023';
  end if;
  select current_revision into v_revision from public.group_programs where group_id=p_group_id;
  if v_revision is null or not exists(select 1 from public.group_program_tasks
     where group_id=p_group_id and revision=v_revision and position=p_position) then
    raise exception 'المهمة غير موجودة في البرنامج الحالي' using errcode='P0001';
  end if;
  insert into public.group_task_completions(group_id,revision,position,user_id,completed_on)
    values(p_group_id,v_revision,p_position,v_actor,p_completed_on) on conflict do nothing;
end $$;
revoke all on function public.complete_group_task(uuid,integer,date) from public,anon,authenticated;
grant execute on function public.complete_group_task(uuid,integer,date) to authenticated;
