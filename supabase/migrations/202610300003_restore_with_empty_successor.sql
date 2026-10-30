-- A rejected submission may have an empty successor created when its participant
-- reopened the contribution flow. Administrators can explicitly withdraw only
-- that empty successor while restoring the reviewed submission. A successor
-- containing even one recording is never modified by this function.
create or replace function public.restore_rejected_submission(
  p_submission_id uuid,
  p_reason text,
  p_withdraw_empty_successor boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions;
  v_recommendation public.submission_recommendations;
  v_recording_count integer;
  v_other_submission_id uuid;
  v_other_recording_count integer;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Explain why this rejected submission is being restored';
  end if;

  select * into v_submission from public.submissions
  where id = p_submission_id for update;
  if v_submission.id is null then raise exception 'Submission not found'; end if;
  if v_submission.status <> 'rejected' then
    raise exception 'Only a rejected submission can be restored';
  end if;
  select count(*) into v_recording_count from public.recordings
  where submission_id = p_submission_id;
  if v_recording_count = 0 then raise exception 'This submission has no recordings to restore'; end if;

  select id into v_other_submission_id from public.submissions
  where user_id = v_submission.user_id
    and id <> p_submission_id
    and status not in ('paid', 'rejected', 'withdrawn')
  order by created_at desc limit 1 for update;
  if v_other_submission_id is not null then
    select count(*) into v_other_recording_count from public.recordings
    where submission_id = v_other_submission_id;
    if v_other_recording_count > 0 then
      raise exception 'RESTORE_BLOCKED_RECORDED_SUCCESSOR:%:%', v_other_submission_id, v_other_recording_count;
    end if;
    if not coalesce(p_withdraw_empty_successor, false) then
      raise exception 'RESTORE_CONFIRM_EMPTY_SUCCESSOR:%', v_other_submission_id;
    end if;
    update public.submissions set status = 'withdrawn', updated_at = now()
    where id = v_other_submission_id;
    perform public.write_audit_event(
      'submission.empty_successor_withdrawn_for_restore', 'submission', v_other_submission_id::text,
      null, jsonb_build_object('restored_submission_id', p_submission_id, 'recording_count', 0)
    );
  end if;

  select * into v_recommendation from public.submission_recommendations
  where submission_id = p_submission_id for update;
  if v_recommendation.id is null then
    raise exception 'The original reviewer recommendation is unavailable';
  end if;
  update public.submission_recommendations set
    admin_review_status = 'pending', admin_feedback = null,
    admin_reviewed_by = null, admin_reviewed_at = null, updated_at = now()
  where id = v_recommendation.id;
  update public.submissions set
    status = 'automated_qc', reviewed_at = null, approved_at = null, updated_at = now()
  where id = p_submission_id;
  update public.payments set status = 'not_eligible', updated_at = now()
  where submission_id = p_submission_id and status = 'cancelled';

  insert into public.notifications(user_id, type, title, message)
  values (v_submission.user_id, 'submission_restored', 'Submission restored for review',
    'Your previously rejected submission has been restored to the administrator approval queue.');
  if v_submission.assigned_reviewer_id is not null then
    insert into public.notifications(user_id, type, title, message)
    values (v_submission.assigned_reviewer_id, 'submission_restored', 'Reviewed submission restored',
      'A submission you reviewed has been restored to the administrator approval queue. No repeat review is required unless it is returned to you.');
  end if;
  perform public.write_audit_event(
    'submission.restored', 'submission', p_submission_id::text,
    jsonb_build_object('status', 'rejected'),
    jsonb_build_object('status', 'automated_qc', 'reason', trim(p_reason),
      'recording_count', v_recording_count, 'withdrawn_empty_successor', v_other_submission_id)
  );
end;
$$;

revoke all on function public.restore_rejected_submission(uuid,text,boolean) from public, anon;
grant execute on function public.restore_rejected_submission(uuid,text,boolean) to authenticated;
