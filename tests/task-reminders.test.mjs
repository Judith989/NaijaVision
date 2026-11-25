import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('reminders enforce admin access, pending work, recipient eligibility, deduplication and cooldown', async () => {
 const db = new PGlite();
 const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
   create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql as $$select current_setting('app.uid')::uuid$$;
   create function public.is_admin() returns boolean language sql as $$select current_setting('app.admin')='yes'$$;
   create function public.write_audit_event(text,text,text,jsonb,jsonb) returns void language sql as $$select$$;
   create table profiles(user_id uuid,participant_id text,display_name text,role text,account_status text,created_at timestamptz default now()-interval '2 days');
   create table submissions(id uuid,user_id uuid,assigned_reviewer_id uuid,status text,updated_at timestamptz default now()-interval '2 days',submitted_at timestamptz default now()-interval '3 days');
   create table recordings(id uuid,submission_id uuid);
   create table submission_recommendations(submission_id uuid,reviewer_id uuid,admin_review_status text,updated_at timestamptz default now()-interval '2 days');
   create table notifications(id uuid primary key default gen_random_uuid(),user_id uuid,type text,title text,message text);
   select set_config('app.uid','${id(1)}',false); select set_config('app.admin','yes',false);
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202611250001_task_reminders.sql',import.meta.url),'utf8'));
  for(let n=1;n<=9;n++) { await db.query('insert into auth.users values($1,now())',[id(n)]); await db.query(`insert into profiles(user_id,participant_id,role,account_status) values($1,$2,$3,'active')`,[id(n),`NV-${n}`,n===1?'admin':n===2?'reviewer':'participant']); }
  await db.exec(`insert into submissions(id,user_id,assigned_reviewer_id,status) values
   ('${id(20)}','${id(3)}','${id(2)}','awaiting_review'),
   ('${id(21)}','${id(4)}',null,'recording'),
   ('${id(22)}','${id(5)}',null,'changes_requested');
   insert into recordings values('${id(30)}','${id(21)}');
   insert into submission_recommendations(submission_id,reviewer_id,admin_review_status) values('${id(20)}','${id(2)}','returned');
   update auth.users set email_confirmed_at=null where id='${id(8)}';
   update profiles set account_status='suspended' where user_id='${id(9)}';
   update profiles set created_at=now() where user_id='${id(7)}';`);
  const preview = async () => (await db.query('select * from preview_task_reminders()')).rows;
  let rows=await preview();
  assert.deepEqual(rows.map(r=>r.task_kind).sort(),['not_started','participant_corrections','returned_reviews','unfinished_recordings']);
  const send=async(kind,ids)=>(await db.query('select send_task_reminders($1,$2::uuid[]) as n',[kind,ids])).rows[0].n;
  assert.equal(await send('returned_reviews',[id(2),id(2)]),1);
  assert.equal(await send('returned_reviews',[id(2)]),0);
  assert.equal((await db.query('select count(*) as n from notifications')).rows[0].n,1);
  assert.equal((await preview()).find(r=>r.user_id===id(2)).can_send,false);
  await db.exec(`update task_reminder_log set created_at=now()-interval '25 hours';`);
  assert.equal((await preview()).find(r=>r.user_id===id(2)).can_send,true);
  await db.exec(`update submission_recommendations set admin_review_status='pending';`);
  assert.equal(await send('returned_reviews',[id(2)]),0,'completed recommendation excluded even after preview');
  assert.equal((await preview()).some(r=>r.user_id===id(2)),false);
  await db.exec(`update submissions set submitted_at=now()-interval '1 day' where id='${id(20)}';`);
  assert.equal((await preview()).find(r=>r.user_id===id(2)).task_kind,'pending_reviews','stale recommendation does not hide resubmission');
  assert.equal(await send('not_started',[id(8),id(9),id(7)]),0);
  await db.exec(`select set_config('app.admin','no',false); set role authenticated;`);
  await assert.rejects(preview,/Administrator access/);
  await assert.rejects(()=>send('not_started',[id(6)]),/Administrator access/);
  await assert.rejects(()=>db.query('select * from task_reminder_log'),/permission denied/);
 } finally { await db.close(); }
});
