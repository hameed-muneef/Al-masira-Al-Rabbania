-- ILM-004/005: publish aggregate seat availability without exposing registrants.
-- Registration still locks the course row and makes the final capacity decision.
create function public.list_public_course_seats(p_course_ids uuid[])
returns table(course_id uuid, capacity integer, registered_count bigint, remaining_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_course_ids is null or cardinality(p_course_ids)>100 then
    raise exception 'قائمة المجالس غير صالحة' using errcode='22023';
  end if;
  return query select c.id,c.capacity,count(r.id),greatest(c.capacity::bigint-count(r.id),0)
    from public.courses c
    join public.teacher_applications t on t.user_id=c.teacher_id
    left join public.course_registrations r on r.course_id=c.id and r.status='registered'
    where c.id=any(p_course_ids) and c.status='published' and c.access='public'
      and t.status='approved' and t.identity_status='approved'
      and t.qualification_status='approved' and t.endorsement_status='approved'
    group by c.id,c.capacity;
end $$;
revoke all on function public.list_public_course_seats(uuid[]) from public,anon,authenticated;
grant execute on function public.list_public_course_seats(uuid[]) to anon,authenticated;
