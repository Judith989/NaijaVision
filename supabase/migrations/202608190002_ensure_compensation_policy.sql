insert into public.compensation_policies (
  name,
  amount,
  currency,
  minimum_accepted_recordings,
  partial_payment_allowed,
  effective_at,
  retired_at
) values (
  'NaijaVision pilot base compensation',
  4000,
  'NGN',
  1,
  false,
  now(),
  null
)
on conflict (name) do update set
  amount = excluded.amount,
  currency = excluded.currency,
  minimum_accepted_recordings = excluded.minimum_accepted_recordings,
  partial_payment_allowed = excluded.partial_payment_allowed,
  effective_at = least(public.compensation_policies.effective_at, now()),
  retired_at = null;

create or replace function public.apply_safe_speech_compensation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_safe_speech boolean := false;
begin
  select coalesce(c.safe_speech_opt_in, false)
  into v_safe_speech
  from public.submissions s
  join public.consents c on c.id = s.consent_id
  where s.id = new.submission_id;

  if v_safe_speech then
    new.amount := new.amount + 1000;
    update public.submissions
    set compensation_amount = new.amount,
        compensation_currency = new.currency,
        updated_at = now()
    where id = new.submission_id;
  end if;

  return new;
end;
$$;

drop trigger if exists payments_safe_speech_compensation on public.payments;
create trigger payments_safe_speech_compensation
before insert on public.payments
for each row execute function public.apply_safe_speech_compensation();
