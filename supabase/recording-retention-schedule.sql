-- Run after deploying cleanup-recordings. Reuse the existing server-only worker credential
-- inside the database without printing or copying it into source control.
do $$
declare worker_command text;
begin
  select command into worker_command from cron.job
  where jobname='naijavision-notification-emails' and active
    and position('send-notification-emails' in command)>0;
  if worker_command is null then raise exception 'Active notification worker schedule is required'; end if;
  perform cron.schedule('naijavision-recording-cleanup','*/5 * * * *',
    replace(worker_command,'send-notification-emails','cleanup-recordings'));
end; $$;
select jobname,schedule,active from cron.job where jobname='naijavision-recording-cleanup';
