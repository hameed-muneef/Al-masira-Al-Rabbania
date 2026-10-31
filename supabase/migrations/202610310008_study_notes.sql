-- AL_MUDARASA Phase 2 (foundation): study notes — benefits & reflections.
-- Members of an active circle share "what benefited us" with typed notes,
-- discuss them via comments, and mark the helpful ones. Nothing here is public:
-- every read/insert is scoped by is_study_member(circle_id).

-- ============ الجداول ============

create table public.study_notes (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  note_type text not null check (note_type in ('scientific','reflection','question','practical','quote','personal')),
  title text not null default '' check (char_length(title) <= 200),
  content text not null default '' check (char_length(content) <= 4000),
  part_id uuid references public.study_material_parts(id) on delete set null,
  page_start integer check (page_start between 1 and 10000),
  page_end integer check (page_end between 1 and 10000),
  source_ref text not null default '' check (char_length(source_ref) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (page_end is null or page_start is null or page_end >= page_start)
);
create index study_notes_circle_idx on public.study_notes(circle_id, created_at desc);

create table public.study_note_comments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.study_notes(id) on delete cascade,
  circle_id uuid not null references public.study_circles(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '' check (char_length(content) <= 2000),
  created_at timestamptz not null default now()
);
create index study_note_comments_note_idx on public.study_note_comments(note_id, created_at);

-- علامة "فائدة نافعة": واحدة لكل مستخدم وللمشاركة؛ الإلغاء = علامة غير مفعلة.
create table public.study_note_reactions (
  note_id uuid not null references public.study_notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_helpful boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);
create index study_note_reactions_note_idx on public.study_note_reactions(note_id);

-- ============ الصلاحيات وRLS ============

alter table public.study_notes enable row level security;
alter table public.study_note_comments enable row level security;
alter table public.study_note_reactions enable row level security;

revoke all on public.study_notes, public.study_note_comments, public.study_note_reactions from public, anon, authenticated;
grant select, insert, update, delete on public.study_notes to authenticated;
grant select, insert, update, delete on public.study_note_comments to authenticated;
grant select, insert, delete on public.study_note_reactions to authenticated;

create function public.is_study_note_visible(p_note_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.study_notes n
     where n.id = p_note_id
       and (select public.is_study_member(n.circle_id))
  );
$$;
revoke all on function public.is_study_note_visible(uuid) from public, anon, authenticated;
grant execute on function public.is_study_note_visible(uuid) to authenticated;

create policy study_note_member_read on public.study_notes for select to authenticated
  using ((select public.is_study_member(circle_id)));
create policy study_note_member_insert on public.study_notes for insert to authenticated
  with check ((select public.is_study_member(circle_id)) and author_id = (select auth.uid()));
create policy study_note_author_update on public.study_notes for update to authenticated
  using (author_id = (select auth.uid()));
create policy study_note_author_delete on public.study_notes for delete to authenticated
  using (author_id = (select auth.uid()));

create policy study_comment_member_read on public.study_note_comments for select to authenticated
  using ((select public.is_study_member(circle_id)));
create policy study_comment_member_insert on public.study_note_comments for insert to authenticated
  with check ((select public.is_study_member(circle_id)) and author_id = (select auth.uid()));
create policy study_comment_author_update on public.study_note_comments for update to authenticated
  using (author_id = (select auth.uid()));
create policy study_comment_author_delete on public.study_note_comments for delete to authenticated
  using (author_id = (select auth.uid()));

create policy study_reaction_member_read on public.study_note_reactions for select to authenticated
  using (public.is_study_note_visible(note_id));

-- ============ وظائف الخادمية ============

-- إضافة فائدة علمية/تأمل/سؤال/تطبيق/اقتباس/ملاحظة شخصية للمدارسة.
create function public.add_study_note(
  p_circle_id uuid, p_note_type text, p_title text, p_content text,
  p_part_id uuid, p_page_start integer, p_page_end integer, p_source_ref text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then
    raise exception 'إضافة فائدة تتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_note_type not in ('scientific','reflection','question','practical','quote','personal')
     or p_content is null or char_length(p_content) > 4000
     or char_length(coalesce(p_title,'')) > 200 or char_length(coalesce(p_source_ref,'')) > 200 then
    raise exception 'بيانات الفائدة غير صالحة' using errcode = '22023';
  end if;
  if (select public.is_study_member(p_circle_id)) is not true then
    raise exception 'أنت لست عضوًا في هذه المدارسة' using errcode = '42501';
  end if;
  insert into public.study_notes (circle_id, author_id, note_type, title, content, part_id, page_start, page_end, source_ref)
  values (p_circle_id, v_user, p_note_type, coalesce(nullif(btrim(p_title),''),''), p_content, p_part_id, p_page_start, p_page_end, coalesce(p_source_ref,''))
  returning id into v_id;
  insert into public.notifications (recipient_id, kind, title, body, link)
  select m.user_id, 'mudarasa', 'فائدة علمية جديدة في: ' || c.title, left(coalesce(p_content,''),120), '/study'
  from public.study_circles c
  join public.study_circle_members m on m.circle_id = c.id
  where c.id = p_circle_id and m.user_id <> v_user;
  return v_id;
end $$;

-- تعديل فائدة من صاحبها.
create function public.update_study_note(
  p_note_id uuid, p_title text, p_content text, p_part_id uuid,
  p_page_start integer, p_page_end integer, p_source_ref text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_note public.study_notes%rowtype;
begin
  if v_user is null then
    raise exception 'تعديل الفائدة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_note from public.study_notes where id = p_note_id;
  if not found then
    raise exception 'الفائدة غير موجودة' using errcode = 'P0001';
  end if;
  if v_note.author_id <> v_user then
    raise exception 'صاحب الفائدة فقط يحدّثها' using errcode = '42501';
  end if;
  if p_content is null or char_length(p_content) > 4000
     or char_length(coalesce(p_title,'')) > 200 or char_length(coalesce(p_source_ref,'')) > 200 then
    raise exception 'بيانات الفائدة غير صالحة' using errcode = '22023';
  end if;
  update public.study_notes set
    title = coalesce(nullif(btrim(p_title),''), title),
    content = p_content,
    part_id = p_part_id,
    page_start = p_page_start,
    page_end = p_page_end,
    source_ref = coalesce(p_source_ref,''),
    updated_at = now()
  where id = p_note_id;
end $$;

-- حذف فائدة من صاحبها.
create function public.delete_study_note(p_note_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_note public.study_notes%rowtype;
begin
  if v_user is null then
    raise exception 'حذف الفائدة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  select * into v_note from public.study_notes where id = p_note_id;
  if not found then
    raise exception 'الفائدة غير موجودة' using errcode = 'P0001';
  end if;
  if v_note.author_id <> v_user then
    raise exception 'صاحب الفائدة فقط يحذفها' using errcode = '42501';
  end if;
  delete from public.study_notes where id = p_note_id;
end $$;

-- تعليق على فائدة: العضو المعني يعلق، والمدارسة تكشف التعليقات للأعضاء.
create function public.add_study_note_comment(p_note_id uuid, p_content text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then
    raise exception 'إضافة تعليق يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if p_content is null or char_length(p_content) > 2000 then
    raise exception 'تعليق غير صالح' using errcode = '22023';
  end if;
  if (select public.is_study_note_visible(p_note_id)) is not true then
    raise exception 'تعليق على فائدة من درس مدارسة أخرى' using errcode = '42501';
  end if;
  insert into public.study_note_comments (note_id, circle_id, author_id, content)
  select p_note_id, n.circle_id, v_user, p_content from public.study_notes n where n.id = p_note_id
  returning id into v_id;
  return v_id;
end $$;

-- علامة "فائدة نافعة" (إضافة أو إلغاء).
create function public.toggle_study_note_helpful(p_note_id uuid, p_is_helpful boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'تسجيل الفائدة النافعة يتطلب تسجيل الدخول' using errcode = '42501';
  end if;
  if (select public.is_study_note_visible(p_note_id)) is not true then
    raise exception 'الفائدة غير مرتبطة بمدارسة عضواً' using errcode = '42501';
  end if;
  if p_is_helpful then
    insert into public.study_note_reactions (note_id, user_id, is_helpful)
    values (p_note_id, v_user, true)
    on conflict (note_id, user_id) do nothing;
  else
    delete from public.study_note_reactions where note_id = p_note_id and user_id = v_user;
  end if;
end $$;

-- قائمة المشاركات الأعضية (الفوائد/الأسئلة/التأمل...) مع عدد "فوائد نافعة" لكل منشور.
create function public.list_study_notes(p_circle_id uuid)
returns table (id uuid, author_id uuid, note_type text, title text, content text, part_id uuid, page_start integer, page_end integer, source_ref text, helpful_count bigint, created_at timestamptz)
language sql security definer set search_path = '' as $$
  select n.id, n.author_id, n.note_type, n.title, n.content, n.part_id, n.page_start, n.page_end, n.source_ref,
    (select count(*) from public.study_note_reactions r where r.note_id = n.id and r.is_helpful),
    n.created_at
  from public.study_notes n
  where n.circle_id = p_circle_id
    and (select public.is_study_member(p_circle_id))
$$;

-- ============ المنح ============

revoke all on function public.add_study_note(uuid, text, text, text, uuid, integer, integer, text) from public, anon, authenticated;
revoke all on function public.update_study_note(uuid, text, text, uuid, integer, integer, text) from public, anon, authenticated;
revoke all on function public.delete_study_note(uuid) from public, anon, authenticated;
revoke all on function public.add_study_note_comment(uuid, text) from public, anon, authenticated;
revoke all on function public.toggle_study_note_helpful(uuid, boolean) from public, anon, authenticated;
revoke all on function public.list_study_notes(uuid) from public, anon, authenticated;

grant execute on function public.add_study_note(uuid, text, text, text, uuid, integer, integer, text) to authenticated;
grant execute on function public.update_study_note(uuid, text, text, uuid, integer, integer, text) to authenticated;
grant execute on function public.delete_study_note(uuid) to authenticated;
grant execute on function public.add_study_note_comment(uuid, text) to authenticated;
grant execute on function public.toggle_study_note_helpful(uuid, boolean) to authenticated;
grant execute on function public.list_study_notes(uuid) to authenticated;
