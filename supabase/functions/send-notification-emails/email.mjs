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
