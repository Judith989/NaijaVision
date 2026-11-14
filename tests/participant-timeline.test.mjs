import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { participantTimeline } from '../src/app/lib/participantTimeline.ts';

test('timeline distinguishes waiting, completed review, corrections and final approval', () => {
 assert.deepEqual(participantTimeline(undefined,false).map(x=>x[1]),[false,false,false,false]);
 assert.deepEqual(participantTimeline({status:'recording',submitted_at:null},false).map(x=>x[1]),[false,false,false,false]);
 assert.deepEqual(participantTimeline({status:'awaiting_review',submitted_at:'date'},false).map(x=>x[1]),[true,false,false,false]);
 assert.deepEqual(participantTimeline({status:'awaiting_review',submitted_at:'date'},true).map(x=>x[1]),[true,true,false,false]);
 assert.equal(participantTimeline({status:'changes_requested',submitted_at:'date'},true)[1][1],false);
 assert.deepEqual(participantTimeline({status:'payment_eligible',submitted_at:'date'},false).map(x=>x[1]),[true,true,true,false]);
 assert.deepEqual(participantTimeline({status:'paid',submitted_at:'date'},false).map(x=>x[1]),[true,true,true,true]);
});
test('review progress only exposes own submissions and ignores stale or returned recommendations', async () => {
 const db=new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
 create function has_active_account() returns boolean language sql as $$ select true $$;
 create table submissions(id uuid,user_id uuid,status text,assigned_reviewer_id uuid,submitted_at timestamptz);
 create table submission_recommendations(submission_id uuid,reviewer_id uuid,admin_review_status text,updated_at timestamptz);
 insert into submissions values(gen_random_uuid(),auth.uid(),'awaiting_review',auth.uid(),now()),(gen_random_uuid(),gen_random_uuid(),'paid',null,now());`);
 await db.exec(await readFile(new URL('../supabase/migrations/202611140001_participant_review_progress.sql',import.meta.url),'utf8'));
 const flag=async()=> (await db.query('select * from get_my_review_progress()')).rows;
 assert.equal((await flag()).length,1);
 assert.equal((await flag())[0].human_review_complete,false);
 await db.exec(`insert into submission_recommendations select id,assigned_reviewer_id,'pending',now()+interval '1 second' from submissions where user_id=auth.uid();`);
 assert.equal((await flag())[0].human_review_complete,true);
 await db.exec("update submission_recommendations set admin_review_status='returned'");
 assert.equal((await flag())[0].human_review_complete,false);
 await db.exec("update submission_recommendations set admin_review_status='pending',updated_at=now()-interval '1 day'");
 assert.equal((await flag())[0].human_review_complete,false);
 await db.exec('set role anon');
 await assert.rejects(()=>flag(),/permission denied/);
 } finally {await db.close();}
});
