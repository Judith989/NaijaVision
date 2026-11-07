-- Run only after deploying the worker and creating the two named Vault secrets.
-- Requires pg_cron and pg_net. No plaintext credentials belong in this file.
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='notification_project_url')
     or not exists(select 1 from vault.decrypted_secrets where name='notification_worker_secret') then
    raise exception 'Configure notification_project_url and notification_worker_secret in Vault first';
  end if;
end;
$$;

select cron.schedule('naijavision-notification-emails', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='notification_project_url') || '/functions/v1/send-notification-emails',
    headers := jsonb_build_object('Content-Type','application/json','x-notification-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='notification_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
