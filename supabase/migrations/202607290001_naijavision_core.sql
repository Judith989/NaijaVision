-- NaijaVision production schema
-- Apply with the Supabase CLI after creating a project.

create extension if not exists pgcrypto;

create type public.app_role as enum ('participant', 'reviewer', 'admin');
create type public.submission_status as enum (
  'draft', 'recording', 'uploading', 'submitted', 'automated_qc',
  'awaiting_review', 'changes_requested', 'resubmitted', 'approved',
  'rejected', 'payment_eligible', 'payment_processing', 'paid', 'withdrawn'
);
create type public.review_decision as enum ('approved', 'rejected', 'changes_requested');
create type public.payment_status as enum ('not_eligible', 'eligible', 'processing', 'paid', 'failed', 'cancelled');
create type public.withdrawal_status as enum ('requested', 'processing', 'completed', 'denied');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  participant_id text not null unique default ('NV-' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12))),
  display_name text,
  role public.app_role not null default 'participant',
  account_status text not null default 'active' check (account_status in ('active', 'suspended', 'closed')),
  contact_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  country text not null,
  bank_code text not null,
  bank_name text not null,
  account_name text not null,
  account_last4 text not null check (length(account_last4) between 2 and 4),
  provider text not null,
  provider_recipient_code text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.payout_accounts is 'Contains only a payment-provider token and masked account details. Never store full account numbers here.';

create table public.consent_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  body_markdown text not null,
  body_sha256 text not null,
  public_release_required boolean not null default true,
  effective_at timestamptz not null,
  retired_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_version_id uuid not null references public.consent_versions(id),
  adult_confirmed boolean not null,
  informed_consent boolean not null,
  public_release_consent boolean not null,
  ai_training_consent boolean not null,
  safe_speech_opt_in boolean not null default false,
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  verification_event_id text,
  unique (user_id, consent_version_id)
);

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null default 1,
  responses jsonb not null,
  submitted_at timestamptz not null default now(),
  unique (user_id, version)
);

create table public.prompts (
  id text primary key,
  version integer not null default 1,
  prompt_type text not null,
  language text not null,
  language_sequence text[] not null default '{}',
  original_text text not null,
  normalized_text text not null,
  tone_marked_text text,
  english_translation text,
  response_seconds integer,
  safe_speech boolean not null default false,
  phonetic_tags text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, version)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_id text not null,
  consent_id uuid not null references public.consents(id),
  survey_id uuid not null references public.surveys(id),
  status public.submission_status not null default 'draft',
  assigned_reviewer_id uuid references auth.users(id),
  expected_recordings integer not null,
  accepted_recordings integer not null default 0,
  risk_score numeric(5,2) not null default 0,
  compensation_amount numeric(12,2),
  compensation_currency text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index submissions_one_open_per_user
on public.submissions(user_id)
where status not in ('paid', 'rejected', 'withdrawn');

create table public.prompt_assignments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  prompt_id text not null references public.prompts(id),
  sequence_number integer not null,
  required boolean not null default true,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (submission_id, prompt_id),
  unique (submission_id, sequence_number)
);

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt_assignment_id uuid not null references public.prompt_assignments(id),
  object_path text not null unique,
  checksum_sha256 text not null,
  content_type text not null,
  file_size bigint not null check (file_size > 0),
  duration_seconds numeric(8,3) not null,
  video_width integer,
  video_height integer,
  frame_rate numeric(7,3),
  audio_sample_rate integer,
  audio_channels integer,
  bit_rate integer,
  device_orientation text,
  browser text,
  operating_system text,
  device_category text,
  device_model text,
  recording_location text,
  lighting_condition text,
  measured_light_level numeric(8,3),
  estimated_noise numeric(12,8),
  snr_db numeric(8,3),
  clipping_rate numeric(12,8),
  speaking_style text,
  language text not null,
  dialect text,
  language_sequence text[] not null default '{}',
  original_transcript text not null,
  normalized_transcript text not null,
  english_translation text,
  quality_status text not null default 'pending',
  human_validation_status text not null default 'pending',
  uploaded_at timestamptz not null default now(),
  unique (submission_id, prompt_assignment_id)
);

create table public.recording_quality (
  recording_id uuid primary key references public.recordings(id) on delete cascade,
  media_probe jsonb not null default '{}',
  mouth_visibility_score numeric(6,5),
  face_leak_detected boolean,
  speech_activity_ratio numeric(6,5),
  av_offset_ms integer,
  frozen_frame_ratio numeric(6,5),
  duplicate_score numeric(6,5),
  prompt_similarity numeric(6,5),
  language_confidence numeric(6,5),
  pii_detected boolean,
  background_speech_detected boolean,
  checks_passed boolean not null default false,
  failure_codes text[] not null default '{}',
  checked_at timestamptz,
  pipeline_version text
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  recording_id uuid references public.recordings(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  decision public.review_decision not null,
  reason_codes text[] not null default '{}',
  comments text,
  transcript_correct boolean,
  framing_correct boolean,
  audio_acceptable boolean,
  privacy_acceptable boolean,
  duplicate_suspected boolean not null default false,
  reviewed_at timestamptz not null default now(),
  unique (recording_id, reviewer_id)
);

create table public.risk_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete cascade,
  flag_type text not null,
  score numeric(6,5) not null,
  evidence jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'dismissed', 'confirmed')),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.compensation_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null,
  minimum_accepted_recordings integer not null,
  partial_payment_allowed boolean not null default false,
  effective_at timestamptz not null,
  retired_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions(id),
  user_id uuid not null references auth.users(id),
  payout_account_id uuid not null references public.payout_accounts(id),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null,
  status public.payment_status not null default 'not_eligible',
  provider text,
  provider_transaction_reference text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  processed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  submission_id uuid references public.submissions(id),
  status public.withdrawal_status not null default 'requested',
  reason text,
  release_limitation_acknowledged boolean not null default false,
  handled_by uuid references auth.users(id),
  response text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create table public.dataset_releases (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  status text not null default 'draft' check (status in ('draft', 'privacy_review', 'approved', 'published', 'withdrawn')),
  license text,
  dataset_card_path text,
  approved_by uuid references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (name, version)
);

create table public.release_items (
  release_id uuid not null references public.dataset_releases(id) on delete cascade,
  recording_id uuid not null references public.recordings(id),
  release_speaker_id text not null,
  release_object_path text not null,
  privacy_reviewed_by uuid not null references auth.users(id),
  privacy_reviewed_at timestamptz not null,
  primary key (release_id, recording_id),
  unique (release_id, release_object_path)
);

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select ur.role from public.user_roles ur where ur.user_id = auth.uid() order by
      case ur.role when 'admin' then 1 when 'reviewer' then 2 else 3 end limit 1),
    'participant'::public.app_role
  );
$$;

create or replace function public.is_reviewer()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.current_app_role() in ('reviewer', 'admin'); $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.current_app_role() = 'admin'; $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(user_id) values (new.id);
  insert into public.user_roles(user_id, role) values (new.id, 'participant');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.payout_accounts enable row level security;
alter table public.consent_versions enable row level security;
alter table public.consents enable row level security;
alter table public.surveys enable row level security;
alter table public.prompts enable row level security;
alter table public.submissions enable row level security;
alter table public.prompt_assignments enable row level security;
alter table public.recordings enable row level security;
alter table public.recording_quality enable row level security;
alter table public.reviews enable row level security;
alter table public.risk_flags enable row level security;
alter table public.compensation_policies enable row level security;
alter table public.payments enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_events enable row level security;
alter table public.dataset_releases enable row level security;
alter table public.release_items enable row level security;

create policy profiles_self_select on public.profiles for select using (user_id = auth.uid() or public.is_reviewer());
create policy profiles_self_update on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid() and role = 'participant');
create policy user_roles_admin_all on public.user_roles for all using (public.is_admin()) with check (public.is_admin());
create policy user_roles_self_select on public.user_roles for select using (user_id = auth.uid());

create policy payout_self_select on public.payout_accounts for select using (user_id = auth.uid() or public.is_admin());
create policy payout_admin_update on public.payout_accounts for update using (public.is_admin()) with check (public.is_admin());

create policy consent_versions_read on public.consent_versions for select to authenticated using (effective_at <= now() and retired_at is null or public.is_admin());
create policy consent_versions_admin on public.consent_versions for all using (public.is_admin()) with check (public.is_admin());
create policy consents_self_insert on public.consents for insert with check (user_id = auth.uid());
create policy consents_self_read on public.consents for select using (user_id = auth.uid() or public.is_reviewer());
create policy surveys_self_all on public.surveys for all using (user_id = auth.uid() or public.is_reviewer()) with check (user_id = auth.uid());

create policy prompts_authenticated_read on public.prompts for select to authenticated using (enabled or public.is_admin());
create policy prompts_admin_write on public.prompts for all using (public.is_admin()) with check (public.is_admin());

create policy submissions_self_read on public.submissions for select using (user_id = auth.uid() or public.is_reviewer());
create policy submissions_self_insert on public.submissions for insert with check (user_id = auth.uid());
create policy submissions_self_draft_update on public.submissions for update using (user_id = auth.uid() and status in ('draft', 'recording', 'uploading', 'changes_requested'))
with check (user_id = auth.uid());
create policy submissions_review_update on public.submissions for update using (public.is_reviewer()) with check (public.is_reviewer());

create policy assignments_self_read on public.prompt_assignments for select using (
  exists (select 1 from public.submissions s where s.id = submission_id and (s.user_id = auth.uid() or public.is_reviewer()))
);
create policy assignments_admin_write on public.prompt_assignments for all using (public.is_admin()) with check (public.is_admin());

create policy recordings_self_read on public.recordings for select using (user_id = auth.uid() or public.is_reviewer());
create policy recordings_self_insert on public.recordings for insert with check (user_id = auth.uid());
create policy recordings_self_draft_update on public.recordings for update using (
  user_id = auth.uid() and exists (select 1 from public.submissions s where s.id = submission_id and s.status in ('draft', 'recording', 'uploading', 'changes_requested'))
);
create policy quality_reviewer_read on public.recording_quality for select using (
  public.is_reviewer() or exists (
    select 1 from public.recordings r where r.id = recording_id and r.user_id = auth.uid()
  )
);
create policy quality_service_write on public.recording_quality for all using (public.is_admin()) with check (public.is_admin());

create policy reviews_reviewer_all on public.reviews for all using (public.is_reviewer()) with check (public.is_reviewer() and reviewer_id = auth.uid());
create policy reviews_participant_read on public.reviews for select using (
  exists (select 1 from public.submissions s where s.id = submission_id and s.user_id = auth.uid())
);
create policy risk_admin_all on public.risk_flags for all using (public.is_admin()) with check (public.is_admin());
create policy compensation_authenticated_read on public.compensation_policies for select to authenticated using (effective_at <= now() and retired_at is null or public.is_admin());
create policy compensation_admin_all on public.compensation_policies for all using (public.is_admin()) with check (public.is_admin());
create policy payments_admin_all on public.payments for all using (public.is_admin()) with check (public.is_admin());
create policy payments_self_read on public.payments for select using (user_id = auth.uid());
create policy withdrawals_self_insert on public.withdrawal_requests for insert with check (user_id = auth.uid());
create policy withdrawals_self_read on public.withdrawal_requests for select using (user_id = auth.uid() or public.is_admin());
create policy withdrawals_admin_update on public.withdrawal_requests for update using (public.is_admin()) with check (public.is_admin());
create policy notifications_self_read on public.notifications for select using (user_id = auth.uid());
create policy notifications_self_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audit_admin_read on public.audit_events for select using (public.is_admin());
create policy release_admin_all on public.dataset_releases for all using (public.is_admin()) with check (public.is_admin());
create policy release_items_admin_all on public.release_items for all using (public.is_admin()) with check (public.is_admin());

-- Private raw-media bucket. Create this bucket before applying the policies if
-- your migration runner does not allow inserts into storage.buckets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('raw-recordings', 'raw-recordings', false, 104857600, array['video/webm', 'video/mp4'])
on conflict (id) do nothing;

create policy raw_recordings_participant_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'raw-recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy raw_recordings_owner_read on storage.objects
for select to authenticated
using (
  bucket_id = 'raw-recordings'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_reviewer())
);

create policy raw_recordings_owner_delete_draft on storage.objects
for delete to authenticated
using (
  bucket_id = 'raw-recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.submissions s
    where s.id::text = (storage.foldername(name))[2]
      and s.user_id = auth.uid()
      and s.status in ('draft', 'recording', 'uploading', 'changes_requested')
  )
);

create index submissions_status_idx on public.submissions(status, created_at);
create index submissions_reviewer_idx on public.submissions(assigned_reviewer_id, status);
create index recordings_submission_idx on public.recordings(submission_id);
create index reviews_submission_idx on public.reviews(submission_id);
create index payments_status_idx on public.payments(status, created_at);
create index risk_flags_open_idx on public.risk_flags(status, score desc);
create index audit_entity_idx on public.audit_events(entity_type, entity_id, created_at);
create index notifications_user_idx on public.notifications(user_id, read_at, created_at desc);
