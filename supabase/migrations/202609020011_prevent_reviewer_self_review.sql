create or replace function public.prevent_non_admin_self_review()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() and exists (
    select 1
    from public.submissions s
    where s.id = new.submission_id
      and s.user_id = new.reviewer_id
  ) then
    raise exception 'Reviewers cannot review their own submission';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_self_review_on_reviews on public.reviews;
create trigger prevent_self_review_on_reviews
before insert or update on public.reviews
for each row execute function public.prevent_non_admin_self_review();

drop trigger if exists prevent_self_review_on_recommendations on public.submission_recommendations;
create trigger prevent_self_review_on_recommendations
before insert or update on public.submission_recommendations
for each row execute function public.prevent_non_admin_self_review();

create or replace function public.assign_submission(p_submission_id uuid, p_reviewer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_target_is_admin boolean;
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;

  select s.user_id into v_owner_id
  from public.submissions s
  where s.id = p_submission_id;
  if v_owner_id is null then raise exception 'Submission not found'; end if;

  select exists (
    select 1 from public.user_roles
    where user_id = p_reviewer_id and role = 'admin'
  ) into v_target_is_admin;

  if not exists (
    select 1 from public.user_roles
    where user_id = p_reviewer_id and role in ('reviewer', 'admin')
  ) then
    raise exception 'User is not a reviewer';
  end if;

  if v_owner_id = p_reviewer_id and not v_target_is_admin then
    raise exception 'A reviewer cannot be assigned to their own submission';
  end if;

  update public.submissions
  set assigned_reviewer_id = p_reviewer_id,
      status = 'awaiting_review',
      updated_at = now()
  where id = p_submission_id
    and status in ('automated_qc', 'awaiting_review', 'resubmitted');

  perform public.write_audit_event(
    'submission.assigned',
    'submission',
    p_submission_id::text,
    null,
    jsonb_build_object('reviewer_id', p_reviewer_id)
  );
end;
$$;

grant execute on function public.assign_submission(uuid, uuid) to authenticated;

update public.submissions s
set assigned_reviewer_id = null,
    updated_at = now()
where s.assigned_reviewer_id = s.user_id
  and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = s.assigned_reviewer_id and ur.role = 'admin'
  );
