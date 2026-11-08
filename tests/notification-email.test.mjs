import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmail, retryOutcome } from '../supabase/functions/send-notification-emails/email.mjs';

test('notification emails link to the dashboard without exposing private comments', () => {
  const email = buildEmail({ title: 'Recordings need corrections\r\n', message: 'Private review feedback' }, 'participant@example.com', {
    from: 'NaijaVision <notifications@example.com>', replyTo: 'naijavisionresearch@gmail.com',
    dashboardUrl: 'https://naijavision.vercel.app/dashboard',
  });
  assert.equal(email.replyTo, 'naijavisionresearch@gmail.com');
  assert.deepEqual(email.to, ['participant@example.com']);
  assert.ok(email.text.includes('https://naijavision.vercel.app/dashboard'));
  assert.ok(!email.text.includes('Private review feedback'));
  assert.ok(!/[\r\n]/.test(email.subject));
  assert.throws(() => buildEmail({ title: 'Update' }, 'x@example.com', { dashboardUrl: 'javascript:alert(1)' }));
});

test('temporary failures retry, permanent failures stop, and retries are bounded', () => {
  for (const responseCode of [421, 450, 451, 452]) assert.equal(retryOutcome({ responseCode }, 1, true).status, 'pending');
  for (const responseCode of [535, 550, 553]) assert.equal(retryOutcome({ responseCode }, 1, true).status, 'failed');
  assert.equal(retryOutcome({ responseCode: 451 }, 8, true).status, 'failed');
  assert.equal(retryOutcome({}, 1, false).status, 'pending');
  assert.equal(retryOutcome({ command: 'CONN' }, 1, true).status, 'pending');
  assert.equal(retryOutcome({ command: 'DATA' }, 1, true).status, 'delivery_unknown');
  assert.equal(retryOutcome({}, 1, true).status, 'delivery_unknown');
  assert.equal(retryOutcome({}, 1).delaySeconds, 60);
  assert.equal(retryOutcome({}, 7).delaySeconds, 3600);
});
