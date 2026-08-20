create table if not exists public.submission_recommendations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  recommendation public.review_decision not null,
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.submission_recommendations enable row level security;

create policy recommendation_assigned_reviewer_read
on public.submission_recommendations for select to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.submissions s
    where s.id = submission_id and s.assigned_reviewer_id = auth.uid()
  )
);

create policy recommendation_admin_all
on public.submission_recommendations for all to authenticated
using (public.is_admin()) with check (public.is_admin());

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
    raise exception 'Mark at least one recording for redo or decline first';
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
begin
  if not public.is_admin() then raise exception 'Administrator approval required'; end if;

  select * into v_submission from public.submissions where id = p_submission_id for update;
  if v_submission.id is null then raise exception 'Submission not found'; end if;
  select * into v_recommendation from public.submission_recommendations where submission_id = p_submission_id;
  if v_recommendation.id is null then raise exception 'A reviewer recommendation is required first'; end if;

  select count(*) into v_total from public.recordings where submission_id = p_submission_id;
  select count(*) into v_approved from public.reviews
    where submission_id = p_submission_id and reviewer_id = v_recommendation.reviewer_id and decision = 'approved';

  if p_decision = 'approved' and (v_recommendation.recommendation <> 'approved' or v_total = 0 or v_approved <> v_total) then
    raise exception 'Final approval requires an approval recommendation and approval of every recording';
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
    coalesce(nullif(trim(p_comments), ''), 'Open NaijaVision to view the latest status of your contribution.')
  );

  perform public.write_audit_event(
    'submission.final_decision', 'submission', p_submission_id::text, null,
    jsonb_build_object('decision', p_decision, 'comments', p_comments, 'recommendation', v_recommendation.recommendation)
  );
end;
$$;

grant execute on function public.decide_submission(uuid, public.review_decision, text) to authenticated;

create or replace function public.replace_compensation_policy(p_amount numeric, p_currency text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter a valid compensation amount'; end if;
  if trim(coalesce(p_currency, '')) = '' then raise exception 'Select a currency'; end if;

  update public.compensation_policies set retired_at = now() where retired_at is null;
  insert into public.compensation_policies(
    name, amount, currency, minimum_accepted_recordings,
    partial_payment_allowed, effective_at, created_by
  ) values (
    'Participant full submission ' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    p_amount, upper(trim(p_currency)), 1, false, now(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.replace_compensation_policy(numeric, text) to authenticated;
