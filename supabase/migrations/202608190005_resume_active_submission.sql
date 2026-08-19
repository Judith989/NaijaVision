create or replace function public.resume_submission(
  p_submission_id uuid,
  p_safe_speech_opt_in boolean,
  p_survey jsonb,
  p_languages text[]
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions;
  v_recording_count integer;
  v_expected integer;
begin
  select * into v_submission
  from public.submissions
  where id = p_submission_id and user_id = auth.uid()
  for update;

  if v_submission.id is null then raise exception 'Contribution not found'; end if;
  if v_submission.status not in ('draft', 'recording', 'uploading', 'changes_requested', 'resubmitted') then
    raise exception 'This contribution can no longer be edited';
  end if;

  update public.surveys
  set responses = p_survey
  where id = v_submission.survey_id and user_id = auth.uid();

  update public.consents
  set safe_speech_opt_in = p_safe_speech_opt_in,
      consented_at = now()
  where id = v_submission.consent_id and user_id = auth.uid();

  select count(*) into v_recording_count
  from public.recordings
  where submission_id = p_submission_id;

  if v_recording_count = 0 then
    delete from public.prompt_assignments where submission_id = p_submission_id;

    insert into public.prompt_assignments(submission_id, prompt_id, sequence_number, required)
    select p_submission_id, p.id, row_number() over (
      order by p.safe_speech, md5(p_submission_id::text || p.id)
    ), true
    from public.prompts p
    where p.enabled
      and (not p.safe_speech or p_safe_speech_opt_in)
      and (
        p.prompt_type = 'Natural speech'
        or p.language = any(p_languages)
        or (p.prompt_type = 'Code-switching' and p.language_sequence <@ p_languages)
      );

    select count(*) into v_expected
    from public.prompt_assignments
    where submission_id = p_submission_id;

    update public.submissions
    set expected_recordings = v_expected,
        status = 'recording',
        updated_at = now()
    where id = p_submission_id;
  end if;

  perform public.write_audit_event(
    'submission.resumed',
    'submission',
    p_submission_id::text,
    null,
    jsonb_build_object('expected_recordings', coalesce(v_expected, v_submission.expected_recordings))
  );
  return p_submission_id;
end;
$$;

grant execute on function public.resume_submission(uuid, boolean, jsonb, text[]) to authenticated;
