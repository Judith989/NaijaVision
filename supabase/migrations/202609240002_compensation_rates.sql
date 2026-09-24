-- Agreed rates: NGN 750 per completed language set and NGN 20 per unique reviewed video.

update public.compensation_policies set retired_at = now() where retired_at is null;
insert into public.compensation_policies(
  name, amount, currency, minimum_accepted_recordings,
  partial_payment_allowed, pricing_basis, effective_at
) values (
  'NGN 750 per completed language set', 750, 'NGN', 1,
  false, 'per_language', now()
);

update public.reviewer_compensation_policies set retired_at = now() where retired_at is null;
insert into public.reviewer_compensation_policies(name, amount_per_video, currency, effective_at)
values ('NGN 20 per unique video reviewed', 20, 'NGN', now());

-- Apply the agreed participant rate to existing unpaid per-language work.
update public.submissions
set compensation_rate = 750,
    compensation_amount = 750 * (completed_standard_language_count + completed_safe_speech_language_count),
    compensation_currency = 'NGN',
    updated_at = now()
where compensation_basis = 'per_language_completed'
  and status not in ('payment_processing', 'paid');

update public.payments p
set amount = s.compensation_amount,
    currency = 'NGN',
    updated_at = now()
from public.submissions s
where s.id = p.submission_id and p.status not in ('processing', 'paid');

-- Apply the reviewer rate to existing unpaid review earnings.
update public.reviewer_payments
set rate_per_video = 20,
    amount = reviewed_video_count * 20,
    currency = 'NGN',
    updated_at = now()
where status not in ('processing', 'paid');

create or replace function public.replace_reviewer_compensation_policy(p_amount numeric, p_currency text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter a valid reviewer rate'; end if;
  if trim(coalesce(p_currency, '')) = '' then raise exception 'Select a currency'; end if;
  update public.reviewer_compensation_policies set retired_at = now() where retired_at is null;
  insert into public.reviewer_compensation_policies(name, amount_per_video, currency, effective_at, created_by)
  values (
    upper(trim(p_currency)) || ' ' || p_amount || ' per unique video reviewed',
    p_amount, upper(trim(p_currency)), now(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.replace_reviewer_compensation_policy(numeric, text) from public, anon;
grant execute on function public.replace_reviewer_compensation_policy(numeric, text) to authenticated;
