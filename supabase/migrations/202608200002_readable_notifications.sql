create or replace function public.make_notification_readable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.message is null or trim(new.message) = '' or new.message = 'Open NaijaVision to view the latest status of your contribution.' then
    new.message := case
      when lower(new.title) like '%rejected%' then
        'Your submission was declined and is not eligible for compensation. Contact support if you need more information about the decision.'
      when lower(new.title) like '%changes%' then
        'Some recordings need to be completed again. Open your contribution to view and replace the affected recordings.'
      when lower(new.title) like '%approved%' then
        'Your submission passed final review and is now moving to compensation processing.'
      else
        'There is a new update about your contribution. View your review timeline for the current status.'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists make_notification_readable on public.notifications;
create trigger make_notification_readable
before insert or update of title, message on public.notifications
for each row execute function public.make_notification_readable();

update public.notifications
set message = case
  when lower(title) like '%rejected%' then
    'Your submission was declined and is not eligible for compensation. Contact support if you need more information about the decision.'
  when lower(title) like '%changes%' then
    'Some recordings need to be completed again. Open your contribution to view and replace the affected recordings.'
  when lower(title) like '%approved%' then
    'Your submission passed final review and is now moving to compensation processing.'
  else
    'There is a new update about your contribution. View your review timeline for the current status.'
end
where message is null
   or trim(message) = ''
   or message = 'Open NaijaVision to view the latest status of your contribution.';
