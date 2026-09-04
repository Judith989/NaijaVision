create or replace function public.require_return_recommendation_comments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recommendation = 'changes_requested'
     and length(trim(coalesce(new.comments, ''))) < 10 then
    raise exception 'Add a return comment of at least 10 characters';
  end if;
  return new;
end;
$$;

drop trigger if exists require_return_recommendation_comments on public.submission_recommendations;
create trigger require_return_recommendation_comments
before insert or update of recommendation, comments on public.submission_recommendations
for each row execute function public.require_return_recommendation_comments();

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
  if length(trim(coalesce(p_comments, ''))) < 10 then
    raise exception 'Add a return comment of at least 10 characters for the participant';
  end if;

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
    comments = trim(p_comments),
    admin_review_status = 'participant_returned',
    updated_at = now()
  where id = v_recommendation.id;

  insert into public.notifications(user_id, type, title, message)
  values (v_submission.user_id, 'submission_decision', 'Recordings need to be redone', trim(p_comments));

  perform public.write_audit_event(
    'submission.clips_returned_by_reviewer', 'submission', p_submission_id::text, null,
    jsonb_build_object('reviewer_id', auth.uid(), 'comments', trim(p_comments), 'redo_count', v_redo)
  );
end;
$$;

grant execute on function public.reviewer_return_clips_to_participant(uuid, text) to authenticated;
