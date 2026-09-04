create or replace function public.ensure_prompt_assignment(
  p_submission_id uuid,
  p_prompt_id text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_safe_speech boolean;
  v_safe_speech_opt_in boolean;
  v_expected integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1 from public.submissions
    where id = p_submission_id
      and user_id = auth.uid()
      and status in ('draft', 'recording', 'uploading', 'changes_requested', 'resubmitted')
  ) then
    raise exception 'Editable contribution not found';
  end if;

  select p.safe_speech, c.safe_speech_opt_in
  into v_safe_speech, v_safe_speech_opt_in
  from public.prompts p
  cross join public.submissions s
  join public.consents c on c.id = s.consent_id
  where p.id = p_prompt_id
    and p.enabled
    and s.id = p_submission_id;

  if v_safe_speech is null then raise exception 'Prompt is unavailable'; end if;
  if v_safe_speech and not coalesce(v_safe_speech_opt_in, false) then
    raise exception 'NaijaSafeSpeech consent is required for this prompt';
  end if;

  select id into v_assignment_id
  from public.prompt_assignments
  where submission_id = p_submission_id and prompt_id = p_prompt_id;

  if v_assignment_id is null then
    insert into public.prompt_assignments(submission_id, prompt_id, sequence_number, required)
    values (
      p_submission_id,
      p_prompt_id,
      coalesce((select max(sequence_number) + 1 from public.prompt_assignments where submission_id = p_submission_id), 1),
      true
    )
    returning id into v_assignment_id;
  end if;

  select count(*) into v_expected
  from public.prompt_assignments
  where submission_id = p_submission_id and required;

  update public.submissions
  set expected_recordings = v_expected,
      updated_at = now()
  where id = p_submission_id and user_id = auth.uid();

  return v_assignment_id;
end;
$$;

grant execute on function public.ensure_prompt_assignment(uuid, text) to authenticated;
