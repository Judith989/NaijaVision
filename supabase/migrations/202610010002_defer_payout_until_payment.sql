alter table public.payments alter column payout_account_id drop not null;

create or replace function public.attach_verified_payout_to_pending_payments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verified_at is not null then
    update public.payments
    set payout_account_id = new.id, updated_at = now()
    where user_id = new.user_id
      and status not in ('processing', 'paid');

    update public.reviewer_payments
    set payout_account_id = new.id, updated_at = now()
    where reviewer_id = new.user_id
      and status not in ('processing', 'paid');
  end if;
  return new;
end;
$$;

drop trigger if exists attach_verified_payout_to_pending_payments on public.payout_accounts;
create trigger attach_verified_payout_to_pending_payments
after insert or update of verified_at on public.payout_accounts
for each row execute function public.attach_verified_payout_to_pending_payments();

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
  if exists (select 1 from public.submissions where user_id = v_user and status not in ('paid', 'rejected', 'withdrawn')) then
    raise exception 'An active contribution already exists';
  end if;

  insert into public.consents(user_id, consent_version_id, adult_confirmed, informed_consent, public_release_consent, ai_training_consent, safe_speech_opt_in)
  values (v_user, p_consent_version_id, true, true, true, true, p_safe_speech_opt_in)
  on conflict (user_id, consent_version_id) do update set
    adult_confirmed=true, informed_consent=true, public_release_consent=true,
    ai_training_consent=true, safe_speech_opt_in=excluded.safe_speech_opt_in,
    consented_at=now(), withdrawn_at=null
  returning id into v_consent_id;

  insert into public.surveys(user_id, version, responses)
  values (v_user, coalesce((select max(version)+1 from public.surveys where user_id=v_user),1), p_survey)
  returning id into v_survey_id;

  select count(*) into v_expected from public.prompts
  where enabled and (not safe_speech or p_safe_speech_opt_in) and (
    prompt_type in ('Natural speech','Numbers and names') or language=any(p_languages)
    or (prompt_type='Code-switching' and language_sequence <@ p_languages)
    or (safe_speech and language='Code-switched' and cardinality(p_languages)>=2)
  );

  insert into public.submissions(user_id, participant_id, consent_id, survey_id, status, expected_recordings)
  values (v_user, v_profile.participant_id, v_consent_id, v_survey_id, 'recording', v_expected)
  returning id into v_submission_id;

  insert into public.prompt_assignments(submission_id,prompt_id,sequence_number,required)
  select v_submission_id,p.id,row_number() over (order by p.safe_speech,md5(v_submission_id::text||p.id)),true
  from public.prompts p where p.enabled and (not p.safe_speech or p_safe_speech_opt_in) and (
    p.prompt_type in ('Natural speech','Numbers and names') or p.language=any(p_languages)
    or (p.prompt_type='Code-switching' and p.language_sequence <@ p_languages)
    or (p.safe_speech and p.language='Code-switched' and cardinality(p_languages)>=2)
  );

  select id into v_payout_id from public.payout_accounts where user_id=v_user and verified_at is not null;
  select * into v_policy from public.compensation_policies where effective_at<=now() and retired_at is null order by effective_at desc limit 1;
  if v_policy.id is null then raise exception 'No active compensation policy is configured'; end if;

  update public.submissions set compensation_amount=v_policy.amount, compensation_currency=v_policy.currency where id=v_submission_id;
  insert into public.payments(submission_id,user_id,payout_account_id,amount,currency,status)
  values (v_submission_id,v_user,v_payout_id,v_policy.amount,v_policy.currency,'not_eligible');
  perform public.write_audit_event('submission.created','submission',v_submission_id::text,null,jsonb_build_object('expected_recordings',v_expected,'safe_speech',p_safe_speech_opt_in));
  return v_submission_id;
end;
$$;
grant execute on function public.begin_submission(uuid,boolean,jsonb,text[]) to authenticated;

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
  if exists (select 1 from public.submissions where user_id=v_user and status not in ('paid','rejected','withdrawn')) then raise exception 'An active contribution already exists'; end if;
  select * into v_previous from public.submissions where user_id=v_user and status in ('paid','rejected','withdrawn') order by created_at desc limit 1;
  if v_previous.id is null then raise exception 'No completed contribution setup was found'; end if;
  select * into v_consent from public.consents where id=v_previous.consent_id;
  if v_consent.id is null or v_consent.withdrawn_at is not null then raise exception 'Consent renewal required'; end if;
  if not exists (select 1 from public.consent_versions where id=v_consent.consent_version_id and retired_at is null and effective_at<=now()) then raise exception 'Consent renewal required'; end if;
  select id into v_payout_id from public.payout_accounts where user_id=v_user and verified_at is not null;
  select * into v_policy from public.compensation_policies where effective_at<=now() and retired_at is null order by effective_at desc limit 1;
  if v_policy.id is null then raise exception 'No active compensation policy is configured'; end if;
  select count(*) into v_expected from public.prompt_assignments where submission_id=v_previous.id and required;
  if v_expected=0 then raise exception 'The previous prompt assignment could not be restored'; end if;
  insert into public.submissions(user_id,participant_id,consent_id,survey_id,status,expected_recordings,compensation_amount,compensation_currency)
  values(v_user,v_previous.participant_id,v_previous.consent_id,v_previous.survey_id,'recording',v_expected,v_policy.amount,v_policy.currency)
  returning id into v_submission_id;
  insert into public.prompt_assignments(submission_id,prompt_id,sequence_number,required)
  select v_submission_id,prompt_id,sequence_number,required from public.prompt_assignments where submission_id=v_previous.id;
  insert into public.payments(submission_id,user_id,payout_account_id,amount,currency,status)
  values(v_submission_id,v_user,v_payout_id,v_policy.amount,v_policy.currency,'not_eligible');
  perform public.write_audit_event('submission.started_from_saved_setup','submission',v_submission_id::text,null,jsonb_build_object('previous_submission_id',v_previous.id,'expected_recordings',v_expected));
  return v_submission_id;
end;
$$;
grant execute on function public.start_next_submission() to authenticated;
