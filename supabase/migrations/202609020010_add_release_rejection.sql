alter table public.dataset_releases
add column if not exists rejection_reason text;

alter table public.dataset_releases
drop constraint if exists dataset_releases_status_check;

alter table public.dataset_releases
add constraint dataset_releases_status_check
check (status in ('draft', 'privacy_review', 'approved', 'published', 'withdrawn', 'rejected'));
