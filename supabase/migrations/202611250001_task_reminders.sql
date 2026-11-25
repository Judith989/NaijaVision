-- Admin-triggered reminders reuse the dashboard notification and Gmail queue.
create table public.task_reminder_log (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 actor_id uuid not null references auth.users(id),
 task_kind text not null,
 notification_id uuid not null references public.notifications(id),
 created_at timestamptz not null default now()
);
create index task_reminder_recipient_time on public.task_reminder_log(user_id,created_at desc);
alter table public.task_reminder_log enable row level security;
revoke all on public.task_reminder_log from anon,authenticated;

create function public.preview_task_reminders()
returns table(user_id uuid,participant_id text,display_name text,task_kind text,task_count bigint,last_reminded_at timestamptz,can_send boolean)
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Administrator access required'; end if;
 return query
 with tasks as (
  select p.user_id, 'not_started'::text as kind
  from public.profiles p
  where p.role='participant' and p.created_at<now()-interval '24 hours'
   and not exists(select 1 from public.submissions s where s.user_id=p.user_id)
  union all
  select s.user_id,case when s.status='changes_requested' then 'participant_corrections'
   when not exists(select 1 from public.recordings r where r.submission_id=s.id) then 'not_started'
   else 'unfinished_recordings' end
  from public.submissions s
  where s.status in ('draft','recording','uploading','changes_requested')
   and s.updated_at<now()-interval '24 hours'
  union all
  select s.assigned_reviewer_id,case when sr.admin_review_status='returned' then 'returned_reviews' else 'pending_reviews' end
  from public.submissions s left join public.submission_recommendations sr on sr.submission_id=s.id
  where s.status in ('submitted','automated_qc','awaiting_review','resubmitted')
   and s.assigned_reviewer_id is not null and s.assigned_reviewer_id<>s.user_id
   and greatest(s.updated_at,coalesce(sr.updated_at,s.updated_at))<now()-interval '24 hours'
   and not (coalesce(sr.admin_review_status='pending' and sr.reviewer_id=s.assigned_reviewer_id and sr.updated_at>=s.submitted_at,false))
 ), grouped as (
  select t.user_id,t.kind,count(*) as n from tasks t group by t.user_id,t.kind
 )
 select p.user_id,p.participant_id,p.display_name,g.kind,g.n,l.last_at,
  (l.last_at is null or l.last_at<=now()-interval '24 hours')
 from grouped g join public.profiles p on p.user_id=g.user_id
 join auth.users u on u.id=p.user_id
 left join lateral (select max(r.created_at) as last_at from public.task_reminder_log r where r.user_id=p.user_id) l on true
 where p.account_status='active' and u.email_confirmed_at is not null
 order by g.kind,p.participant_id;
end;
$$;

create function public.send_task_reminders(p_task_kind text,p_user_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare r record; n integer:=0; notification uuid; heading text; body text;
begin
 if not public.is_admin() then raise exception 'Administrator access required'; end if;
 if p_task_kind not in ('not_started','unfinished_recordings','participant_corrections','returned_reviews','pending_reviews') or p_task_kind is null then raise exception 'Invalid reminder category'; end if;
 if coalesce(cardinality(p_user_ids),0) not between 1 and 200 then raise exception 'Select between 1 and 200 recipients'; end if;
 -- Serialize send requests, including requests from different administrators.
 perform pg_advisory_xact_lock(611250001);
 heading:=case p_task_kind
  when 'not_started' then 'Reminder: start your NaijaVision contribution'
  when 'unfinished_recordings' then 'Reminder: finish and submit your recordings'
  when 'participant_corrections' then 'Reminder: recordings need your corrections'
  when 'returned_reviews' then 'Reminder: revise your returned reviews'
  else 'Reminder: recordings are waiting for your review' end;
 body:=case p_task_kind
  when 'not_started' then 'If you would still like to participate, sign in and select Record a contribution to begin or continue your setup. Participation remains voluntary.'
  when 'unfinished_recordings' then 'You have an unfinished contribution. Sign in, select Record a contribution, and continue your existing recordings before submitting. Participation remains voluntary.'
  when 'participant_corrections' then 'Your contribution has been returned for corrections. Open Recordings returned for correction in your dashboard, read the feedback, replace the marked recordings, and resubmit.'
  when 'returned_reviews' then 'An administrator returned your review for correction. Open your reviewer workspace, select the assigned submission, and read Administrator returned this review. Resolve the feedback and submit a revised recommendation, or return marked clips to the participant where necessary.'
  else 'You have assigned recordings waiting for review. Open your reviewer workspace, review each recording, and submit your recommendation or return marked clips with feedback.' end;
 for r in select * from public.preview_task_reminders() p where p.task_kind=p_task_kind and p.can_send and p.user_id=any(p_user_ids)
 loop
  insert into public.notifications(user_id,type,title,message) values(r.user_id,'task_reminder',heading,body) returning id into notification;
  insert into public.task_reminder_log(user_id,actor_id,task_kind,notification_id) values(r.user_id,auth.uid(),p_task_kind,notification);
  perform public.write_audit_event('task.reminder_sent','user',r.user_id::text,null,jsonb_build_object('task_kind',p_task_kind,'notification_id',notification,'task_count',r.task_count));
  n:=n+1;
 end loop;
 return n;
end;
$$;
revoke all on function public.preview_task_reminders() from public,anon;
revoke all on function public.send_task_reminders(text,uuid[]) from public,anon;
grant execute on function public.preview_task_reminders() to authenticated;
grant execute on function public.send_task_reminders(text,uuid[]) to authenticated;
