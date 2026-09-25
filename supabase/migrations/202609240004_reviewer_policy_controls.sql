-- Restore the administrator reviewer-rate control and install the latest rate.
create or replace function public.replace_reviewer_compensation_policy(p_amount numeric, p_currency text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_currency text := upper(trim(coalesce(p_currency, '')));
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter a valid reviewer rate'; end if;
  if v_currency = '' then raise exception 'Select a currency'; end if;

  update public.reviewer_compensation_policies
  set retired_at = now()
  where retired_at is null;

  insert into public.reviewer_compensation_policies(
    id, name, amount_per_video, currency, effective_at, created_by
  ) values (
    v_id,
    v_currency || ' ' || p_amount || ' per unique video reviewed [' || v_id || ']',
    p_amount,
    v_currency,
    now(),
    auth.uid()
  );
  return v_id;
end;
$$;

revoke execute on function public.replace_reviewer_compensation_policy(numeric, text) from public, anon;
grant execute on function public.replace_reviewer_compensation_policy(numeric, text) to authenticated;

-- The most recent administrator choice was NGN 30 per reviewed video.
do $$
declare v_id uuid := gen_random_uuid();
begin
  update public.reviewer_compensation_policies
  set retired_at = now()
  where retired_at is null;

  insert into public.reviewer_compensation_policies(
    id, name, amount_per_video, currency, effective_at
  ) values (
    v_id,
    'NGN 30 per unique video reviewed [' || v_id || ']',
    30,
    'NGN',
    now()
  );
end;
$$;
