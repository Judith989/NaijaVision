create policy recordings_self_draft_delete
on public.recordings for delete to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.submissions s
    where s.id = submission_id
      and s.status in ('draft', 'recording', 'uploading', 'changes_requested', 'resubmitted')
  )
);

create or replace function public.reset_replaced_recording_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.object_path is distinct from new.object_path then
    delete from public.reviews where recording_id = new.id;
    delete from public.recording_quality where recording_id = new.id;
    new.quality_status := 'pending';
    new.human_validation_status := 'pending';
    new.uploaded_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists reset_replaced_recording_review on public.recordings;
create trigger reset_replaced_recording_review
before update of object_path on public.recordings
for each row execute function public.reset_replaced_recording_review();

create or replace function public.decide_submission(
  p_submission_id uuid,
  p_decision public.review_decision,
  p_comments text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions;
  v_total integer;
  v_approved integer;
  v_rejected integer;
begin
  if not public.is_reviewer() then raise exception 'Reviewer required'; end if;
  select * into v_submission from public.submissions where id = p_submission_id for update;
  if v_submission.assigned_reviewer_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Submission is assigned to another reviewer';
  end if;

  select count(*) into v_total from public.recordings where submission_id = p_submission_id;
  select count(*) into v_approved from public.reviews
  where submission_id = p_submission_id and decision = 'approved';
  select count(*) into v_rejected from public.reviews
  where submission_id = p_submission_id and decision <> 'approved';

  if p_decision = 'approved' and (v_rejected > 0 or v_approved <> v_total) then
    raise exception 'Every recording must be individually approved before the submission can be approved';
  end if;
  if p_decision = 'changes_requested' and v_rejected = 0 then
    raise exception 'Mark at least one recording for redo or decline before returning the submission';
  end if;

  update public.submissions set
    status = case p_decision
      when 'approved' then 'payment_eligible'::public.submission_status
      when 'rejected' then 'rejected'::public.submission_status
      else 'changes_requested'::public.submission_status
    end,
    reviewed_at = now(),
    approved_at = case when p_decision = 'approved' then now() else approved_at end,
    updated_at = now()
  where id = p_submission_id;

  if p_decision = 'approved' then
    update public.payments set status = 'eligible', updated_at = now()
    where submission_id = p_submission_id;
  end if;
  insert into public.notifications(user_id, type, title, message)
  values (
    v_submission.user_id,
    'submission_decision',
    case p_decision when 'approved' then 'Submission approved' when 'rejected' then 'Submission rejected' else 'Changes requested' end,
    coalesce(p_comments, 'Open NaijaVision to view the latest status of your contribution.')
  );
  perform public.write_audit_event('submission.decision', 'submission', p_submission_id::text, null,
    jsonb_build_object('decision', p_decision, 'comments', p_comments));
end;
$$;

grant execute on function public.decide_submission(uuid, public.review_decision, text) to authenticated;
