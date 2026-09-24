-- Require administrator approval before a new account can use NaijaVision.

alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('pending', 'active', 'suspended', 'closed'));
alter table public.profiles alter column account_status set default 'pending';

create or replace function public.has_active_account()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and account_status = 'active'
  );
$$;

create or replace function public.is_reviewer()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.has_active_account() and public.current_app_role() in ('reviewer', 'admin'); $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.has_active_account() and public.current_app_role() = 'admin'; $$;

create or replace function public.require_active_staff_role()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.role <> 'participant' and new.account_status <> 'active' then
    raise exception 'Approve the account before granting staff access';
  end if;
  return new;
end;
$$;

drop trigger if exists require_active_staff_role on public.profiles;
create trigger require_active_staff_role
before insert or update of role, account_status on public.profiles
for each row execute function public.require_active_staff_role();

-- Profile status and role changes must only happen through protected RPCs.
drop policy if exists profiles_self_update on public.profiles;

drop policy if exists consents_self_insert on public.consents;
create policy consents_active_owner_insert on public.consents for insert to authenticated
with check (user_id = auth.uid() and public.has_active_account());

drop policy if exists surveys_owner_all on public.surveys;
create policy surveys_owner_read on public.surveys for select to authenticated
using (user_id = auth.uid());
create policy surveys_active_owner_insert on public.surveys for insert to authenticated
with check (user_id = auth.uid() and public.has_active_account());
create policy surveys_active_owner_update on public.surveys for update to authenticated
using (user_id = auth.uid() and public.has_active_account())
with check (user_id = auth.uid() and public.has_active_account());

drop policy if exists submissions_self_insert on public.submissions;
create policy submissions_active_owner_insert on public.submissions for insert to authenticated
with check (user_id = auth.uid() and public.has_active_account());

drop policy if exists recordings_owner_insert on public.recordings;
create policy recordings_active_owner_insert on public.recordings for insert to authenticated
with check (
  user_id = auth.uid() and public.has_active_account()
  and exists (
    select 1 from public.submissions s
    where s.id = submission_id and s.user_id = auth.uid()
      and s.status in ('draft', 'recording', 'uploading', 'changes_requested', 'resubmitted')
  )
  and exists (
    select 1 from public.prompt_assignments pa
    where pa.id = prompt_assignment_id and pa.submission_id = submission_id
  )
);

drop policy if exists raw_recordings_participant_insert on storage.objects;
create policy raw_recordings_active_participant_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'raw-recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.has_active_account()
);

-- Assigned access always requires a currently active reviewer account.
drop policy if exists submissions_owner_admin_or_assigned_reviewer_read on public.submissions;
create policy submissions_owner_admin_or_assigned_reviewer_read
on public.submissions for select to authenticated
using (user_id = auth.uid() or public.is_admin() or (public.is_reviewer() and assigned_reviewer_id = auth.uid()));

drop policy if exists assignments_owner_admin_or_assigned_reviewer_read on public.prompt_assignments;
create policy assignments_owner_admin_or_assigned_reviewer_read
on public.prompt_assignments for select to authenticated
using (exists (
  select 1 from public.submissions s where s.id = submission_id
    and (s.user_id = auth.uid() or public.is_admin() or (public.is_reviewer() and s.assigned_reviewer_id = auth.uid()))
));

drop policy if exists recordings_owner_or_assigned_staff_read on public.recordings;
create policy recordings_owner_or_assigned_staff_read
on public.recordings for select to authenticated
using (user_id = auth.uid() or public.is_admin() or (public.is_reviewer() and exists (
  select 1 from public.submissions s where s.id = submission_id and s.assigned_reviewer_id = auth.uid()
)));

drop policy if exists reviews_assigned_staff_all on public.reviews;
create policy reviews_assigned_staff_all
on public.reviews for all to authenticated
using (public.is_admin() or (public.is_reviewer() and exists (
  select 1 from public.submissions s where s.id = submission_id and s.assigned_reviewer_id = auth.uid()
)))
with check (reviewer_id = auth.uid() and public.is_reviewer() and exists (
  select 1 from public.submissions s where s.id = submission_id and s.assigned_reviewer_id = auth.uid()
));

drop policy if exists raw_recordings_owner_or_assigned_staff_read on storage.objects;
create policy raw_recordings_owner_or_assigned_staff_read
on storage.objects for select to authenticated
using (bucket_id = 'raw-recordings' and (
  (storage.foldername(name))[1] = auth.uid()::text
  or public.is_admin()
  or (public.is_reviewer() and exists (
    select 1 from public.submissions s
    where s.id::text = (storage.foldername(name))[2] and s.assigned_reviewer_id = auth.uid()
  ))
));

drop policy if exists consents_owner_or_assigned_staff_read on public.consents;
create policy consents_owner_or_assigned_staff_read
on public.consents for select to authenticated
using (user_id = auth.uid() or public.is_admin() or (public.is_reviewer() and exists (
  select 1 from public.submissions s where s.consent_id = consents.id and s.assigned_reviewer_id = auth.uid()
)));

drop policy if exists surveys_assigned_staff_read on public.surveys;
create policy surveys_assigned_staff_read
on public.surveys for select to authenticated
using (public.is_admin() or (public.is_reviewer() and exists (
  select 1 from public.submissions s where s.survey_id = surveys.id and s.assigned_reviewer_id = auth.uid()
)));

drop policy if exists recommendation_assigned_reviewer_read on public.submission_recommendations;
create policy recommendation_assigned_reviewer_read
on public.submission_recommendations for select to authenticated
using (public.is_admin() or (public.is_reviewer() and exists (
  select 1 from public.submissions s where s.id = submission_id and s.assigned_reviewer_id = auth.uid()
)));

drop policy if exists "Participants can submit prompt issues" on public.prompt_issue_reports;
create policy "Active participants can submit prompt issues"
on public.prompt_issue_reports for insert to authenticated
with check (user_id = auth.uid() and public.has_active_account());
drop policy if exists "Staff can read prompt issues" on public.prompt_issue_reports;
create policy "Active staff can read prompt issues"
on public.prompt_issue_reports for select to authenticated using (public.is_reviewer());
drop policy if exists "Staff can update prompt issues" on public.prompt_issue_reports;
create policy "Active staff can update prompt issues"
on public.prompt_issue_reports for update to authenticated
using (public.is_reviewer()) with check (public.is_reviewer());

drop policy if exists raw_recordings_owner_delete_draft on storage.objects;
create policy raw_recordings_active_owner_delete_draft on storage.objects
for delete to authenticated
using (
  bucket_id = 'raw-recordings' and (storage.foldername(name))[1] = auth.uid()::text
  and public.has_active_account()
  and exists (
    select 1 from public.submissions s
    where s.id::text = (storage.foldername(name))[2] and s.user_id = auth.uid()
      and s.status in ('draft', 'recording', 'uploading', 'changes_requested')
  )
);

create or replace function public.require_active_owner_mutation()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_owner uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if auth.uid() = v_owner and not public.has_active_account() then
    raise exception 'Account is not active';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists require_active_submission_owner on public.submissions;
create trigger require_active_submission_owner
before insert or update or delete on public.submissions
for each row execute function public.require_active_owner_mutation();
drop trigger if exists require_active_recording_owner on public.recordings;
create trigger require_active_recording_owner
before insert or update or delete on public.recordings
for each row execute function public.require_active_owner_mutation();

create or replace function public.enforce_reviewer_only_review_authorship()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_active_account() or public.current_app_role() <> 'reviewer'::public.app_role then
    raise exception 'Only an active reviewer account can author clip decisions';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_reviewer_only_recommendation_authorship()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_active_account() or public.current_app_role() <> 'reviewer'::public.app_role then
    raise exception 'Only an active reviewer account can author a reviewer recommendation';
  end if;
  return new;
end;
$$;

create or replace function public.require_distinct_assigned_reviewer()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.assigned_reviewer_id is not null and not exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.user_id = ur.user_id
    where ur.user_id = new.assigned_reviewer_id and ur.role = 'reviewer' and p.account_status = 'active'
  ) then raise exception 'Assignments can only be given to active reviewer accounts'; end if;
  if new.assigned_reviewer_id = new.user_id then raise exception 'A reviewer cannot be assigned to their own submission'; end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_display_name text := nullif(trim(new.raw_user_meta_data->>'full_name'), '');
  v_pending_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('naijavision_pending_accounts'));
  select count(*) into v_pending_count from public.profiles where account_status = 'pending';
  if v_pending_count >= 100 then
    raise exception 'The account request queue is temporarily full';
  end if;
  insert into public.profiles(user_id, display_name, account_status, staff_request_status)
  values (new.id, v_display_name, 'pending', 'none');
  insert into public.user_roles(user_id, role) values (new.id, 'participant');
  return new;
end;
$$;

create or replace function public.approve_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;
  update public.profiles
  set account_status = 'active', updated_at = now()
  where user_id = p_user_id and account_status = 'pending';
  if not found then raise exception 'Pending account not found'; end if;
  insert into public.notifications(user_id, type, title, message)
  values (p_user_id, 'account_approved', 'Account approved', 'Your NaijaVision account has been approved. You can now begin or continue a contribution.');
  perform public.write_audit_event('account.approved', 'user', p_user_id::text, null, null);
end;
$$;

create or replace function public.decline_account(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin required'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot decline your own account'; end if;
  update public.profiles
  set account_status = 'closed', updated_at = now()
  where user_id = p_user_id and account_status = 'pending' and role <> 'admin';
  if not found then raise exception 'Pending non-admin account not found'; end if;
  insert into public.notifications(user_id, type, title, message)
  values (p_user_id, 'account_declined', 'Account request declined', trim(p_reason));
  perform public.write_audit_event('account.declined', 'user', p_user_id::text, null,
    jsonb_build_object('reason', trim(p_reason)));
end;
$$;

revoke execute on function public.approve_account(uuid) from public, anon;
revoke execute on function public.decline_account(uuid, text) from public, anon;
grant execute on function public.approve_account(uuid) to authenticated;
grant execute on function public.decline_account(uuid, text) to authenticated;

-- Retire legacy public staff-request and role wrappers. The administrator UI
-- uses set_staff_role, which performs its own active-admin checks and audit.
revoke execute on function public.request_staff_access() from public, anon, authenticated;
revoke execute on function public.assign_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.dismiss_staff_request(uuid) from public, anon, authenticated;
