-- Only email-verified applicants may enter the administrator approval queue.
create or replace function public.list_verified_pending_accounts()
returns table (
  user_id uuid,
  display_name text,
  participant_id text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;

  return query
  select p.user_id, p.display_name, p.participant_id, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where p.account_status = 'pending'
    and u.email_confirmed_at is not null
  order by p.created_at
  limit 100;
end;
$$;

create or replace function public.approve_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;
  if not exists (
    select 1 from auth.users
    where id = p_user_id and email_confirmed_at is not null
  ) then
    raise exception 'The applicant must verify their email before approval';
  end if;

  update public.profiles
  set account_status = 'active', updated_at = now()
  where user_id = p_user_id and account_status = 'pending';
  if not found then raise exception 'Pending account not found'; end if;

  insert into public.notifications(user_id, type, title, message)
  values (p_user_id, 'account_approved', 'Account approved', 'Your NaijaVision account has been approved. You can now begin or continue a contribution.');
  perform public.write_audit_event('account.approved', 'user', p_user_id::text, null, null);
end;
$$;

revoke execute on function public.list_verified_pending_accounts() from public, anon;
revoke execute on function public.approve_account(uuid) from public, anon;
grant execute on function public.list_verified_pending_accounts() to authenticated;
grant execute on function public.approve_account(uuid) to authenticated;
