insert into public.consent_versions (
  version,
  title,
  body_markdown,
  body_sha256,
  public_release_required,
  effective_at,
  retired_at
) values (
  '1.0.0',
  'NaijaVision Participant Consent',
  E'# NaijaVision participant consent\n\nI confirm that I am at least 18 years old. I have read the study information,\nunderstand the tasks and privacy limitations, and voluntarily consent to audio,\nmouth-region video, transcript, approved metadata, public dataset release, and\nAI research use. NaijaSafeSpeech participation remains separately optional.',
  'e16d31cefb7706ac0ce567ad6a8b846475f93ec6604207f6111adb47fd19c528',
  true,
  now(),
  null
)
on conflict (version) do update set
  title = excluded.title,
  body_markdown = excluded.body_markdown,
  body_sha256 = excluded.body_sha256,
  public_release_required = excluded.public_release_required,
  effective_at = least(public.consent_versions.effective_at, now()),
  retired_at = null;
