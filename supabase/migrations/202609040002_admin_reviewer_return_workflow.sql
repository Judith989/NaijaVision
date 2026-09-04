alter table public.submission_recommendations
  add column if not exists admin_review_status text not null default 'pending'
    check (admin_review_status in ('pending', 'returned', 'accepted', 'participant_returned')),
  add column if not exists admin_feedback text,
  add column if not exists admin_reviewed_by uuid references auth.users(id),
  add column if not exists admin_reviewed_at timestamptz;

create or replace function public.return_recommendation_to_reviewer(
  p_submission_id uuid,
  p_feedback text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recommendation public.submission_recommendations;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if length(trim(coalesce(p_feedback, ''))) < 10 then
    raise exception 'Explain what the reviewer needs to correct';
  end if;

  select * into v_recommendation
  from public.submission_recommendations
  where submission_id = p_submission_id
  for update;
  if v_recommendation.id is null then raise exception 'A reviewer recommendation is required first'; end if;

  update public.submission_recommendations set
    admin_review_status = 'returned',
    admin_feedback = trim(p_feedback),
    admin_reviewed_by = auth.uid(),
    admin_reviewed_at = now(),
    updated_at = now()
  where id = v_recommendation.id;

  insert into public.notifications(user_id, type, title, message)
  values (v_recommendation.reviewer_id, 'review_returned', 'Review returned by administrator', trim(p_feedback));

  perform public.write_audit_event(
    'submission.recommendation_returned', 'submission', p_submission_id::text, null,
    jsonb_build_object('reviewer_id', v_recommendation.reviewer_id, 'feedback', trim(p_feedback))
  );
end;
$$;

grant execute on function public.return_recommendation_to_reviewer(uuid, text) to authenticated;

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
  v_recommendation public.submission_recommendations;
  v_redo integer;
begin
  if not public.is_reviewer() then raise exception 'Reviewer access required'; end if;

  select * into v_submission from public.submissions where id = p_submission_id for update;
  if v_submission.id is null then raise exception 'Submission not found'; end if;
  if v_submission.assigned_reviewer_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'This submission is assigned to another reviewer';
  end if;

  select * into v_recommendation
  from public.submission_recommendations
  where submission_id = p_submission_id
  for update;
  if v_recommendation.id is null or v_recommendation.admin_review_status <> 'returned' then
    raise exception 'An administrator must return this review before you can send clips to the participant';
  end if;

  select count(*) into v_redo from public.reviews
  where submission_id = p_submission_id
    and reviewer_id = auth.uid()
    and decision in ('rejected', 'changes_requested');
  if v_redo = 0 then raise exception 'Mark at least one recording for redo first'; end if;

  update public.submissions set
    status = 'changes_requested'::public.submission_status,
    reviewed_at = now(),
    updated_at = now()
  where id = p_submission_id;

  update public.submission_recommendations set
    recommendation = 'changes_requested',
    comments = nullif(trim(p_comments), ''),
    admin_review_status = 'participant_returned',
    updated_at = now()
  where id = v_recommendation.id;

  insert into public.notifications(user_id, type, title, message)
  values (
    v_submission.user_id,
    'submission_decision',
    'Recordings need to be redone',
    coalesce(nullif(trim(p_comments), ''), 'One or more recordings need to be replaced. Your accepted recordings remain saved.')
  );

  perform public.write_audit_event(
    'submission.clips_returned_by_reviewer', 'submission', p_submission_id::text, null,
    jsonb_build_object('reviewer_id', auth.uid(), 'comments', p_comments, 'redo_count', v_redo)
  );
end;
$$;

grant execute on function public.reviewer_return_clips_to_participant(uuid, text) to authenticated;

create or replace function public.reset_recommendation_admin_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.admin_review_status = old.admin_review_status
     and (old.recommendation is distinct from new.recommendation
       or old.comments is distinct from new.comments) then
    new.admin_review_status := 'pending';
    new.admin_feedback := null;
    new.admin_reviewed_by := null;
    new.admin_reviewed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reset_recommendation_admin_review on public.submission_recommendations;
create trigger reset_recommendation_admin_review
before update of recommendation, comments on public.submission_recommendations
for each row execute function public.reset_recommendation_admin_review();

create or replace function public.mark_recommendation_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('payment_eligible', 'approved', 'rejected')
     and old.status is distinct from new.status then
    update public.submission_recommendations set
      admin_review_status = 'accepted',
      admin_reviewed_by = auth.uid(),
      admin_reviewed_at = now(),
      updated_at = now()
    where submission_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists mark_recommendation_accepted on public.submissions;
create trigger mark_recommendation_accepted
after update of status on public.submissions
for each row execute function public.mark_recommendation_accepted();
