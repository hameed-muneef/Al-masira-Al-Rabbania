-- ILM-004: expose only approved teachers' public introduction for published courses.
create function public.list_public_course_teachers(p_course_ids uuid[])
returns table(course_id uuid, display_name text, biography text, specialties text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_course_ids is null or cardinality(p_course_ids) > 100 then
    raise exception 'قائمة المجالس غير صالحة' using errcode='22023';
  end if;
  return query select c.id,t.display_name,t.biography,t.specialties
    from public.courses c join public.teacher_applications t on t.user_id=c.teacher_id
    where c.id=any(p_course_ids) and c.status='published' and c.access='public'
      and t.status='approved' and t.identity_status='approved'
      and t.qualification_status='approved' and t.endorsement_status='approved';
end $$;
revoke all on function public.list_public_course_teachers(uuid[]) from public,anon,authenticated;
grant execute on function public.list_public_course_teachers(uuid[]) to anon,authenticated;
