-- Future dashboard notifications are queued atomically. No historical email blast.
create table public.notification_emails (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'pending' check (status in ('pending','processing','sending','sent','failed','skipped','delivery_unknown')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  first_attempt_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  payload jsonb,
  provider_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.notification_emails enable row level security;
revoke all on public.notification_emails from anon, authenticated;
grant all on public.notification_emails to service_role;
create index notification_emails_pending on public.notification_emails(next_attempt_at) where status in ('pending','processing');
create index notification_emails_attempted on public.notification_emails(first_attempt_at);
create table public.notification_email_attempts (
  id bigint generated always as identity primary key,
  email_id uuid not null references public.notification_emails(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index notification_email_attempts_time on public.notification_email_attempts(attempted_at);
alter table public.notification_email_attempts enable row level security;
revoke all on public.notification_email_attempts from anon, authenticated;
grant all on public.notification_email_attempts to service_role;

create function public.queue_notification_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_emails(notification_id,user_id,title)
  values(new.id,new.user_id,new.title) on conflict(notification_id) do nothing;
  return new;
end;
$$;
create trigger queue_notification_email after insert on public.notifications
for each row execute function public.queue_notification_email();

-- One job per claim, with a lease so concurrent cron invocations cannot send it twice.
create function public.claim_notification_email() returns setof public.notification_emails
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_emails;
begin
  -- Serialize rate reservations across overlapping cron/manual invocations.
  if not pg_try_advisory_xact_lock(611050001) then return; end if;
  update public.notification_emails set status='delivery_unknown', last_error='Worker stopped during SMTP send. Check Gmail Sent before retrying.'
  where status='sending' and lease_until<now();
  update public.notification_emails set status='failed', last_error='Maximum email attempts reached.'
  where status in ('pending','processing') and attempts>=8 and (lease_until is null or lease_until<now());
  if exists(select 1 from public.notification_emails where status in ('processing','sending') and lease_until>=now()) then return; end if;
  -- Conservative local caps leave room for signup email. They are not Gmail's account-wide quota.
  if (select count(*) from public.notification_email_attempts where attempted_at>now()-interval '24 hours')>=200
     or (select count(*) from public.notification_email_attempts where attempted_at>now()-interval '1 hour')>=30 then return; end if;
  with candidate as (
    select id from public.notification_emails
    where (status='pending' and next_attempt_at<=now())
       or (status='processing' and lease_until<now())
    order by created_at,id for update skip locked limit 1
  )
  update public.notification_emails e set status='processing', attempts=attempts+1,
    first_attempt_at=coalesce(first_attempt_at,now()), lease_id=gen_random_uuid(), lease_until=now()+interval '2 minutes'
  from candidate c where e.id=c.id returning e.* into v_job;
  if v_job.id is not null then
    insert into public.notification_email_attempts(email_id) values(v_job.id);
    return next v_job;
  end if;
end;
$$;
revoke all on function public.claim_notification_email() from public, anon, authenticated;
grant execute on function public.claim_notification_email() to service_role;
revoke all on function public.queue_notification_email() from public, anon, authenticated;

-- Existing decision, correction, payment and message notifications already cover those events.
-- Fill the assignment and submission handoff gaps without emailing each saved clip.
create function public.notify_submission_handoff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_reviewer_id is distinct from old.assigned_reviewer_id then
    if old.assigned_reviewer_id is not null then
      insert into public.notifications(user_id,type,title,message) values
      (old.assigned_reviewer_id,'review_unassigned','Review assignment changed','Submission '||new.participant_id||' is no longer assigned to you.');
    end if;
    if new.assigned_reviewer_id is not null then
      insert into public.notifications(user_id,type,title,message) values
      (new.assigned_reviewer_id,'review_assigned','New review assigned','Submission '||new.participant_id||' is ready in your review workspace.');
    end if;
  end if;
  if new.submitted_at is distinct from old.submitted_at and new.submitted_at is not null then
    insert into public.notifications(user_id,type,title,message) values
    (new.user_id,'submission_received','Submission received','Your recordings were submitted. We will notify you when there is a review update.');
    if new.assigned_reviewer_id is null then
      insert into public.notifications(user_id,type,title,message)
      select user_id,'submission_needs_assignment','Submission awaiting reviewer assignment',
        'Submission '||new.participant_id||' has been submitted and needs a reviewer.'
      from public.profiles where role='admin' and account_status='active';
    end if;
    if new.assigned_reviewer_id is not null and new.assigned_reviewer_id is not distinct from old.assigned_reviewer_id then
      insert into public.notifications(user_id,type,title,message) values
      (new.assigned_reviewer_id,'submission_resubmitted','Participant submitted recordings','Submission '||new.participant_id||' has new recordings to review.');
    end if;
  end if;
  if new.status is distinct from old.status and new.status in ('payment_eligible','approved','rejected','withdrawn') and new.assigned_reviewer_id is not null then
    insert into public.notifications(user_id,type,title,message) values
    (new.assigned_reviewer_id,'review_outcome','Submission outcome updated','Submission '||new.participant_id||' now has status: '||replace(new.status::text,'_',' ')||'.');
  end if;
  return new;
end;
$$;
create trigger notify_submission_handoff after update on public.submissions
for each row execute function public.notify_submission_handoff();
revoke all on function public.notify_submission_handoff() from public, anon, authenticated;

create function public.notify_admin_review_handoff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP='UPDATE' then
    if new.admin_review_status is not distinct from old.admin_review_status
       and new.recommendation is not distinct from old.recommendation
       and new.comments is not distinct from old.comments then return new; end if;
  end if;
  if new.admin_review_status in ('pending','participant_returned') then
    insert into public.notifications(user_id,type,title,message)
    select user_id,'review_handoff',
      case when new.admin_review_status='participant_returned' then 'Reviewer returned recordings to participant' else 'Review ready for administrator' end,
      'Submission '||new.submission_id::text||' has a review update. Open the admin workspace for details.'
    from public.profiles where role='admin' and account_status='active';
  end if;
  return new;
end;
$$;
create trigger notify_admin_review_handoff after insert or update on public.submission_recommendations
for each row execute function public.notify_admin_review_handoff();
revoke all on function public.notify_admin_review_handoff() from public, anon, authenticated;
