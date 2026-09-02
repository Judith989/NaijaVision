alter table public.submissions
add column if not exists compensation_rate numeric(12,2),
add column if not exists compensation_basis text,
add column if not exists completed_language_count integer not null default 0;

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
    v_language_count := public.completed_submission_language_count(new.submission_id);
    new.amount := v_policy.amount * v_language_count;
    new.currency := v_policy.currency;
    update public.submissions
    set compensation_amount = new.amount,
        compensation_currency = new.currency,
        compensation_rate = v_policy.amount,
        compensation_basis = 'per_language_completed',
        completed_language_count = v_language_count,
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
  v_count integer;
  v_rate numeric(12,2);
begin
  v_submission_id := case when tg_op = 'DELETE' then old.submission_id else new.submission_id end;
  select compensation_rate into v_rate from public.submissions where id = v_submission_id;
  if v_rate is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  v_count := public.completed_submission_language_count(v_submission_id);
  update public.submissions
  set completed_language_count = v_count,
      compensation_amount = v_rate * v_count,
      updated_at = now()
  where id = v_submission_id and compensation_basis = 'per_language_completed';

  update public.payments p
  set amount = v_rate * v_count,
      updated_at = now()
  where p.submission_id = v_submission_id and p.status <> 'paid';
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists refresh_submission_language_earnings on public.recordings;
create trigger refresh_submission_language_earnings
after insert or update of language or delete on public.recordings
for each row execute function public.refresh_submission_language_earnings();

create table if not exists public.reviewer_compensation_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  amount_per_video numeric(12,2) not null check (amount_per_video >= 0),
  currency text not null,
  effective_at timestamptz not null default now(),
  retired_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.reviewer_payments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  payout_account_id uuid references public.payout_accounts(id),
  reviewed_video_count integer not null default 0 check (reviewed_video_count >= 0),
  rate_per_video numeric(12,2) not null check (rate_per_video >= 0),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null,
  status public.payment_status not null default 'not_eligible',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, reviewer_id)
);

alter table public.reviewer_compensation_policies enable row level security;
alter table public.reviewer_payments enable row level security;

create policy reviewer_policy_staff_read on public.reviewer_compensation_policies
for select to authenticated using (public.is_reviewer());
create policy reviewer_policy_admin_all on public.reviewer_compensation_policies
for all using (public.is_admin()) with check (public.is_admin());
create policy reviewer_payments_self_read on public.reviewer_payments
for select using (reviewer_id = auth.uid());
create policy reviewer_payments_admin_all on public.reviewer_payments
for all using (public.is_admin()) with check (public.is_admin());

insert into public.reviewer_compensation_policies(name, amount_per_video, currency)
values ('NGN 25 per unique video reviewed', 25, 'NGN')
on conflict (name) do nothing;

create or replace function public.record_reviewer_earnings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.reviewer_compensation_policies;
  v_count integer;
  v_payout uuid;
begin
  select * into v_policy from public.reviewer_compensation_policies
  where effective_at <= now() and retired_at is null
  order by effective_at desc limit 1;
  if v_policy.id is null then return new; end if;

  select count(distinct recording_id) into v_count
  from public.reviews
  where submission_id = new.submission_id and reviewer_id = new.reviewer_id;
  select id into v_payout from public.payout_accounts
  where user_id = new.reviewer_id and verified_at is not null limit 1;

  insert into public.reviewer_payments(
    submission_id, reviewer_id, payout_account_id, reviewed_video_count,
    rate_per_video, amount, currency, status
  ) values (
    new.submission_id, new.reviewer_id, v_payout, v_count,
    v_policy.amount_per_video, v_policy.amount_per_video * v_count,
    v_policy.currency, 'eligible'
  ) on conflict (submission_id, reviewer_id) do update set
    payout_account_id = coalesce(excluded.payout_account_id, public.reviewer_payments.payout_account_id),
    reviewed_video_count = excluded.reviewed_video_count,
    rate_per_video = excluded.rate_per_video,
    amount = excluded.amount,
    currency = excluded.currency,
    status = case when public.reviewer_payments.status = 'paid' then 'paid'::public.payment_status else 'eligible'::public.payment_status end,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists record_reviewer_earnings on public.submission_recommendations;
create trigger record_reviewer_earnings
after insert or update on public.submission_recommendations
for each row execute function public.record_reviewer_earnings();

create or replace function public.set_reviewer_payment_status(p_payment_id uuid, p_status public.payment_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('eligible', 'processing', 'paid', 'failed', 'cancelled') then
    raise exception 'Unsupported reviewer payment status';
  end if;
  update public.reviewer_payments set
    status = p_status,
    approved_by = case when p_status in ('processing', 'paid') then auth.uid() else approved_by end,
    approved_at = case when p_status in ('processing', 'paid') then coalesce(approved_at, now()) else approved_at end,
    paid_at = case when p_status = 'paid' then now() else paid_at end,
    updated_at = now()
  where id = p_payment_id;
  if not found then raise exception 'Reviewer payment not found'; end if;
end;
$$;

grant execute on function public.set_reviewer_payment_status(uuid, public.payment_status) to authenticated;

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
