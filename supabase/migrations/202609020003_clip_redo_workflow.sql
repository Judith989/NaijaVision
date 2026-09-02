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
    delete from public.submission_recommendations where submission_id = new.submission_id;
    new.quality_status := 'pending';
    new.human_validation_status := 'pending';
    new.uploaded_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.submit_review_recommendation(
  p_submission_id uuid,
  p_recommendation public.review_decision,
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
  v_not_approved integer;
begin
  if not public.is_reviewer() then raise exception 'Reviewer access required'; end if;
  if p_recommendation = 'rejected' then
    raise exception 'Reviewers must return individual recordings for redo. Only an administrator can reject an entire submission.';
  end if;

  select * into v_submission from public.submissions where id = p_submission_id for update;
  if v_submission.id is null then raise exception 'Submission not found'; end if;
  if v_submission.assigned_reviewer_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'This submission is assigned to another reviewer';
  end if;

  select count(*) into v_total from public.recordings where submission_id = p_submission_id;
  select count(*) into v_approved from public.reviews
    where submission_id = p_submission_id and reviewer_id = auth.uid() and decision = 'approved';
  select count(*) into v_not_approved from public.reviews
    where submission_id = p_submission_id and reviewer_id = auth.uid() and decision <> 'approved';

  if p_recommendation = 'approved' and (v_total = 0 or v_approved <> v_total) then
    raise exception 'Review and approve every recording before recommending approval';
  end if;
  if p_recommendation = 'changes_requested' and v_not_approved = 0 then
    raise exception 'Mark at least one recording for redo first';
  end if;

  insert into public.submission_recommendations(submission_id, reviewer_id, recommendation, comments)
  values (p_submission_id, auth.uid(), p_recommendation, nullif(trim(p_comments), ''))
  on conflict (submission_id) do update set
    reviewer_id = excluded.reviewer_id,
    recommendation = excluded.recommendation,
    comments = excluded.comments,
    updated_at = now();

  perform public.write_audit_event(
    'submission.recommendation', 'submission', p_submission_id::text, null,
    jsonb_build_object('recommendation', p_recommendation, 'comments', p_comments)
  );
end;
$$;

grant execute on function public.submit_review_recommendation(uuid, public.review_decision, text) to authenticated;

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
  v_recommendation public.submission_recommendations;
  v_total integer;
  v_approved integer;
  v_redo integer;
begin
  if not public.is_admin() then raise exception 'Administrator approval required'; end if;

  select * into v_submission from public.submissions where id = p_submission_id for update;
  if v_submission.id is null then raise exception 'Submission not found'; end if;
  select * into v_recommendation from public.submission_recommendations where submission_id = p_submission_id;

  select count(*) into v_total from public.recordings where submission_id = p_submission_id;
  select count(*) into v_approved from public.reviews
    where submission_id = p_submission_id
      and reviewer_id = v_recommendation.reviewer_id
      and decision = 'approved';
  select count(*) into v_redo from public.reviews
    where submission_id = p_submission_id and decision in ('rejected', 'changes_requested');

  if p_decision = 'approved' and (
    v_recommendation.id is null
    or v_recommendation.recommendation <> 'approved'
    or v_total = 0
    or v_approved <> v_total
  ) then
    raise exception 'Final approval requires an approval recommendation and approval of every recording';
  end if;
  if p_decision = 'changes_requested' and v_redo = 0 then
    raise exception 'Mark at least one recording for redo first';
  end if;
  if p_decision = 'rejected' and length(trim(coalesce(p_comments, ''))) < 10 then
    raise exception 'Explain the account-level reason for rejecting the entire submission';
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
  elsif p_decision = 'rejected' then
    update public.payments set status = 'cancelled', updated_at = now()
    where submission_id = p_submission_id and status <> 'paid';
  end if;

  insert into public.notifications(user_id, type, title, message)
  values (
    v_submission.user_id,
    'submission_decision',
    case p_decision when 'approved' then 'Submission approved' when 'rejected' then 'Submission rejected' else 'Recordings need to be redone' end,
    case
      when p_decision = 'changes_requested' then coalesce(nullif(trim(p_comments), ''), 'One or more recordings need to be replaced. Your accepted recordings remain saved.')
      else p_comments
    end
  );

  perform public.write_audit_event(
    'submission.final_decision', 'submission', p_submission_id::text, null,
    jsonb_build_object('decision', p_decision, 'comments', p_comments, 'recommendation', v_recommendation.recommendation)
  );
end;
$$;

grant execute on function public.decide_submission(uuid, public.review_decision, text) to authenticated;
