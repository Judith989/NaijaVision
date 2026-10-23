begin;

-- Email confirmation replaces manual account approval.
-- Pending now means email verification is incomplete.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(user_id, display_name, account_status, staff_request_status)
  values (new.id, nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    case when new.email_confirmed_at is not null then 'active' else 'pending' end, 'none');
  insert into public.user_roles(user_id, role) values (new.id, 'participant');
  return new;
end;
$$;

create or replace function public.activate_email_verified_account()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null then
    update public.profiles set account_status = 'active', updated_at = now()
    where user_id = new.id and account_status = 'pending';
  end if;
  return new;
end;
$$;

create trigger activate_email_verified_account
 after update of email_confirmed_at on auth.users
 for each row execute function public.activate_email_verified_account();

-- Release existing verified accounts without reopening suspended or closed ones.
update public.profiles p set account_status = 'active', updated_at = now()
from auth.users u
where u.id = p.user_id and u.email_confirmed_at is not null
  and p.account_status = 'pending';

-- Retain active-account and role checks throughout the existing policies.
create or replace function public.has_active_account()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.user_id
    where p.user_id = auth.uid() and p.account_status = 'active'
      and u.email_confirmed_at is not null
  );
$$;

revoke execute on function public.activate_email_verified_account() from public, anon, authenticated;
revoke execute on function public.approve_account(uuid) from public, anon, authenticated;
revoke execute on function public.decline_account(uuid, text) from public, anon, authenticated;
revoke execute on function public.list_verified_pending_accounts() from public, anon, authenticated;

commit;
