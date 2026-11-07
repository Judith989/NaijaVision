import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('notification handoffs, SMTP leases, rate limits and permissions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      create table public.profiles(user_id uuid,role text,account_status text);
      create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid,type text,title text,message text,read_at timestamptz);
      create table public.submissions(id uuid primary key,user_id uuid,participant_id text,assigned_reviewer_id uuid,status text,submitted_at timestamptz);
      create table public.submission_recommendations(id uuid primary key,submission_id uuid,admin_review_status text,recommendation text,comments text);
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/202611050001_email_notifications.sql', import.meta.url), 'utf8'));
    const participant = '00000000-0000-0000-0000-000000000001';
    const reviewer = '00000000-0000-0000-0000-000000000002';
    const admin = '00000000-0000-0000-0000-000000000003';
    await db.exec(`insert into auth.users values('${participant}'),('${reviewer}'),('${admin}');
      insert into profiles values('${admin}','admin','active');
      insert into submissions values('${participant}','${participant}','NV-TEST',null,'recording',null);
      update submissions set submitted_at=now(),status='automated_qc';`);
    const recipients = (await db.query('select user_id,type from notifications order by type')).rows;
    assert.deepEqual(recipients, [
      { user_id: admin, type: 'submission_needs_assignment' },
      { user_id: participant, type: 'submission_received' },
    ]);
    const count = async () => Number((await db.query('select count(*) as n from notification_emails')).rows[0].n);
    await db.exec(`update submissions set assigned_reviewer_id='${reviewer}',status='awaiting_review';`);
    assert.equal(await count(), 3);
    await db.exec(`update submissions set status='awaiting_review'; update notifications set read_at=now();`);
    assert.equal(await count(), 3, 'same-value updates and reading do not email');
    await db.exec(`update submissions set submitted_at=now()+interval '1 second',status='automated_qc';`);
    assert.equal(await count(), 5, 'participant and assigned reviewer receive resubmission update');
    await db.exec(`insert into submission_recommendations values('${participant}','${participant}','participant_returned','changes_requested','Redo');`);
    assert.equal(await count(), 6, 'admin notified of direct return');
    await db.exec(`update submission_recommendations set comments='Redo';`);
    assert.equal(await count(), 6);
    await db.exec(`begin; insert into notifications(user_id,type,title,message) values('${participant}','test','test','test'); rollback;`);
    assert.equal(await count(), 6, 'workflow rollback rolls back email too');
    const claim = async () => (await db.query('select * from claim_notification_email()')).rows;
    const first = (await claim())[0];
    assert.equal((await claim()).length, 0, 'another invocation cannot race the active worker');
    await db.exec(`update notification_emails set lease_until=now()-interval '1 minute' where id='${first.id}';`);
    const recovered = (await claim())[0];
    assert.equal(recovered.id, first.id);
    assert.notEqual(recovered.lease_id, first.lease_id);
    await db.exec(`update notification_emails set status='sending',lease_until=now()-interval '1 minute' where id='${first.id}';`);
    const next = (await claim())[0];
    assert.notEqual(next.id, first.id);
    assert.equal((await db.query(`select status from notification_emails where id='${first.id}'`)).rows[0].status, 'delivery_unknown');
    await db.exec(`update notification_emails set status='sent' where id='${next.id}';
      insert into notification_email_attempts(email_id) select '${next.id}'::uuid from generate_series(1,30);`);
    assert.equal((await claim()).length, 0, 'hourly SMTP budget enforced');
    await db.exec(`update notification_email_attempts set attempted_at=now()-interval '2 hours';
      insert into notification_email_attempts(email_id,attempted_at) select '${next.id}'::uuid,now()-interval '2 hours' from generate_series(1,200);`);
    assert.equal((await claim()).length, 0, 'daily SMTP budget enforced');
    await db.exec('set role authenticated');
    await assert.rejects(() => db.query('select * from notification_emails'));
    await assert.rejects(() => db.query('select * from claim_notification_email()'));
  } finally { await db.close(); }
});
