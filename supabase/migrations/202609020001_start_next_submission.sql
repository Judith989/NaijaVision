create or replace function public.start_next_submission()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_previous public.submissions;
  v_consent public.consents;
  v_payout_id uuid;
  v_policy public.compensation_policies;
  v_submission_id uuid;
  v_expected integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  if exists (
    select 1 from public.submissions
    where user_id = v_user and status not in ('paid', 'rejected', 'withdrawn')
  ) then
    raise exception 'An active contribution already exists';
  end if;

  select * into v_previous
  from public.submissions
  where user_id = v_user and status in ('paid', 'rejected', 'withdrawn')
  order by created_at desc
  limit 1;

  if v_previous.id is null then raise exception 'No completed contribution setup was found'; end if;

  select * into v_consent from public.consents where id = v_previous.consent_id;
  if v_consent.id is null or v_consent.withdrawn_at is not null then
    raise exception 'Consent renewal required';
  end if;
  if not exists (
    select 1 from public.consent_versions
    where id = v_consent.consent_version_id and retired_at is null and effective_at <= now()
  ) then
    raise exception 'Consent renewal required';
  end if;

  select id into v_payout_id
  from public.payout_accounts
  where user_id = v_user and verified_at is not null;
  if v_payout_id is null then raise exception 'A verified payout account is required'; end if;

  select * into v_policy
  from public.compensation_policies
  where effective_at <= now() and retired_at is null
  order by effective_at desc
  limit 1;
  if v_policy.id is null then raise exception 'No active compensation policy is configured'; end if;

  select count(*) into v_expected
  from public.prompt_assignments
  where submission_id = v_previous.id and required;
  if v_expected = 0 then raise exception 'The previous prompt assignment could not be restored'; end if;

  insert into public.submissions(
    user_id, participant_id, consent_id, survey_id, status,
    expected_recordings, compensation_amount, compensation_currency
  ) values (
    v_user, v_previous.participant_id, v_previous.consent_id, v_previous.survey_id,
    'recording', v_expected, v_policy.amount, v_policy.currency
  ) returning id into v_submission_id;

  insert into public.prompt_assignments(submission_id, prompt_id, sequence_number, required)
  select v_submission_id, prompt_id, sequence_number, required
  from public.prompt_assignments
  where submission_id = v_previous.id;

  insert into public.payments(
    submission_id, user_id, payout_account_id, amount, currency, status
  ) values (
    v_submission_id, v_user, v_payout_id, v_policy.amount, v_policy.currency, 'not_eligible'
  );

  perform public.write_audit_event(
    'submission.started_from_saved_setup', 'submission', v_submission_id::text, null,
    jsonb_build_object('previous_submission_id', v_previous.id, 'expected_recordings', v_expected)
  );

  return v_submission_id;
end;
$$;

grant execute on function public.start_next_submission() to authenticated;
