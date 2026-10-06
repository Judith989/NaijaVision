create table if not exists public.manual_payout_details (
  user_id uuid primary key references auth.users(id) on delete cascade,
  country text not null default 'Nigeria',
  bank_code text not null,
  bank_name text not null,
  account_name text not null,
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

comment on table public.manual_payout_details is
  'Restricted manual payout fallback. Contains sensitive full account numbers and is accessible only through authorization-checking RPCs.';

alter table public.manual_payout_details enable row level security;
revoke all on table public.manual_payout_details from public, anon, authenticated;

create or replace function public.save_manual_payout_details(
  p_country text,
  p_bank_code text,
  p_bank_name text,
  p_account_name text,
  p_account_number text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.has_active_account() then raise exception 'An active account is required'; end if;
  if p_country <> 'Nigeria' then raise exception 'Manual payout details currently support Nigerian accounts only'; end if;
  if nullif(trim(p_bank_code), '') is null or nullif(trim(p_bank_name), '') is null then raise exception 'Select a bank'; end if;
  if length(trim(coalesce(p_account_name, ''))) < 2 then raise exception 'Enter the account name'; end if;
  if coalesce(p_account_number, '') !~ '^[0-9]{10}$' then raise exception 'Enter a valid 10-digit account number'; end if;

  insert into public.manual_payout_details(
    user_id, country, bank_code, bank_name, account_name, account_number,
    status, rejection_reason, submitted_at, reviewed_at, reviewed_by, updated_at
  ) values (
    v_user, p_country, trim(p_bank_code), trim(p_bank_name), trim(p_account_name), p_account_number,
    'pending', null, now(), null, null, now()
  ) on conflict (user_id) do update set
    country=excluded.country, bank_code=excluded.bank_code, bank_name=excluded.bank_name,
    account_name=excluded.account_name, account_number=excluded.account_number,
    status='pending', rejection_reason=null, submitted_at=now(), reviewed_at=null,
    reviewed_by=null, updated_at=now();

  perform public.write_audit_event('payout.manual_submitted', 'user', v_user::text, null,
    jsonb_build_object('bank_name', trim(p_bank_name), 'account_last4', right(p_account_number, 4)));
end;
$$;

create or replace function public.get_my_manual_payout_status()
returns table(bank_name text, account_name text, account_last4 text, status text, rejection_reason text, submitted_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select m.bank_name, m.account_name, right(m.account_number, 4), m.status, m.rejection_reason, m.submitted_at
  from public.manual_payout_details m where m.user_id=auth.uid();
$$;

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
    case when m.user_id is not null then 'manual' when pa.id is not null then pa.provider else 'none' end,
    greatest(p.updated_at, coalesce(m.updated_at, p.updated_at), coalesce(pa.updated_at, p.updated_at))
  from public.profiles p
  join auth.users u on u.id=p.user_id
  left join public.manual_payout_details m on m.user_id=p.user_id
  left join public.payout_accounts pa on pa.user_id=p.user_id
  order by p.created_at desc;
end;
$$;

create or replace function public.approve_manual_payout_details(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_details public.manual_payout_details; v_payout_id uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into v_details from public.manual_payout_details where user_id=p_user_id and status='pending' for update;
  if v_details.user_id is null then raise exception 'Pending manual payout details not found'; end if;

  insert into public.payout_accounts(
    user_id, country, bank_code, bank_name, account_name, account_last4,
    provider, provider_recipient_code, verified_at, updated_at
  ) values (
    p_user_id, v_details.country, v_details.bank_code, v_details.bank_name,
    v_details.account_name, right(v_details.account_number, 4),
    'manual', 'manual:' || p_user_id::text, now(), now()
  ) on conflict (user_id) do update set
    country=excluded.country, bank_code=excluded.bank_code, bank_name=excluded.bank_name,
    account_name=excluded.account_name, account_last4=excluded.account_last4,
    provider='manual', provider_recipient_code=excluded.provider_recipient_code,
    verified_at=now(), updated_at=now()
  returning id into v_payout_id;

  update public.manual_payout_details set status='verified', rejection_reason=null,
    reviewed_at=now(), reviewed_by=auth.uid(), updated_at=now() where user_id=p_user_id;
  update public.payments set payout_account_id=v_payout_id, updated_at=now()
    where user_id=p_user_id and status not in ('processing','paid');
  update public.reviewer_payments set payout_account_id=v_payout_id, updated_at=now()
    where reviewer_id=p_user_id and status not in ('processing','paid');
  insert into public.notifications(user_id,type,title,message) values(
    p_user_id, 'payout_verified', 'Payment details approved',
    'Your manually submitted bank details have been approved for payment.'
  );
  perform public.write_audit_event('payout.manual_approved', 'user', p_user_id::text, null,
    jsonb_build_object('payout_account_id', v_payout_id));
end;
$$;

create or replace function public.reject_manual_payout_details(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter a rejection reason'; end if;
  update public.manual_payout_details set status='rejected', rejection_reason=trim(p_reason),
    reviewed_at=now(), reviewed_by=auth.uid(), updated_at=now()
  where user_id=p_user_id and status='pending';
  if not found then raise exception 'Pending manual payout details not found'; end if;
  insert into public.notifications(user_id,type,title,message) values(
    p_user_id, 'payout_rejected', 'Payment details need correction', trim(p_reason)
  );
  perform public.write_audit_event('payout.manual_rejected', 'user', p_user_id::text, null,
    jsonb_build_object('reason', trim(p_reason)));
end;
$$;

revoke all on function public.save_manual_payout_details(text,text,text,text,text) from public, anon;
revoke all on function public.get_my_manual_payout_status() from public, anon;
revoke all on function public.list_admin_account_information() from public, anon;
revoke all on function public.approve_manual_payout_details(uuid) from public, anon;
revoke all on function public.reject_manual_payout_details(uuid,text) from public, anon;
grant execute on function public.save_manual_payout_details(text,text,text,text,text) to authenticated;
grant execute on function public.get_my_manual_payout_status() to authenticated;
grant execute on function public.list_admin_account_information() to authenticated;
grant execute on function public.approve_manual_payout_details(uuid) to authenticated;
grant execute on function public.reject_manual_payout_details(uuid,text) to authenticated;
