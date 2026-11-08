# Activity emails through Gmail SMTP

The worker uses the same sender as Supabase Auth: `naijavisionresearch@gmail.com`, Gmail SMTP on port 465 with TLS. Supabase Auth SMTP settings are separate from Edge Function secrets; the worker needs its own copy of a Gmail app password.

## Events and recipients

- Participants: submissions received, requested corrections, final decisions, restored submissions, payment updates, and administrator/reviewer messages.
- Reviewers: new/removed assignments, participant resubmissions, final outcomes, administrator feedback, restored submissions and reviewer payment updates.
- Administrators: unassigned submissions, review recommendations, direct returns to participants, and replies to admin messages.

Existing dashboard notifications are queued atomically. Additional database triggers fill missing handoffs. Only future notifications are sent; this does not email the historical backlog. Saving clips and reading notifications do not send emails. Each alert goes only to its recipient, never a group recipient list. Email contains the alert title and a sign-in link; free-form feedback and recordings stay in the dashboard. Only active, email-verified recipients qualify. Signup confirmation stays with Supabase Auth.

## Deployment

1. Set `SMTP_PASSWORD` in Supabase Edge Function secrets using a Gmail app password for the sender account. Do not change the working Auth SMTP password. Never place credentials in client variables, source, screenshots or chat.
2. Set `NOTIFICATION_WORKER_SECRET` to a random 32-byte server-only secret. Optional overrides: `SMTP_USERNAME` and `NOTIFICATION_DASHBOARD_URL`. Defaults are the sender above and `https://naijavision.vercel.app/dashboard`.
3. Apply `supabase/migrations/202611050001_email_notifications.sql` once to the target database.
4. Deploy `send-notification-emails`. It requires the `x-notification-secret` header, checks it before processing, and rejects non-POST requests. Gateway JWT checking is disabled for this scheduler-only endpoint.
5. Enable pg_cron and pg_net. Store `notification_project_url` and `notification_worker_secret` in Supabase Vault. The latter must match the Edge Function secret. Run `supabase/setup/notification-email-cron.sql`.
6. Insert one clearly labeled test notification for the project owner's active, verified account. Confirm a sent queue record, stable Message-ID, and receipt. Verify assignment, direct return and resubmission recipients using the local integration tests.

A GitHub Pages push alone does not deploy database migrations or Edge Functions.

## Reliability and limits

One job is processed per scheduled minute. Claims reserve capacity under a database advisory lock, capped at 30 attempts per rolling hour and 200 per rolling day. These conservative caps leave some headroom; they cannot measure all emails sent by the Gmail account or guarantee Google's quota availability. Excess work remains queued.

Credentials are checked before claiming work. Safe transient SMTP failures retry with exponential backoff, up to eight attempts. Permanent rejections stop. A worker that dies before sending can be reclaimed after two minutes. If it dies while sending, or loses the final SMTP reply, the job becomes `delivery_unknown`: Gmail does not provide an idempotent send API. The system does not resend ambiguous deliveries automatically. Check Gmail Sent using the stored Message-ID before deciding to retry. A stable Message-ID is for reconciliation, not a guarantee against duplicates.

`sent` means Gmail accepted the message, not proven inbox delivery. Bounces go to the sender mailbox. Automated bounce processing is not included. Monitor the queue and Gmail inbox regularly:

```sql
select status,count(*),min(created_at) as oldest from public.notification_emails group by status;
select id,notification_id,attempts,last_error,provider_id,payload->>'messageId' as message_id
from public.notification_emails where status in ('failed','delivery_unknown') order by created_at;
```

Pause sending with `select cron.unschedule('naijavision-notification-emails');`. New notifications remain queued. Resume by rerunning the schedule script. Do not automatically reset failed/uncertain jobs.

## Validation

`node --test tests/notification-email.test.mjs tests/notification-queue.test.mjs` tests privacy, SMTP error handling, transactional queueing, event recipients, leases, rate limits and permissions against embedded PostgreSQL. `npx deno check --no-lock --node-modules-dir=none supabase/functions/send-notification-emails/index.ts` checks the deployed worker type/import graph.

References: https://supabase.com/docs/guides/functions/schedule-functions and https://nodemailer.com/smtp.
