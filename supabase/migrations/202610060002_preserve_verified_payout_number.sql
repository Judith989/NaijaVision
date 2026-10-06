-- Provider verification previously retained only the final four digits. The
-- Edge Function now stores the entered number in manual_payout_details, whose
-- table privileges and RLS deny direct client access. Keep provider provenance
-- when both the protected details and a provider payout account exist.
create or replace function public.list_admin_account_information()
returns table(
  user_id uuid, display_name text, participant_id text, role text, account_status text,
  email text, phone text, bank_name text, account_name text, account_number text,
  account_last4 text, payout_status text, payout_source text, updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  return query
  select p.user_id, p.display_name, p.participant_id, p.role::text, p.account_status,
    u.email::text, u.phone::text,
    coalesce(m.bank_name, pa.bank_name), coalesce(m.account_name, pa.account_name),
    m.account_number, coalesce(right(m.account_number, 4), pa.account_last4),
    case when m.user_id is not null then m.status when pa.verified_at is not null then 'verified' else 'not supplied' end,
    case
      when pa.id is not null and pa.provider <> 'manual' then pa.provider
      when m.user_id is not null then 'manual'
      when pa.id is not null then pa.provider
      else 'none'
    end,
    greatest(p.updated_at, coalesce(m.updated_at, p.updated_at), coalesce(pa.updated_at, p.updated_at))
  from public.profiles p
  join auth.users u on u.id=p.user_id
  left join public.manual_payout_details m on m.user_id=p.user_id
  left join public.payout_accounts pa on pa.user_id=p.user_id
  order by p.created_at desc;
end;
$$;

revoke all on function public.list_admin_account_information() from public, anon;
grant execute on function public.list_admin_account_information() to authenticated;
