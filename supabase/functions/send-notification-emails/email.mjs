function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function buildEmail(job, email, config) {
  const url = new URL(config.dashboardUrl);
  if (url.protocol !== 'https:') throw new Error('Dashboard URL must use HTTPS');
  // Keep free-form review comments, recordings and payment details inside the signed-in dashboard.
  const subject = `NaijaVision: ${job.title.replace(/[\r\n]+/g, ' ').slice(0, 150)}`;
  return {
    from: config.from,
    to: [email],
    replyTo: config.replyTo,
    messageId: `<naijavision-notification-${job.id}@gmail.com>`,
    subject,
    text: `${subject}\n\nYou have a new NaijaVision update. Sign in to view the details and any action required.\n\n${url.href}\n\nNaijaVision Team`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#f4f8f6;color:#192a22;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f8f6;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce6df;border-radius:12px;overflow:hidden;">
<tr><td style="padding:32px;background:#3e7557;color:#ffffff;"><p style="margin:0 0 12px;font-size:30px;font-weight:bold;">NaijaVision</p><p style="margin:0;font-size:15px;line-height:1.6;color:#e4f0e8;">Nigerian language research contribution platform</p></td></tr>
<tr><td style="padding:36px 32px;"><p style="margin:0 0 16px;color:#3e7557;font-size:13px;font-weight:bold;letter-spacing:2px;">ACCOUNT UPDATE</p>
<h1 style="margin:0 0 22px;font-size:26px;line-height:1.3;">${escapeHtml(job.title.replace(/[\r\n]+/g, ' ').slice(0, 150))}</h1>
<p style="margin:0 0 26px;color:#59675f;font-size:16px;line-height:1.7;">You have a new NaijaVision update. Sign in to view the details and any action required.</p>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#3e7557" style="border-radius:8px;"><a href="${escapeHtml(url.href)}" style="display:inline-block;padding:17px 24px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;">Open your dashboard</a></td></tr></table>
<p style="margin:28px 0 8px;color:#59675f;font-size:13px;line-height:1.6;">If the button does not work, copy and paste this address into your browser:</p>
<p style="margin:0 0 28px;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${escapeHtml(url.href)}" style="color:#3e7557;">${escapeHtml(url.href)}</a></p>
<p style="margin:0;font-size:16px;line-height:1.7;">Thank you,<br><strong>NaijaVision Team</strong></p>
</td></tr><tr><td style="padding:20px 32px;border-top:1px solid #e3ebe6;color:#68766e;font-size:12px;line-height:1.6;">This notification relates to activity on your NaijaVision account.</td></tr>
</table></td></tr></table></body></html>`,
  };
}

export function retryOutcome(error, attempts, sendingStarted = false) {
  const smtpCode = Number(error?.responseCode || 0);
  const command = String(error?.command || '').toUpperCase();
  // SMTP has no idempotency API. A lost final DATA reply could mean Gmail accepted the email.
  const knownPreData = /^(CONN|EHLO|HELO|STARTTLS|AUTH|MAIL FROM|RCPT TO)/.test(command);
  const ambiguous = sendingStarted && !smtpCode && !knownPreData;
  const retryable = !smtpCode || (smtpCode >= 400 && smtpCode < 500);
  return {
    status: ambiguous ? 'delivery_unknown' : retryable && attempts < 8 ? 'pending' : 'failed',
    delaySeconds: Math.min(3600, 60 * 2 ** Math.max(0, attempts - 1)),
  };
}
