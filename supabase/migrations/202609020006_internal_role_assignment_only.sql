revoke execute on function public.request_staff_access() from public, anon, authenticated;

update public.profiles
set staff_request_status = 'none', updated_at = now()
where staff_request_status = 'pending';
