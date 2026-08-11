create or replace function public.write_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_before jsonb default null,
  p_after jsonb default null
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events(actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after);
$$;

create or replace function public.begin_submission(
  p_consent_version_id uuid,
  p_safe_speech_opt_in boolean,
  p_survey jsonb,
  p_languages text[]
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles;
  v_consent_id uuid;
  v_survey_id uuid;
  v_submission_id uuid;
  v_expected integer;
  v_payout_id uuid;
  v_policy public.compensation_policies;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_profile from public.profiles where user_id = v_user;
  if v_profile.account_status <> 'active' then raise exception 'Account is not active'; end if;
  if exists (
    select 1 from public.submissions
    where user_id = v_user and status not in ('paid', 'rejected', 'withdrawn')
  ) then raise exception 'An active contribution already exists'; end if;

  insert into public.consents(
    user_id, consent_version_id, adult_confirmed, informed_consent,
    public_release_consent, ai_training_consent, safe_speech_opt_in
  ) values (
    v_user, p_consent_version_id, true, true, true, true, p_safe_speech_opt_in
  )
  on conflict (user_id, consent_version_id) do update
  set adult_confirmed = true,
      informed_consent = true,
      public_release_consent = true,
      ai_training_consent = true,
      safe_speech_opt_in = excluded.safe_speech_opt_in,
      consented_at = now(),
      withdrawn_at = null
  returning id into v_consent_id;

  insert into public.surveys(user_id, version, responses)
  values (
    v_user,
    coalesce((select max(version) + 1 from public.surveys where user_id = v_user), 1),
    p_survey
  ) returning id into v_survey_id;

  select count(*) into v_expected
  from public.prompts
  where enabled
    and (not safe_speech or p_safe_speech_opt_in)
    and (
      prompt_type in ('Natural speech', 'Numbers and names')
      or language = any(p_languages)
      or (prompt_type = 'Code-switching' and language_sequence <@ p_languages)
      or (safe_speech and language = 'Code-switched' and cardinality(p_languages) >= 2)
    );

  insert into public.submissions(
    user_id, participant_id, consent_id, survey_id, status, expected_recordings
  ) values (
    v_user, v_profile.participant_id, v_consent_id, v_survey_id, 'recording', v_expected
  ) returning id into v_submission_id;

  insert into public.prompt_assignments(submission_id, prompt_id, sequence_number, required)
  select v_submission_id, p.id, row_number() over (
    order by p.safe_speech, md5(v_submission_id::text || p.id)
  ), true
  from public.prompts p
  where p.enabled
    and (not p.safe_speech or p_safe_speech_opt_in)
    and (
      p.prompt_type in ('Natural speech', 'Numbers and names')
      or p.language = any(p_languages)
      or (p.prompt_type = 'Code-switching' and p.language_sequence <@ p_languages)
      or (p.safe_speech and p.language = 'Code-switched' and cardinality(p_languages) >= 2)
    );

  select id into v_payout_id from public.payout_accounts where user_id = v_user;
  select * into v_policy from public.compensation_policies
  where effective_at <= now() and retired_at is null
  order by effective_at desc limit 1;
  if v_payout_id is null then raise exception 'A verified payout account is required'; end if;
  if v_policy.id is null then raise exception 'No active compensation policy is configured'; end if;

  update public.submissions set
    compensation_amount = v_policy.amount,
    compensation_currency = v_policy.currency
  where id = v_submission_id;

  insert into public.payments(
    submission_id, user_id, payout_account_id, amount, currency, status
  ) values (
    v_submission_id, v_user, v_payout_id, v_policy.amount, v_policy.currency, 'not_eligible'
  );

  perform public.write_audit_event('submission.created', 'submission', v_submission_id::text, null,
    jsonb_build_object('expected_recordings', v_expected, 'safe_speech', p_safe_speech_opt_in));
  return v_submission_id;
end;
$$;

grant execute on function public.begin_submission(uuid, boolean, jsonb, text[]) to authenticated;

create or replace function public.finalize_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions;
  v_count integer;
begin
  select * into v_submission from public.submissions where id = p_submission_id for update;
  if v_submission.user_id <> auth.uid() then raise exception 'Not authorized'; end if;
  if v_submission.status not in ('recording', 'uploading', 'changes_requested', 'resubmitted') then
    raise exception 'Submission cannot be finalized from current state';
  end if;
  select count(*) into v_count from public.recordings where submission_id = p_submission_id;
  if v_count <> v_submission.expected_recordings then
    raise exception 'Expected % recordings but found %', v_submission.expected_recordings, v_count;
  end if;
  update public.submissions
  set status = 'automated_qc', submitted_at = now(), accepted_recordings = v_count, updated_at = now()
  where id = p_submission_id;
  perform public.write_audit_event('submission.finalized', 'submission', p_submission_id::text, null,
    jsonb_build_object('recordings', v_count));
end;
$$;
grant execute on function public.finalize_submission(uuid) to authenticated;

create or replace function public.assign_submission(p_submission_id uuid, p_reviewer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;
  if not exists (select 1 from public.user_roles where user_id = p_reviewer_id and role in ('reviewer', 'admin')) then
    raise exception 'User is not a reviewer';
  end if;
  update public.submissions
  set assigned_reviewer_id = p_reviewer_id, status = 'awaiting_review', updated_at = now()
  where id = p_submission_id and status in ('automated_qc', 'awaiting_review');
  perform public.write_audit_event('submission.assigned', 'submission', p_submission_id::text, null,
    jsonb_build_object('reviewer_id', p_reviewer_id));
end;
$$;
grant execute on function public.assign_submission(uuid, uuid) to authenticated;

create or replace function public.claim_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_reviewer() then raise exception 'Reviewer required'; end if;
  update public.submissions
  set assigned_reviewer_id = auth.uid(), updated_at = now()
  where id = p_submission_id
    and status = 'awaiting_review'
    and (assigned_reviewer_id is null or assigned_reviewer_id = auth.uid());
  if not found then raise exception 'Submission is already assigned or unavailable'; end if;
  perform public.write_audit_event('submission.claimed', 'submission', p_submission_id::text, null,
    jsonb_build_object('reviewer_id', auth.uid()));
end;
$$;
grant execute on function public.claim_submission(uuid) to authenticated;

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
  v_rejected integer;
begin
  if not public.is_reviewer() then raise exception 'Reviewer required'; end if;
  select * into v_submission from public.submissions where id = p_submission_id for update;
  if v_submission.assigned_reviewer_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Submission is assigned to another reviewer';
  end if;
  select count(*) into v_rejected from public.reviews
  where submission_id = p_submission_id and decision <> 'approved';
  if p_decision = 'approved' and v_rejected > 0 then
    raise exception 'Resolve rejected recording reviews before approval';
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

create or replace function public.request_withdrawal(p_submission_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.submissions where id = p_submission_id and user_id = auth.uid()) then
    raise exception 'Submission not found';
  end if;
  insert into public.withdrawal_requests(user_id, submission_id, reason)
  values (auth.uid(), p_submission_id, p_reason) returning id into v_id;
  perform public.write_audit_event('withdrawal.requested', 'submission', p_submission_id::text, null,
    jsonb_build_object('request_id', v_id));
  return v_id;
end;
$$;
grant execute on function public.request_withdrawal(uuid, text) to authenticated;

create or replace function public.assign_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;
  insert into public.user_roles(user_id, role, assigned_by)
  values (p_user_id, p_role, auth.uid())
  on conflict (user_id, role) do nothing;
  update public.profiles set role = p_role, updated_at = now() where user_id = p_user_id;
  perform public.write_audit_event('role.assigned', 'user', p_user_id::text, null, jsonb_build_object('role', p_role));
end;
$$;
grant execute on function public.assign_role(uuid, public.app_role) to authenticated;

create or replace function public.flag_duplicate_recording()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matches integer;
begin
  select count(*) into v_matches
  from public.recordings
  where checksum_sha256 = new.checksum_sha256 and user_id <> new.user_id;
  if v_matches > 0 then
    insert into public.risk_flags(user_id, submission_id, flag_type, score, evidence)
    values (
      new.user_id, new.submission_id, 'duplicate_media_checksum', 1,
      jsonb_build_object('recording_id', new.id, 'matching_recordings', v_matches)
    );
  end if;
  return new;
end;
$$;

create trigger recordings_duplicate_risk
after insert on public.recordings
for each row execute procedure public.flag_duplicate_recording();
