create or replace function public.set_staff_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.app_role;
  v_admin_count integer;
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;
  if p_user_id is null then raise exception 'Select a user'; end if;
  if not exists (select 1 from public.profiles where user_id = p_user_id) then
    raise exception 'User profile not found';
  end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'You cannot remove your own admin access';
  end if;

  select role into v_before from public.profiles where user_id = p_user_id for update;
  if v_before = 'admin' and p_role <> 'admin' then
    select count(distinct user_id) into v_admin_count
    from public.user_roles where role = 'admin';
    if v_admin_count <= 1 then raise exception 'The final administrator cannot be demoted'; end if;
  end if;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles(user_id, role, assigned_by)
  values (p_user_id, p_role, auth.uid());
  update public.profiles
  set role = p_role,
      staff_request_status = 'none',
      updated_at = now()
  where user_id = p_user_id;
  perform public.write_audit_event(
    'role.changed',
    'user',
    p_user_id::text,
    jsonb_build_object('role', v_before),
    jsonb_build_object('role', p_role)
  );
end;
$$;

grant execute on function public.set_staff_role(uuid, public.app_role) to authenticated;

create or replace function public.assign_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.set_staff_role(p_user_id, p_role);
end;
$$;

grant execute on function public.assign_role(uuid, public.app_role) to authenticated;

create or replace function public.request_staff_access()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.profiles
  set staff_request_status = 'pending', updated_at = now()
  where user_id = auth.uid() and role = 'participant' and account_status = 'active';
  if not found then raise exception 'Only active participant accounts can request staff access'; end if;
  perform public.write_audit_event('staff_request.created', 'user', auth.uid()::text, null, null);
end;
$$;

grant execute on function public.request_staff_access() to authenticated;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_or_admin_select
on public.profiles for select to authenticated
using (user_id = auth.uid() or public.is_admin());

create or replace function public.claim_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_reviewer() then raise exception 'Reviewer required'; end if;
  update public.submissions
  set assigned_reviewer_id = auth.uid(), status = 'awaiting_review', updated_at = now()
  where id = p_submission_id
    and status in ('automated_qc', 'awaiting_review', 'resubmitted')
    and (assigned_reviewer_id is null or assigned_reviewer_id = auth.uid() or public.is_admin());
  if not found then raise exception 'Submission is already assigned or unavailable'; end if;
  perform public.write_audit_event('submission.claimed', 'submission', p_submission_id::text, null,
    jsonb_build_object('reviewer_id', auth.uid()));
end;
$$;

grant execute on function public.claim_submission(uuid) to authenticated;

create or replace function public.queue_manual_review(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.submissions
  set status = 'awaiting_review', updated_at = now()
  where id = p_submission_id and user_id = auth.uid() and status = 'automated_qc';
  if not found then raise exception 'Submission is not available for manual review'; end if;
  perform public.write_audit_event('submission.manual_review_queued', 'submission', p_submission_id::text, null, null);
end;
$$;

grant execute on function public.queue_manual_review(uuid) to authenticated;
