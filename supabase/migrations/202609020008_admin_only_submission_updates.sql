drop policy if exists submissions_review_update on public.submissions;
create policy submissions_admin_update
on public.submissions for update to authenticated
using (public.is_admin())
with check (public.is_admin());
