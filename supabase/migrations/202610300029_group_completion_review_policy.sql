create policy founder_group_completion_read on public.group_task_completions for select to authenticated
  using (exists(select 1 from public.group_members where group_id=group_task_completions.group_id and user_id=(select auth.uid()) and role='founder'));
