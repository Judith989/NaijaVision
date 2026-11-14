-- Expose only a completion flag for the caller's own submissions, not internal reviewer notes.
create or replace function public.get_my_review_progress()
returns table(submission_id uuid, human_review_complete boolean)
language sql stable security definer set search_path='' as $$
 select s.id, coalesce(
   s.status in ('approved','payment_eligible','payment_processing','paid','rejected')
   or (s.status in ('submitted','automated_qc','awaiting_review','resubmitted')
     and sr.admin_review_status='pending'
     and sr.reviewer_id=s.assigned_reviewer_id
     and sr.updated_at>=s.submitted_at), false)
 from public.submissions s
 left join public.submission_recommendations sr on sr.submission_id=s.id
 where s.user_id=auth.uid() and public.has_active_account();
$$;
revoke all on function public.get_my_review_progress() from public,anon;
grant execute on function public.get_my_review_progress() to authenticated;
