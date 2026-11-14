-- Media cleanup never deletes reviewed recording metadata, approvals or payments.
begin;
alter table public.submissions add column if not exists finally_rejected_at timestamptz;
-- Existing rejections get a full grace period from installation.
update public.submissions set finally_rejected_at = now() where status = 'rejected' and finally_rejected_at is null;
alter table public.recordings add column if not exists storage_deletion_reason text;

create table public.recording_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null,
  submission_id uuid not null,
  user_id uuid not null,
  object_path text not null unique,
  reason text not null check (reason in ('participant_deleted_draft','finally_rejected_30_days')),
  metadata jsonb not null,
  requested_at timestamptz not null default now(),
  deleted_at timestamptz,
  attempts integer not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text
);
alter table public.recording_deletion_jobs enable row level security;
revoke all on public.recording_deletion_jobs from anon, authenticated;
grant select on public.recording_deletion_jobs to authenticated;
create policy deletion_logs_admin_read on public.recording_deletion_jobs for select to authenticated using (public.is_admin());
grant all on public.recording_deletion_jobs to service_role;

create function public.guard_retention_submission() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status is distinct from new.status and exists (
    select 1 from public.recording_deletion_jobs where submission_id=old.id and reason='finally_rejected_30_days'
  ) then raise exception 'Rejected recordings have entered permanent cleanup and cannot be restored'; end if;
  new.finally_rejected_at := case
    when new.status='rejected' and old.status<>'rejected' then now()
    when new.status='rejected' then old.finally_rejected_at
    else null end;
  return new;
end; $$;
create trigger guard_retention_submission before update on public.submissions
for each row execute function public.guard_retention_submission();

-- Serialize deletion against submission handoff and keep a durable retryable tombstone.
create function public.queue_deleted_draft_recording() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  select * into s from public.submissions where id=old.submission_id for update;
  if s.status not in ('draft','recording','uploading') or s.submitted_at is not null then
    raise exception 'Only unsubmitted recordings can be deleted';
  end if;
  if old.archived_at is not null or old.storage_deleted_at is not null then
    raise exception 'Archived recording logs must be preserved';
  end if;
  insert into public.recording_deletion_jobs(recording_id,submission_id,user_id,object_path,reason,metadata)
  values(old.id,old.submission_id,old.user_id,old.object_path,'participant_deleted_draft',to_jsonb(old))
  on conflict(object_path) do nothing;
  perform public.write_audit_event('recording.draft_deletion_requested','recording',old.id::text,
    to_jsonb(old),jsonb_build_object('reason','participant_deleted_draft'));
  return old;
end; $$;
create trigger queue_deleted_draft_recording before delete on public.recordings
for each row execute function public.queue_deleted_draft_recording();

drop policy if exists recordings_self_draft_delete on public.recordings;
create policy recordings_self_draft_delete on public.recordings for delete to authenticated
using (user_id=auth.uid() and public.has_active_account() and exists (
 select 1 from public.submissions s where s.id=submission_id and s.user_id=auth.uid()
 and s.status in ('draft','recording','uploading') and s.submitted_at is null));

create function public.delete_my_draft_recordings(p_submission_id uuid, p_recording_id uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.submissions; n integer;
begin
  select * into s from public.submissions where id=p_submission_id for update;
  if auth.uid() is null or s.user_id is distinct from auth.uid() or not public.has_active_account() then
    raise exception 'Active submission owner required'; end if;
  if s.status not in ('draft','recording','uploading') or s.submitted_at is not null then
    raise exception 'Only unsubmitted contributions can be deleted'; end if;
  delete from public.recordings where submission_id=s.id and (p_recording_id is null or id=p_recording_id);
  get diagnostics n = row_count;
  if p_recording_id is not null and n=0 then raise exception 'Recording not found'; end if;
  if p_recording_id is null then
    update public.submissions set status='withdrawn',updated_at=now() where id=s.id;
    perform public.write_audit_event('submission.draft_discarded','submission',s.id::text,null,jsonb_build_object('recording_count',n));
  end if;
  return n;
end; $$;
revoke all on function public.delete_my_draft_recordings(uuid,uuid) from public,anon;
grant execute on function public.delete_my_draft_recordings(uuid,uuid) to authenticated;

-- Browser cleanup may remove abandoned uploads, but never a currently linked recording.
-- Linked draft deletion goes through the audited queue; redo replacements retain the old file until saved.
drop policy if exists raw_recordings_active_owner_delete_draft on storage.objects;
create policy raw_recordings_active_owner_delete_draft on storage.objects for delete to authenticated
using (bucket_id='raw-recordings' and (storage.foldername(name))[1]=auth.uid()::text
 and public.has_active_account()
 and not exists(select 1 from public.recordings r where r.object_path=name)
 and exists(select 1 from public.submissions s where s.id::text=(storage.foldername(name))[2]
 and s.user_id=auth.uid() and s.status in ('draft','recording','uploading','changes_requested')));

create function public.guard_recording_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  select * into s from public.submissions where id=new.submission_id for update;
  if auth.uid()=new.user_id and (s.status not in ('draft','recording','uploading','changes_requested') or s.user_id<>auth.uid()) then
    raise exception 'Recordings cannot be edited in this submission status'; end if;
  if TG_OP='INSERT' or new.object_path is distinct from old.object_path then
    if exists(select 1 from public.recording_deletion_jobs where object_path=new.object_path) then
      raise exception 'Deleted storage paths cannot be reused'; end if;
  end if;
  if TG_OP='UPDATE' and new.object_path is distinct from old.object_path and exists (
    select 1 from public.recording_deletion_jobs where recording_id=old.id and reason='finally_rejected_30_days'
  ) then raise exception 'Recording has entered permanent cleanup'; end if;
  return new;
end; $$;
create trigger guard_recording_cleanup before insert or update on public.recordings
for each row execute function public.guard_recording_cleanup();

create function public.claim_recording_deletions() returns setof public.recording_deletion_jobs
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  -- Lock parent first: a simultaneous restoration either wins before this check or is blocked afterwards.
  for s in select * from public.submissions where status='rejected'
    and finally_rejected_at <= now()-interval '30 days' and approved_at is null
    and not exists(select 1 from public.payments p where p.submission_id=submissions.id and p.status not in ('not_eligible','cancelled'))
    and exists(select 1 from public.recordings r where r.submission_id=submissions.id and r.storage_deleted_at is null
      and not exists(select 1 from public.recording_deletion_jobs j where j.object_path=r.object_path))
    and not exists(select 1 from public.recordings r where r.submission_id=submissions.id and r.archived_at is not null)
    order by finally_rejected_at limit 10 for update skip locked
  loop
    insert into public.recording_deletion_jobs(recording_id,submission_id,user_id,object_path,reason,metadata)
    select r.id,r.submission_id,r.user_id,r.object_path,'finally_rejected_30_days',to_jsonb(r)
    from public.recordings r where r.submission_id=s.id and r.storage_deleted_at is null
    on conflict(object_path) do nothing;
  end loop;
  return query with candidates as (
    select id from public.recording_deletion_jobs where deleted_at is null and next_attempt_at<=now()
    and (lease_until is null or lease_until<now()) order by requested_at limit 10 for update skip locked
  ) update public.recording_deletion_jobs j set lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
    from candidates c where j.id=c.id returning j.*;
end; $$;

create function public.finish_recording_deletion(p_id uuid,p_lease_id uuid,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare j public.recording_deletion_jobs;
begin
  select * into j from public.recording_deletion_jobs where id=p_id and lease_id=p_lease_id and deleted_at is null for update;
  if not found then raise exception 'Deletion lease expired'; end if;
  if p_error is not null then
    update public.recording_deletion_jobs set last_error=left(p_error,500),lease_until=null,
      next_attempt_at=now()+interval '1 hour' where id=j.id;
    return;
  end if;
  update public.recording_deletion_jobs set deleted_at=now(),last_error=null,lease_until=null where id=j.id;
  update public.recordings set storage_deleted_at=now(),storage_deletion_reason=j.reason
    where id=j.recording_id and object_path=j.object_path and storage_deleted_at is null;
  perform public.write_audit_event('recording.storage_deleted','recording',j.recording_id::text,null,
    jsonb_build_object('object_path',j.object_path,'submission_id',j.submission_id,'reason',j.reason,'job_id',j.id));
end; $$;
revoke all on function public.claim_recording_deletions() from public,anon,authenticated;
revoke all on function public.finish_recording_deletion(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_recording_deletions() to service_role;
grant execute on function public.finish_recording_deletion(uuid,uuid,text) to service_role;
revoke all on function public.guard_retention_submission(),public.queue_deleted_draft_recording(),public.guard_recording_cleanup() from public,anon,authenticated;
commit;
