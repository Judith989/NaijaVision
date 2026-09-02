drop policy if exists submissions_self_read on public.submissions;
create policy submissions_owner_admin_or_assigned_reviewer_read
on public.submissions for select to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or assigned_reviewer_id = auth.uid()
);

drop policy if exists assignments_self_read on public.prompt_assignments;
create policy assignments_owner_admin_or_assigned_reviewer_read
on public.prompt_assignments for select to authenticated
using (
  exists (
    select 1 from public.submissions s
    where s.id = submission_id
      and (
        s.user_id = auth.uid()
        or public.is_admin()
        or s.assigned_reviewer_id = auth.uid()
      )
  )
);

revoke execute on function public.claim_submission(uuid) from public, anon, authenticated;
