-- Allow reviewers to contact only participants whose submissions they are
-- assigned to or have actually reviewed. Delivery uses the participant's
-- existing private dashboard notification feed.

create table if not exists public.reviewer_participant_messages (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  notification_id uuid not null unique references public.notifications(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  participant_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.reviewer_participant_messages enable row level security;
revoke all on table public.reviewer_participant_messages from public, anon, authenticated;

create index if not exists reviewer_participant_messages_reviewer_idx
  on public.reviewer_participant_messages(reviewer_id, created_at desc);
create index if not exists reviewer_participant_messages_participant_idx
  on public.reviewer_participant_messages(participant_user_id, created_at desc);

create or replace function public.send_reviewer_message(
  p_submission_id uuid,
  p_title text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions;
  v_notification_id uuid;
  v_message_id uuid;
  v_has_review_history boolean;
begin
  if not public.is_reviewer() or public.is_admin() then
    raise exception 'Reviewer access required';
  end if;

  select * into v_submission
  from public.submissions
  where id = p_submission_id;

  if v_submission.id is null then
    raise exception 'Submission not found';
  end if;
  if v_submission.user_id = auth.uid() then
    raise exception 'You cannot message yourself as a reviewer';
  end if;

  select exists(
    select 1 from public.reviews r
    where r.submission_id = p_submission_id and r.reviewer_id = auth.uid()
    union all
    select 1 from public.submission_recommendations sr
    where sr.submission_id = p_submission_id and sr.reviewer_id = auth.uid()
  ) into v_has_review_history;

  if v_submission.assigned_reviewer_id is distinct from auth.uid() and not v_has_review_history then
    raise exception 'You may message only participants assigned to you or previously reviewed by you';
  end if;
  if length(trim(coalesce(p_title, ''))) not between 3 and 120 then
    raise exception 'Enter a title between 3 and 120 characters';
  end if;
  if length(trim(coalesce(p_message, ''))) not between 3 and 2000 then
    raise exception 'Enter a message between 3 and 2000 characters';
  end if;

  insert into public.notifications(user_id, type, title, message)
  values(v_submission.user_id, 'reviewer_message', trim(p_title), trim(p_message))
  returning id into v_notification_id;

  insert into public.reviewer_participant_messages(
    submission_id, notification_id, reviewer_id, participant_user_id, title, message
  ) values(
    p_submission_id, v_notification_id, auth.uid(), v_submission.user_id,
    trim(p_title), trim(p_message)
  ) returning id into v_message_id;

  perform public.write_audit_event(
    'reviewer.message_sent', 'reviewer_participant_message', v_message_id::text, null,
    jsonb_build_object('submission_id', p_submission_id, 'notification_id', v_notification_id)
  );
  return v_message_id;
end;
$$;

revoke all on function public.send_reviewer_message(uuid,text,text) from public, anon;
grant execute on function public.send_reviewer_message(uuid,text,text) to authenticated;

