alter table public.submissions
add column if not exists completed_standard_language_count integer not null default 0,
add column if not exists completed_safe_speech_language_count integer not null default 0;

create or replace function public.completed_submission_language_count(p_submission_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with language_set_progress as (
    select
      case when p.language = 'Yorùbá' then 'Yoruba' else p.language end as language,
      p.safe_speech,
      count(*) filter (where pa.required) as required_count,
      count(r.id) filter (where pa.required) as recorded_count
    from public.prompt_assignments pa
    join public.prompts p on p.id = pa.prompt_id
    left join public.recordings r on r.prompt_assignment_id = pa.id
    where pa.submission_id = p_submission_id
      and p.language in ('Nigerian English', 'Nigerian Pidgin', 'Hausa', 'Igbo', 'Yoruba', 'Yorùbá')
    group by 1, p.safe_speech
  )
  select count(*)::integer
  from language_set_progress
  where required_count > 0 and recorded_count = required_count;
$$;

create or replace function public.completed_standard_language_count(p_submission_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with language_progress as (
    select
      case when p.language = 'Yorùbá' then 'Yoruba' else p.language end as language,
      count(*) filter (where pa.required) as required_count,
      count(r.id) filter (where pa.required) as recorded_count
    from public.prompt_assignments pa
    join public.prompts p on p.id = pa.prompt_id
    left join public.recordings r on r.prompt_assignment_id = pa.id
    where pa.submission_id = p_submission_id
      and not p.safe_speech
      and p.language in ('Nigerian English', 'Nigerian Pidgin', 'Hausa', 'Igbo', 'Yoruba', 'Yorùbá')
    group by 1
  )
  select count(*)::integer from language_progress
  where required_count > 0 and recorded_count = required_count;
$$;

create or replace function public.completed_safe_speech_language_count(p_submission_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with language_progress as (
    select
      case when p.language = 'Yorùbá' then 'Yoruba' else p.language end as language,
      count(*) filter (where pa.required) as required_count,
      count(r.id) filter (where pa.required) as recorded_count
    from public.prompt_assignments pa
    join public.prompts p on p.id = pa.prompt_id
    left join public.recordings r on r.prompt_assignment_id = pa.id
    where pa.submission_id = p_submission_id
      and p.safe_speech
      and p.language in ('Nigerian English', 'Nigerian Pidgin', 'Hausa', 'Igbo', 'Yoruba', 'Yorùbá')
    group by 1
  )
  select count(*)::integer from language_progress
  where required_count > 0 and recorded_count = required_count;
$$;

create or replace function public.apply_per_language_payment_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.compensation_policies;
  v_standard_count integer;
  v_safe_count integer;
begin
  select * into v_policy
  from public.compensation_policies
  where effective_at <= now() and retired_at is null
  order by effective_at desc limit 1;

  if v_policy.pricing_basis = 'per_language' then
    v_standard_count := public.completed_standard_language_count(new.submission_id);
    v_safe_count := public.completed_safe_speech_language_count(new.submission_id);
    new.amount := v_policy.amount * (v_standard_count + v_safe_count);
    new.currency := v_policy.currency;
    update public.submissions
    set compensation_amount = new.amount,
        compensation_currency = new.currency,
        compensation_rate = v_policy.amount,
        compensation_basis = 'per_language_completed',
        completed_language_count = v_standard_count + v_safe_count,
        completed_standard_language_count = v_standard_count,
        completed_safe_speech_language_count = v_safe_count,
        updated_at = now()
    where id = new.submission_id;
  end if;
  return new;
end;
$$;

create or replace function public.refresh_submission_language_earnings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission_id uuid;
  v_standard_count integer;
  v_safe_count integer;
  v_rate numeric(12,2);
begin
  v_submission_id := case when tg_op = 'DELETE' then old.submission_id else new.submission_id end;
  select compensation_rate into v_rate from public.submissions where id = v_submission_id;
  if v_rate is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  v_standard_count := public.completed_standard_language_count(v_submission_id);
  v_safe_count := public.completed_safe_speech_language_count(v_submission_id);
  update public.submissions
  set completed_language_count = v_standard_count + v_safe_count,
      completed_standard_language_count = v_standard_count,
      completed_safe_speech_language_count = v_safe_count,
      compensation_amount = v_rate * (v_standard_count + v_safe_count),
      updated_at = now()
  where id = v_submission_id and compensation_basis = 'per_language_completed';

  update public.payments p
  set amount = v_rate * (v_standard_count + v_safe_count),
      updated_at = now()
  where p.submission_id = v_submission_id and p.status <> 'paid';
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

update public.submissions s
set completed_standard_language_count = public.completed_standard_language_count(s.id),
    completed_safe_speech_language_count = public.completed_safe_speech_language_count(s.id),
    completed_language_count = public.completed_submission_language_count(s.id),
    compensation_amount = s.compensation_rate * public.completed_submission_language_count(s.id),
    updated_at = now()
where s.compensation_basis = 'per_language_completed'
  and s.status <> 'paid';

update public.payments p
set amount = s.compensation_amount,
    updated_at = now()
from public.submissions s
where s.id = p.submission_id
  and p.status <> 'paid';
