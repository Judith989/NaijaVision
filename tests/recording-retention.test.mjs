import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { cleanupRecordings } from '../supabase/functions/cleanup-recordings/cleanup.mjs';

const uid = '00000000-0000-0000-0000-000000000001';
const sid = '00000000-0000-0000-0000-000000000002';
const rid = '00000000-0000-0000-0000-000000000003';
test('retention SQL enforces ownership, review protection, 30 days, leases and preserved logs', async () => {
 const db = new PGlite();
 try {
  await db.exec(`
   create role anon; create role authenticated; create role service_role;
   create schema auth; create schema storage;
   create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.uid',true),'')::uuid $$;
   create function public.has_active_account() returns boolean language sql as $$ select true $$;
   create function public.is_admin() returns boolean language sql as $$ select false $$;
   create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
   create table storage.objects(id uuid,name text,bucket_id text);
   create table submissions(id uuid primary key,user_id uuid,status text,submitted_at timestamptz,approved_at timestamptz,updated_at timestamptz);
   create table recordings(id uuid primary key,submission_id uuid,user_id uuid,object_path text,archived_at timestamptz,archive_path text,storage_deleted_at timestamptz);
   create table payments(id uuid,submission_id uuid,status text);
   create table audit_events(action text,entity_id text,before_data jsonb,after_data jsonb);
   create function write_audit_event(text,text,text,jsonb default null,jsonb default null) returns void language sql as $$ insert into public.audit_events values($1,$3,$4,$5) $$;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202611130001_recording_retention.sql',import.meta.url),'utf8'));
  await db.exec(`insert into submissions(id,user_id,status) values('${sid}','${uid}','recording');
   insert into recordings(id,submission_id,user_id,object_path) values('${rid}','${sid}','${uid}','${uid}/${sid}/clip.webm');`);
  await assert.rejects(()=>db.query(`select delete_my_draft_recordings('${sid}','${rid}')`),/owner required/);
  await db.exec(`set request.uid='${uid}'; update submissions set status='changes_requested';`);
  await assert.rejects(()=>db.query(`select delete_my_draft_recordings('${sid}','${rid}')`),/Only unsubmitted/);
  await assert.rejects(()=>db.query(`delete from recordings where id='${rid}'`),/Only unsubmitted/);
  await db.exec(`update submissions set status='recording';`);
  await db.query(`select delete_my_draft_recordings('${sid}','${rid}')`);
  assert.equal((await db.query('select * from recordings')).rows.length,0);
  assert.equal((await db.query('select * from recording_deletion_jobs')).rows.length,1);
  const first=(await db.query('select * from claim_recording_deletions()')).rows[0];
  assert.equal((await db.query('select * from claim_recording_deletions()')).rows.length,0);
  await db.query('select finish_recording_deletion($1,$2,$3)',[first.id,first.lease_id,'temporary error']);
  assert.equal((await db.query('select deleted_at from recording_deletion_jobs')).rows[0].deleted_at,null);
  await db.exec("update recording_deletion_jobs set next_attempt_at=now()-interval '1 minute';");
  const retried=(await db.query('select * from claim_recording_deletions()')).rows[0];
  assert.notEqual(retried.lease_id,first.lease_id);
  await assert.rejects(()=>db.query('select finish_recording_deletion($1,$2)',[first.id,first.lease_id]),/lease expired/);
  await db.query('select finish_recording_deletion($1,$2)',[retried.id,retried.lease_id]);
  assert.ok((await db.query('select deleted_at from recording_deletion_jobs')).rows[0].deleted_at);
  await db.exec(`insert into recordings(id,submission_id,user_id,object_path) values('${rid}','${sid}','${uid}','${uid}/${sid}/new.webm');
   update submissions set status='rejected'; set request.uid='';`);
  assert.equal((await db.query('select * from claim_recording_deletions()')).rows.length,0,'new final rejection is retained');
  // Advance the rejection timestamp without weakening the deployed trigger.
  await db.exec(`alter table submissions disable trigger guard_retention_submission;
   update submissions set finally_rejected_at=now()-interval '31 days';
   alter table submissions enable trigger guard_retention_submission;
   insert into payments values(gen_random_uuid(),'${sid}','paid');`);
  assert.equal((await db.query('select * from claim_recording_deletions()')).rows.length,0,'payment is protected');
  await db.exec("update payments set status='cancelled'");
  const rejected=(await db.query('select * from claim_recording_deletions()')).rows[0];
  assert.equal(rejected.reason,'finally_rejected_30_days');
  await assert.rejects(()=>db.query("update submissions set status='automated_qc'"),/cannot be restored/);
  await db.query('select finish_recording_deletion($1,$2)',[rejected.id,rejected.lease_id]);
  assert.equal((await db.query('select * from recordings')).rows.length,1,'reviewed metadata retained');
  assert.equal((await db.query('select * from payments')).rows.length,1,'payment record retained');
  assert.ok((await db.query('select storage_deleted_at from recordings')).rows[0].storage_deleted_at);
  assert.equal((await db.query('select * from claim_recording_deletions()')).rows.length,0,'completed deletion does not repeat');
  assert.equal((await db.query("select * from audit_events where action='recording.storage_deleted'")).rows.length,2);
  await db.exec('set role authenticated');
  await assert.rejects(()=>db.query('select * from claim_recording_deletions()'),/permission denied/);
 } finally { await db.close(); }
});

test('worker records success only after storage deletion succeeds and rejects unsafe paths', async () => {
 const jobs=[{id:'1',lease_id:'a',user_id:'u',submission_id:'s',object_path:'u/s/good.webm'},
 {id:'2',lease_id:'b',user_id:'u',submission_id:'s',object_path:'u/s/fail.webm'},
 {id:'3',lease_id:'c',user_id:'u',submission_id:'s',object_path:'another/account/file.webm'}];
 const finishes=[]; const removed=[];
 const service={rpc:async(name,args)=>name==='claim_recording_deletions'?{data:jobs}:{data:finishes.push(args)},
 storage:{from:()=>({remove:async(paths)=>{removed.push(...paths);return {error:paths[0].includes('fail')?new Error('failed'):null};}})}};
 assert.deepEqual(await cleanupRecordings(service),{deleted:1,failed:2});
 assert.deepEqual(removed,['u/s/good.webm','u/s/fail.webm']);
 assert.equal(finishes[0].p_error,null);
 assert.ok(finishes[1].p_error); assert.ok(finishes[2].p_error);
});

