-- NTF-002: every user-visible action reaches the bell. Triggers keep the existing
-- RPCs untouched and write straight into public.notifications (no second engine).
-- Bodies carry no private details; they only say what happened.

create function private.notify(p_recipient uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications(recipient_id, kind, title, body, link)
  select p_recipient, p_kind, p_title, coalesce(p_body, ''), p_link
   where p_recipient is not null and p_recipient is distinct from (select auth.uid());
$$;

-- Circle join requests: managers are told of a new request; the requester of the decision.
create function private.trg_join_request_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select name into v_name from public.study_groups where id = new.group_id;
  if tg_op = 'INSERT' then
    insert into public.notifications(recipient_id, kind, title, body, link)
    select m.user_id, 'join_request', 'طلب انضمام جديد', coalesce(v_name, ''), 'circles'
      from public.group_members m
     where m.group_id = new.group_id and m.role in ('founder','manager') and m.user_id <> new.user_id;
  elsif new.status is distinct from old.status and new.status in ('accepted','rejected') then
    perform private.notify(new.user_id, 'join_decision',
      case new.status when 'accepted' then 'قُبل طلب انضمامك' else 'رُفض طلب انضمامك' end,
      coalesce(v_name, ''), 'circles');
  end if;
  return new;
end $$;
create trigger join_request_notify after insert or update of status on public.group_join_requests
  for each row execute function private.trg_join_request_notify();

-- Course registrations: the teacher is told when someone registers or cancels.
create function private.trg_course_registration_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_teacher uuid; v_title text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  select teacher_id, title into v_teacher, v_title from public.courses where id = new.course_id;
  if v_teacher is not null and v_teacher <> new.user_id then
    insert into public.notifications(recipient_id, kind, title, body, link)
    values (v_teacher, 'course',
      case new.status when 'registered' then 'تسجيل جديد في مجلسك' else 'إلغاء تسجيل في مجلسك' end,
      coalesce(v_title, ''), 'teacher');
  end if;
  return new;
end $$;
create trigger course_registration_notify after insert or update of status on public.course_registrations
  for each row execute function private.trg_course_registration_notify();

-- Mentorship requests: the mentor is told of a request, the requester of the decision.
create function private.trg_mentorship_request_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications(recipient_id, kind, title, body, link)
    values (new.mentor_id, 'session', 'طلب جلسة جديد', '', 'circles');
  elsif new.status is distinct from old.status then
    if new.status in ('confirmed','rejected','completed') then
      perform private.notify(new.requester_id, 'session',
        case new.status when 'confirmed' then 'تأكّد موعد جلستك' when 'rejected' then 'اعتُذر عن طلب الجلسة' else 'اكتملت جلستك' end,
        '', 'circles');
    elsif new.status = 'cancelled' then
      perform private.notify(new.mentor_id, 'session', 'أُلغي طلب جلسة', '', 'circles');
      perform private.notify(new.requester_id, 'session', 'أُلغي طلب جلستك', '', 'circles');
    end if;
  end if;
  return new;
end $$;
create trigger mentorship_request_notify after insert or update of status on public.tawasi_mentorship_requests
  for each row execute function private.trg_mentorship_request_notify();

-- Mentor and teacher applications: the applicant is told of the review result.
create function private.trg_mentor_review_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected','suspended') then
    insert into public.notifications(recipient_id, kind, title, body, link)
    values (new.user_id, 'system',
      case new.status when 'approved' then 'اعتُمد ملفك كمرشد' when 'rejected' then 'لم يُعتمد ملف المرشد' else 'عُلّق ملف المرشد' end,
      '', 'circles');
  end if;
  return new;
end $$;
create trigger mentor_review_notify after update of status on public.tawasi_mentors
  for each row execute function private.trg_mentor_review_notify();

create function private.trg_teacher_review_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected','suspended') then
    insert into public.notifications(recipient_id, kind, title, body, link)
    values (new.user_id, 'system',
      case new.status when 'approved' then 'اعتُمد طلبك كمعلم' when 'rejected' then 'لم يُعتمد طلب المعلم' else 'عُلّق حساب المعلم' end,
      '', 'teacher');
  end if;
  return new;
end $$;
create trigger teacher_review_notify after update of status on public.teacher_applications
  for each row execute function private.trg_teacher_review_notify();

-- Reports: the reporter is told once an administrator has handled the report.
create function private.trg_report_review_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status <> 'open' then
    insert into public.notifications(recipient_id, kind, title, body, link)
    values (new.reporter_id, 'report', 'تمت مراجعة بلاغك', '', '');
  end if;
  return new;
end $$;
create trigger report_review_notify after update of status on public.reports
  for each row execute function private.trg_report_review_notify();

-- Administrators: the account is told when it gains or loses admin access.
create function private.trg_admin_change_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(recipient_id, kind, title, body, link)
  values (coalesce(new.user_id, old.user_id), 'system',
    case tg_op when 'INSERT' then 'مُنحت صلاحية الإدارة' else 'أُزيلت صلاحية الإدارة' end, '', '');
  return coalesce(new, old);
end $$;
create trigger admin_change_notify after insert or delete on public.admin_accounts
  for each row execute function private.trg_admin_change_notify();
