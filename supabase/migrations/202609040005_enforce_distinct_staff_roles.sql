create or replace function public.enforce_reviewer_only_review_authorship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() <> 'reviewer'::public.app_role then
    raise exception 'Only a reviewer account can author clip decisions';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_reviewer_only_review_authorship on public.reviews;
create trigger enforce_reviewer_only_review_authorship
before insert or update on public.reviews
for each row execute function public.enforce_reviewer_only_review_authorship();

create or replace function public.enforce_reviewer_only_recommendation_authorship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() <> 'reviewer'::public.app_role then
    raise exception 'Only a reviewer account can author a reviewer recommendation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_reviewer_only_recommendation_authorship on public.submission_recommendations;
create trigger enforce_reviewer_only_recommendation_authorship
before insert or update of reviewer_id, recommendation, comments on public.submission_recommendations
for each row execute function public.enforce_reviewer_only_recommendation_authorship();

create or replace function public.require_distinct_assigned_reviewer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_reviewer_id is not null and not exists (
    select 1 from public.user_roles
    where user_id = new.assigned_reviewer_id and role = 'reviewer'
  ) then
    raise exception 'Assignments can only be given to reviewer accounts';
  end if;
  if new.assigned_reviewer_id = new.user_id then
    raise exception 'A reviewer cannot be assigned to their own submission';
  end if;
  return new;
end;
$$;

drop trigger if exists require_distinct_assigned_reviewer on public.submissions;
create trigger require_distinct_assigned_reviewer
before insert or update of assigned_reviewer_id on public.submissions
for each row execute function public.require_distinct_assigned_reviewer();

update public.submissions s
set assigned_reviewer_id = null,
    updated_at = now()
where assigned_reviewer_id is not null
  and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = s.assigned_reviewer_id and ur.role = 'reviewer'
  );
