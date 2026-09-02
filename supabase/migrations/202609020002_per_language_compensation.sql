alter table public.compensation_policies
add column if not exists pricing_basis text not null default 'full_submission'
check (pricing_basis in ('full_submission', 'per_language'));

create or replace function public.submission_language_count(p_survey_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with survey as (
    select responses from public.surveys where id = p_survey_id
  ), selected_languages as (
    select responses ->> 'primary' as language from survey
    union select responses ->> 'homeLanguage' from survey
    union select responses ->> 'workLanguage' from survey
    union select jsonb_array_elements_text(coalesce(responses -> 'nativeLanguages', '[]'::jsonb)) from survey
    union select jsonb_array_elements_text(coalesce(responses -> 'otherLanguages', '[]'::jsonb)) from survey
    union select jsonb_array_elements_text(coalesce(responses -> 'dailyLanguages', '[]'::jsonb)) from survey
  )
  select greatest(1, count(distinct case when language = 'Yorùbá' then 'Yoruba' else language end))::integer
  from selected_languages
  where language in ('Nigerian English', 'Nigerian Pidgin', 'Hausa', 'Igbo', 'Yoruba', 'Yorùbá');
$$;

create or replace function public.apply_per_language_payment_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions;
  v_policy public.compensation_policies;
  v_language_count integer;
begin
  select * into v_submission from public.submissions where id = new.submission_id;
  select * into v_policy
  from public.compensation_policies
  where effective_at <= now() and retired_at is null
  order by effective_at desc limit 1;

  if v_policy.pricing_basis = 'per_language' then
    v_language_count := public.submission_language_count(v_submission.survey_id);
    new.amount := v_policy.amount * v_language_count;
    new.currency := v_policy.currency;
    update public.submissions
    set compensation_amount = new.amount,
        compensation_currency = new.currency,
        updated_at = now()
    where id = new.submission_id;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_per_language_payment_rate on public.payments;
create trigger apply_per_language_payment_rate
before insert on public.payments
for each row execute function public.apply_per_language_payment_rate();

update public.compensation_policies set retired_at = now() where retired_at is null;

insert into public.compensation_policies(
  name, amount, currency, minimum_accepted_recordings,
  partial_payment_allowed, pricing_basis, effective_at
) values (
  'NGN 500 per selected language', 500, 'NGN', 1,
  false, 'per_language', now()
);

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
    upper(trim(p_currency)) || ' ' || p_amount || ' per selected language',
    p_amount, upper(trim(p_currency)), 1, false, 'per_language', now(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.replace_compensation_policy(numeric, text) to authenticated;
