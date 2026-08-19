create table if not exists public.prompt_issue_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete set null,
  prompt_id text not null references public.prompts(id),
  issue_text text not null check (char_length(trim(issue_text)) between 3 and 2000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  reviewer_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.prompt_issue_reports enable row level security;

create policy "Participants can submit prompt issues"
on public.prompt_issue_reports for insert to authenticated
with check (user_id = auth.uid());

create policy "Participants can read their prompt issues"
on public.prompt_issue_reports for select to authenticated
using (user_id = auth.uid());

create policy "Staff can read prompt issues"
on public.prompt_issue_reports for select to authenticated
using (public.current_app_role() in ('reviewer', 'admin'));

create policy "Staff can update prompt issues"
on public.prompt_issue_reports for update to authenticated
using (public.current_app_role() in ('reviewer', 'admin'))
with check (public.current_app_role() in ('reviewer', 'admin'));

create index if not exists prompt_issue_reports_status_created_idx
on public.prompt_issue_reports(status, created_at desc);
