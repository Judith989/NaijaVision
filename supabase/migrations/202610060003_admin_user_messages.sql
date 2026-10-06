create or replace function public.send_admin_message(
  p_user_id uuid,
  p_title text,
  p_message text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_notification_id uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_user_id is null or not exists(select 1 from public.profiles where user_id=p_user_id) then
    raise exception 'User account not found';
  end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Enter a message title'; end if;
  if length(trim(coalesce(p_title, ''))) > 120 then raise exception 'Message title is too long'; end if;
  if length(trim(coalesce(p_message, ''))) < 3 then raise exception 'Enter a message'; end if;
  if length(trim(coalesce(p_message, ''))) > 2000 then raise exception 'Message is too long'; end if;

  insert into public.notifications(user_id, type, title, message)
  values(p_user_id, 'admin_message', trim(p_title), trim(p_message))
  returning id into v_notification_id;

  perform public.write_audit_event(
    'admin.message_sent', 'user', p_user_id::text, null,
    jsonb_build_object('notification_id', v_notification_id, 'title', trim(p_title))
  );
  return v_notification_id;
end;
$$;

revoke all on function public.send_admin_message(uuid,text,text) from public, anon;
grant execute on function public.send_admin_message(uuid,text,text) to authenticated;
