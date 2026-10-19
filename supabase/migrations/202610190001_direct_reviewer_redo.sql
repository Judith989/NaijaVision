-- Let the assigned reviewer return marked clips directly to the participant.
-- Administrator approval is still required for final submission approval and payment.
create or replace function public.reviewer_return_clips_to_participant(
  p_submission_id uuid,
  p_comments text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions;
  v_redo integer;
begin
  if not public.is_reviewer() then raise exception 'Reviewer access required'; end if;
  if length(trim(coalesce(p_comments, ''))) < 10 then
    raise exception 'Add a return comment of at least 10 characters for the participant';
  end if;

  select * into v_submission
  from public.submissions
  where id = p_submission_id
  for update;

  if v_submission.id is null then raise exception 'Submission not found'; end if;
  if v_submission.assigned_reviewer_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'This submission is assigned to another reviewer';
  end if;
  if v_submission.status not in ('automated_qc', 'awaiting_review', 'resubmitted') then
    raise exception 'This submission cannot currently be returned to the participant';
  end if;

  select count(*) into v_redo
  from public.reviews
  where submission_id = p_submission_id
    and reviewer_id = auth.uid()
    and decision in ('rejected', 'changes_requested');

  if v_redo = 0 then raise exception 'Mark at least one recording for redo first'; end if;

  update public.submissions set
    status = 'changes_requested'::public.submission_status,
    reviewed_at = now(),
    updated_at = now()
  where id = p_submission_id;

  insert into public.submission_recommendations(
    submission_id, reviewer_id, recommendation, comments, admin_review_status, admin_feedback, updated_at
  ) values (
    p_submission_id, auth.uid(), 'changes_requested', trim(p_comments), 'participant_returned', null, now()
  )
  on conflict (submission_id) do update set
    reviewer_id = excluded.reviewer_id,
    recommendation = excluded.recommendation,
    comments = excluded.comments,
    admin_review_status = 'participant_returned',
    admin_feedback = null,
    updated_at = now();

  insert into public.notifications(user_id, type, title, message)
  values (
    v_submission.user_id,
    'submission_decision',
    'Recordings need to be redone',
    trim(p_comments)
  );

  perform public.write_audit_event(
    'submission.clips_returned_directly_by_reviewer',
    'submission',
    p_submission_id::text,
    null,
    jsonb_build_object('reviewer_id', auth.uid(), 'comments', trim(p_comments), 'redo_count', v_redo)
  );
end;
$$;

revoke all on function public.reviewer_return_clips_to_participant(uuid, text) from public, anon;
grant execute on function public.reviewer_return_clips_to_participant(uuid, text) to authenticated;
