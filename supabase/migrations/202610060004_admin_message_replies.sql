create table if not exists public.admin_user_messages (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.notifications(id) on delete cascade,
  sender_admin_id uuid not null references auth.users(id),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, message text not null, reply text,
  replied_at timestamptz, created_at timestamptz not null default now()
);
alter table public.admin_user_messages enable row level security;
revoke all on table public.admin_user_messages from public, anon, authenticated;

create or replace function public.send_admin_message(p_user_id uuid, p_title text, p_message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_notification_id uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_user_id is null or not exists(select 1 from public.profiles where user_id=p_user_id) then raise exception 'User account not found'; end if;
  if length(trim(coalesce(p_title, ''))) not between 3 and 120 then raise exception 'Enter a title between 3 and 120 characters'; end if;
  if length(trim(coalesce(p_message, ''))) not between 3 and 2000 then raise exception 'Enter a message between 3 and 2000 characters'; end if;
  insert into public.notifications(user_id,type,title,message) values(p_user_id,'admin_message',trim(p_title),trim(p_message)) returning id into v_notification_id;
  insert into public.admin_user_messages(notification_id,sender_admin_id,recipient_user_id,title,message) values(v_notification_id,auth.uid(),p_user_id,trim(p_title),trim(p_message));
  perform public.write_audit_event('admin.message_sent','user',p_user_id::text,null,jsonb_build_object('notification_id',v_notification_id,'title',trim(p_title)));
  return v_notification_id;
end; $$;

create or replace function public.reply_to_admin_message(p_notification_id uuid, p_reply text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_thread public.admin_user_messages;
begin
  select * into v_thread from public.admin_user_messages where notification_id=p_notification_id and recipient_user_id=auth.uid() for update;
  if v_thread.id is null then raise exception 'Reply is unavailable for this message'; end if;
  if v_thread.reply is not null then raise exception 'A reply has already been sent for this message'; end if;
  if length(trim(coalesce(p_reply, ''))) not between 2 and 2000 then raise exception 'Enter a reply between 2 and 2000 characters'; end if;
  update public.admin_user_messages set reply=trim(p_reply),replied_at=now() where id=v_thread.id;
  insert into public.notifications(user_id,type,title,message) values(v_thread.sender_admin_id,'admin_message_reply','Reply from a NaijaVision user',trim(p_reply));
  perform public.write_audit_event('admin.message_replied','admin_user_message',v_thread.id::text,null,jsonb_build_object('notification_id',p_notification_id));
end; $$;

create or replace function public.list_admin_message_replies()
returns table(id uuid,recipient_user_id uuid,recipient_name text,participant_id text,title text,message text,reply text,replied_at timestamptz,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  return query select m.id,m.recipient_user_id,p.display_name,p.participant_id,m.title,m.message,m.reply,m.replied_at,m.created_at
  from public.admin_user_messages m join public.profiles p on p.user_id=m.recipient_user_id order by coalesce(m.replied_at,m.created_at) desc;
end; $$;

revoke all on function public.send_admin_message(uuid,text,text) from public, anon;
revoke all on function public.reply_to_admin_message(uuid,text) from public, anon;
revoke all on function public.list_admin_message_replies() from public, anon;
grant execute on function public.send_admin_message(uuid,text,text) to authenticated;
grant execute on function public.reply_to_admin_message(uuid,text) to authenticated;
grant execute on function public.list_admin_message_replies() to authenticated;
