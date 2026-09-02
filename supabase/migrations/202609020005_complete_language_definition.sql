create or replace function public.completed_submission_language_count(p_submission_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with language_progress as (
    select case when p.language = 'Yorùbá' then 'Yoruba' else p.language end as language,
      count(*) filter (where pa.required) as required_count,
      count(r.id) filter (where pa.required) as recorded_count
    from public.prompt_assignments pa
    join public.prompts p on p.id = pa.prompt_id
    left join public.recordings r on r.prompt_assignment_id = pa.id
    where pa.submission_id = p_submission_id
      and p.language in ('Nigerian English', 'Nigerian Pidgin', 'Hausa', 'Igbo', 'Yoruba', 'Yorùbá')
    group by 1
  )
  select count(*)::integer from language_progress
  where required_count > 0 and recorded_count = required_count;
$$;

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
    partial_payment_allowed, pricing_basis, effective_at, created_by
  ) values (
    upper(trim(p_currency)) || ' ' || p_amount || ' per completed language',
    p_amount, upper(trim(p_currency)), 1, false, 'per_language', now(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;
