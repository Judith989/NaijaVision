-- Reviewer earnings become eligible only after the participant submission receives
-- final administrator approval. A reviewer/submission pair has one payment row,
-- and each assigned prompt is counted once even when a clip is replaced and reviewed again.
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
  v_submission_status public.submission_status;
begin
  select status into v_submission_status
  from public.submissions
  where id = new.submission_id;

  if new.recommendation <> 'approved'
     or new.admin_review_status <> 'accepted'
     or v_submission_status not in ('payment_eligible', 'payment_processing', 'paid') then
    update public.reviewer_payments
    set status = 'cancelled', updated_at = now()
    where submission_id = new.submission_id
      and reviewer_id = new.reviewer_id
      and status not in ('processing', 'paid');
    return new;
  end if;

  select * into v_policy
  from public.reviewer_compensation_policies
  where effective_at <= now() and retired_at is null
  order by effective_at desc limit 1;
  if v_policy.id is null then return new; end if;

  select count(distinct r.prompt_assignment_id) into v_count
  from public.reviews rv
  join public.recordings r on r.id = rv.recording_id
  where rv.submission_id = new.submission_id
    and rv.reviewer_id = new.reviewer_id;

  select id into v_payout
  from public.payout_accounts
  where user_id = new.reviewer_id and verified_at is not null
  limit 1;

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
    status = case
      when public.reviewer_payments.status = 'paid' then 'paid'::public.payment_status
      when public.reviewer_payments.status = 'processing' then 'processing'::public.payment_status
      else 'eligible'::public.payment_status
    end,
    updated_at = now();
  return new;
end;
$$;

-- Cancel premature, unpaid earnings created by the previous trigger definition.
update public.reviewer_payments rp
set status = 'cancelled', updated_at = now()
from public.submission_recommendations sr, public.submissions s
where rp.submission_id = sr.submission_id
  and rp.reviewer_id = sr.reviewer_id
  and s.id = sr.submission_id
  and rp.status not in ('processing', 'paid', 'cancelled')
  and (sr.recommendation <> 'approved'
    or sr.admin_review_status <> 'accepted'
    or s.status not in ('payment_eligible', 'payment_processing', 'paid'));
