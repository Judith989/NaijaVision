import nodemailer from 'npm:nodemailer@10.3.1';
import { serviceClient } from '../_shared/security.ts';
import { buildEmail, retryOutcome } from './email.mjs';

Deno.serve(async (request: Request) => {
  const secret = Deno.env.get('NOTIFICATION_WORKER_SECRET');
  if (!secret || request.headers.get('x-notification-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const password = Deno.env.get('SMTP_PASSWORD');
  if (!password) return new Response('SMTP_PASSWORD is not configured', { status: 503 });
  const username = Deno.env.get('SMTP_USERNAME') || 'naijavisionresearch@gmail.com';
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: username, pass: password.replace(/\s/g, '') },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  const service = serviceClient();
  try {
    // Verify credentials before claiming work; a configuration outage does not exhaust retries.
    await transport.verify();
    const { data, error } = await service.rpc('claim_notification_email');
    if (error) throw error;
    const job = data?.[0];
    if (!job) return Response.json({ accepted: 0 });
    const save = async (values: Record<string, unknown>) => {
      const result = await service.from('notification_emails').update(values)
        .eq('id', job.id).eq('lease_id', job.lease_id).select('id').single();
      if (result.error) throw result.error;
    };
    let sendingStarted = false;
    try {
      const { data: account, error: accountError } = await service.auth.admin.getUserById(job.user_id);
      if (accountError) throw accountError;
      const { data: profile, error: profileError } = await service.from('profiles').select('account_status').eq('user_id', job.user_id).maybeSingle();
      if (profileError) throw profileError;
      const user = account.user;
      if (!user?.email || !user.email_confirmed_at || profile?.account_status !== 'active') {
        await save({ status: 'skipped', last_error: 'Recipient is not an active email-verified account.' });
        return Response.json({ accepted: 0, skipped: 1 });
      }
      if (job.payload && job.payload.to[0] !== user.email) {
        await save({ status: 'skipped', last_error: 'Recipient email changed after first attempt.' });
        return Response.json({ accepted: 0, skipped: 1 });
      }
      const payload = job.payload || buildEmail(job, user.email, {
        from: `NaijaVision <${username}>`, replyTo: username,
        dashboardUrl: Deno.env.get('NOTIFICATION_DASHBOARD_URL') || 'https://judith989.github.io/NaijaVision/dashboard/',
      });
      await save({ payload, status: 'sending' });
      sendingStarted = true;
      const info = await transport.sendMail(payload);
      if (!info.accepted?.length) throw new Error('No recipient accepted');
      // A stable Message-ID helps reconciliation; it does not guarantee SMTP deduplication.
      await save({ status: 'sent', provider_id: info.messageId, sent_at: new Date().toISOString(), last_error: null });
      return Response.json({ accepted: 1 });
    } catch (error) {
      const retry = retryOutcome(error, job.attempts, sendingStarted);
      const smtpCode = Number((error as { responseCode?: number })?.responseCode || 0);
      await save({ status: retry.status, next_attempt_at: new Date(Date.now() + retry.delaySeconds * 1000).toISOString(),
        last_error: retry.status === 'delivery_unknown'
          ? 'Delivery uncertain. Check Gmail Sent before retrying.'
          : `Email attempt failed (SMTP ${smtpCode || 'unavailable'}).` });
      return Response.json({ accepted: 0, status: retry.status });
    }
  } catch {
    return new Response('Email worker unavailable. Check SMTP credentials and function logs; queued jobs are retained.', { status: 503 });
  } finally {
    transport.close();
  }
});
