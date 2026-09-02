update public.reviewer_compensation_policies
set retired_at = now()
where retired_at is null;

insert into public.reviewer_compensation_policies (
  name,
  amount_per_video,
  currency,
  effective_at
)
values (
  'NGN 10 per unique video reviewed',
  10,
  'NGN',
  now()
)
on conflict (name) do update
set amount_per_video = excluded.amount_per_video,
    currency = excluded.currency,
    effective_at = excluded.effective_at,
    retired_at = null;
