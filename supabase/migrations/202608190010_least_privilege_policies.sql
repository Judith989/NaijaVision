drop policy if exists submissions_self_draft_update on public.submissions;

drop policy if exists recordings_self_read on public.recordings;
create policy recordings_owner_or_assigned_staff_read
on public.recordings for select to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.submissions s
    where s.id = submission_id and s.assigned_reviewer_id = auth.uid()
  )
);

drop policy if exists recordings_self_insert on public.recordings;
create policy recordings_owner_insert
on public.recordings for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.submissions s
    where s.id = submission_id
      and s.user_id = auth.uid()
      and s.status in ('draft', 'recording', 'uploading', 'changes_requested', 'resubmitted')
  )
  and exists (
    select 1 from public.prompt_assignments pa
    where pa.id = prompt_assignment_id and pa.submission_id = submission_id
  )
);

drop policy if exists recordings_self_draft_update on public.recordings;
create policy recordings_owner_editable_update
on public.recordings for update to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.submissions s
    where s.id = submission_id
      and s.user_id = auth.uid()
      and s.status in ('draft', 'recording', 'uploading', 'changes_requested', 'resubmitted')
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.submissions s
    where s.id = submission_id
      and s.user_id = auth.uid()
      and s.status in ('draft', 'recording', 'uploading', 'changes_requested', 'resubmitted')
  )
);

drop policy if exists reviews_reviewer_all on public.reviews;
create policy reviews_assigned_staff_all
on public.reviews for all to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.submissions s
    where s.id = submission_id and s.assigned_reviewer_id = auth.uid()
  )
)
with check (
  reviewer_id = auth.uid()
  and (
    public.is_admin()
    or exists (
      select 1 from public.submissions s
      where s.id = submission_id and s.assigned_reviewer_id = auth.uid()
    )
  )
);

drop policy if exists raw_recordings_owner_read on storage.objects;
create policy raw_recordings_owner_or_assigned_staff_read
on storage.objects for select to authenticated
using (
  bucket_id = 'raw-recordings'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
    or exists (
      select 1 from public.submissions s
      where s.id::text = (storage.foldername(name))[2]
        and s.assigned_reviewer_id = auth.uid()
    )
  )
);

drop policy if exists consents_self_read on public.consents;
create policy consents_owner_or_assigned_staff_read
on public.consents for select to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.submissions s
    where s.consent_id = consents.id and s.assigned_reviewer_id = auth.uid()
  )
);

drop policy if exists surveys_self_all on public.surveys;
create policy surveys_owner_all
on public.surveys for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
create policy surveys_assigned_staff_read
on public.surveys for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.submissions s
    where s.survey_id = surveys.id and s.assigned_reviewer_id = auth.uid()
  )
);
