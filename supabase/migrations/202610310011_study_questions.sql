-- Structured questions and replies for study circles. Teacher verification and
-- moderation state are writable only through membership-checked RPCs.

create table public.study_questions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  asker_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 200),
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  part_id uuid references public.study_material_parts(id) on delete set null,
  status text not null default 'open' check (status in ('open','answered','needs_review')),
  is_pinned boolean not null default false,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index study_questions_circle_idx on public.study_questions(circle_id, is_pinned desc, created_at desc);

create table public.study_question_replies (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.study_questions(id) on delete cascade,
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  teacher_verified boolean not null default false,
  created_at timestamptz not null default now()
);
create index study_question_replies_question_idx on public.study_question_replies(question_id, created_at);

alter table public.study_questions enable row level security;
alter table public.study_question_replies enable row level security;
revoke all on public.study_questions, public.study_question_replies from public, anon, authenticated;

create function public.is_study_question_visible(p_question_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.study_questions q
    where q.id = p_question_id
      and (select public.is_study_member(q.circle_id))
  );
$$;
revoke all on function public.is_study_question_visible(uuid) from public, anon, authenticated;
grant execute on function public.is_study_question_visible(uuid) to authenticated;

create function public.add_study_question(
  p_circle_id uuid, p_title text, p_content text, p_part_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_circle public.study_circles%rowtype;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'إضافة سؤال تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 3 and 200
     or p_content is null or char_length(btrim(p_content)) not between 1 and 4000 then
    raise exception 'بيانات السؤال غير صالحة' using errcode = '22023';
  end if;
  if (select public.is_study_member(p_circle_id)) is not true then
    raise exception 'أنت لست عضوًا في هذه المدارسة' using errcode = '42501';
  end if;
  select * into v_circle from public.study_circles where id = p_circle_id;
  if not found or v_circle.status <> 'active' then
    raise exception 'المدارسة ليست نشطة فلا تُضاف أسئلة' using errcode = 'P0001';
  end if;
  if p_part_id is not null and not exists (
    select 1 from public.study_material_parts where id = p_part_id and circle_id = p_circle_id
  ) then
    raise exception 'الجزء المحدد لا يتبع هذه المدارسة' using errcode = '22023';
  end if;
  insert into public.study_questions(circle_id, asker_id, title, content, part_id)
  values (p_circle_id, v_user, btrim(p_title), btrim(p_content), p_part_id)
  returning id into v_id;
  insert into public.notifications(recipient_id, kind, title, body, link)
  select m.user_id, 'mudarasa', 'سؤال جديد في: ' || v_circle.title, btrim(p_title), '/study'
  from public.study_circle_members m
  where m.circle_id = p_circle_id and m.user_id <> v_user;
  return v_id;
end $$;

create function public.reply_study_question(p_question_id uuid, p_content text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_question public.study_questions%rowtype;
  v_id uuid;
  v_teacher_verified boolean;
begin
  if v_user is null then
    raise exception 'الرد على السؤال يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_content is null or char_length(btrim(p_content)) not between 1 and 4000 then
    raise exception 'الرد غير صالح' using errcode = '22023';
  end if;
  select * into v_question from public.study_questions where id = p_question_id;
  if not found or (select public.is_study_member(v_question.circle_id)) is not true then
    raise exception 'السؤال غير متاح لأعضاء هذه المدارسة' using errcode = '42501';
  end if;
  if not exists (select 1 from public.study_circles where id = v_question.circle_id and status = 'active') then
    raise exception 'المدارسة ليست نشطة فلا تُضاف ردود' using errcode = 'P0001';
  end if;
  v_teacher_verified := private.study_role(v_question.circle_id, array['teacher']) is not null
    and (select public.is_approved_teacher());
  insert into public.study_question_replies(question_id, circle_id, author_id, content, teacher_verified)
  values (p_question_id, v_question.circle_id, v_user, btrim(p_content), v_teacher_verified)
  returning id into v_id;
  if v_question.asker_id <> v_user then
    insert into public.notifications(recipient_id, kind, title, body, link)
    values (v_question.asker_id, 'mudarasa', 'رد جديد على سؤالك', left(btrim(p_content), 120), '/study');
  end if;
  return v_id;
end $$;

create function public.set_study_question_state(
  p_question_id uuid, p_status text, p_is_pinned boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_question public.study_questions%rowtype;
  v_role text;
begin
  if v_user is null then
    raise exception 'تحديث السؤال يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('open','answered','needs_review') or p_is_pinned is null then
    raise exception 'حالة السؤال غير صالحة' using errcode = '22023';
  end if;
  select * into v_question from public.study_questions where id = p_question_id for update;
  if not found then
    raise exception 'السؤال غير موجود' using errcode = 'P0001';
  end if;
  v_role := private.study_role(v_question.circle_id, array['creator','supervisor','teacher']);
  if v_role is null or (v_role = 'teacher' and not (select public.is_approved_teacher())) then
    raise exception 'إدارة السؤال تتطلب دورًا مخولًا في المدارسة' using errcode = '42501';
  end if;
  if p_status = 'answered' and (
    v_role <> 'teacher'
    or not (select public.is_approved_teacher())
    or not exists (
      select 1 from public.study_question_replies r
      where r.question_id = p_question_id and r.teacher_verified
    )
  ) then
    raise exception 'اعتماد الإجابة يتطلب ردًا من معلم معتمد في المدارسة' using errcode = '42501';
  end if;
  update public.study_questions set
    status = p_status,
    is_pinned = p_is_pinned,
    reviewed_by = case when p_status = 'open' then null else v_user end,
    reviewed_at = case when p_status = 'open' then null else now() end,
    updated_at = now()
  where id = p_question_id;
  if v_question.asker_id <> v_user and
     (v_question.status is distinct from p_status or v_question.is_pinned is distinct from p_is_pinned) then
    insert into public.notifications(recipient_id, kind, title, body, link)
    values (
      v_question.asker_id, 'mudarasa',
      case p_status when 'answered' then 'تمت الإجابة عن سؤالك' when 'needs_review' then 'سؤالك يحتاج إلى مراجعة' else 'تحديث سؤالك' end,
      v_question.title, '/study'
    );
  end if;
end $$;

create function public.list_study_questions(p_circle_id uuid)
returns table(
  id uuid, asker_id uuid, title text, content text, part_id uuid,
  status text, is_pinned boolean, reply_count bigint, created_at timestamptz,
  reviewed_by uuid, reviewed_at timestamptz
)
language sql security definer set search_path = '' as $$
  select q.id, q.asker_id, q.title, q.content, q.part_id, q.status, q.is_pinned,
    (select count(*) from public.study_question_replies r where r.question_id = q.id),
    q.created_at, q.reviewed_by, q.reviewed_at
  from public.study_questions q
  where q.circle_id = p_circle_id
    and (select public.is_study_member(p_circle_id))
  order by q.is_pinned desc, q.created_at desc
$$;

create function public.list_study_question_replies(p_question_id uuid)
returns table(id uuid, author_id uuid, content text, teacher_verified boolean, created_at timestamptz)
language sql security definer set search_path = '' as $$
  select r.id, r.author_id, r.content, r.teacher_verified, r.created_at
  from public.study_question_replies r
  where r.question_id = p_question_id
    and (select public.is_study_question_visible(p_question_id))
  order by r.created_at
$$;

revoke all on function public.add_study_question(uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.reply_study_question(uuid,text) from public, anon, authenticated;
revoke all on function public.set_study_question_state(uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.list_study_questions(uuid) from public, anon, authenticated;
revoke all on function public.list_study_question_replies(uuid) from public, anon, authenticated;
grant execute on function public.add_study_question(uuid,text,text,uuid) to authenticated;
grant execute on function public.reply_study_question(uuid,text) to authenticated;
grant execute on function public.set_study_question_state(uuid,text,boolean) to authenticated;
grant execute on function public.list_study_questions(uuid) to authenticated;
grant execute on function public.list_study_question_replies(uuid) to authenticated;
