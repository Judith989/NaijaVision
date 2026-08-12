-- Lets an admin see and act on staff sign-up requests from the app
-- instead of looking up user UUIDs in the Supabase dashboard.

alter table public.profiles
  add column staff_request_status text not null default 'none'
    check (staff_request_status in ('none', 'pending', 'dismissed'));

-- Re-create handle_new_user to also capture the requester's display name
-- and mark accounts created from the staff sign-up page as pending.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_requested_staff boolean := coalesce((new.raw_user_meta_data->>'requesting_staff_access')::boolean, false);
  v_display_name text := new.raw_user_meta_data->>'full_name';
begin
  insert into public.profiles(user_id, display_name, staff_request_status)
    values (new.id, v_display_name, case when v_requested_staff then 'pending' else 'none' end);
  insert into public.user_roles(user_id, role) values (new.id, 'participant');
  return new;
end;
$$;

create or replace function public.dismiss_staff_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;
  update public.profiles set staff_request_status = 'dismissed', updated_at = now()
    where user_id = p_user_id and staff_request_status = 'pending';
  perform public.write_audit_event('staff_request.dismissed', 'user', p_user_id::text, null, null);
end;
$$;
grant execute on function public.dismiss_staff_request(uuid) to authenticated;
