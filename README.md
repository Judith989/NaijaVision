# NaijaVision Contribution Platform

A privacy-conscious application for NaijaVSR audio-visual speech collection. The prototype now defines a minimal account and payment handoff while keeping operational identity records separate from research data.

## Local use

Requirements: Node.js 22.13 or newer.

```powershell
npm install
npm run dev
```

Open the local address printed in the terminal. Camera and microphone access normally requires `localhost` or HTTPS.

## What the platform includes

- Granular adult consent and a separate NaijaSafeSpeech opt-in
- Automatically generated research ID and participant survey
- Study-information reading step and simplified three-part electronic consent
- Bank country, bank name, account name, and account number for approved compensation
- Camera and microphone calibration
- Face-landmark gating with a 720p minimum input check
- Mandatory microphone check for a live audio track with a minimum 8 kHz sample rate
- Mandatory lighting measurement with an accepted range of 25 to 240
- Canvas-based 256 x 128 mouth-only recording stream
- Prompt-by-prompt recording, replay, retake, skip, and acceptance
- 82 prompts across five languages, seven code-switch combinations, natural speech, numbers, names, and the optional NaijaSafeSpeech subset
- Six separately optional NaijaSafeSpeech prompts
- Language-based prompt assignment from the participant survey
- Resumable participant drafts with mandatory recalibration on return
- Participant review, submission, human validation, and compensation status
- Immediate private Supabase persistence after participant acceptance, with IndexedDB as a local fallback
- Duration-based preliminary quality status

## Data handling

The browser temporarily accesses the source camera frame only for local face-landmark analysis. The participant preview and MediaRecorder input come from a separate 256 x 128 canvas containing the detected mouth crop. Recording stays locked until mouth tracking, microphone quality, and lighting pass during the same seven-second calibration.

The bundled face-landmark model and WebAssembly runtime execute in the browser. Production field testing must still validate crop boundaries across devices, skin tones, facial hair, lighting, head coverings, assistive devices, and camera quality before recruitment.

Mouth-region video and voice remain potentially identifiable biometric data. Do not describe the output as anonymous.

## Pilot protocol

Before external recruitment:

1. Obtain institutional ethics approval and Nigerian data-protection review.
2. Finalize participant withdrawal, retention, access, licensing, and compensation policies.
3. Have linguists and native speakers validate phonetic, code-switching, and dialect prompt banks.
4. Add encryption, authenticated study roles, immutable audit logs, and controlled backups.
5. Validate audio/video synchronization and implement real image/audio quality measurements.
6. Run an internal pilot before targeting 50 to 100 external participants.

Current pilot target: 50 to 100 unique speakers, five core languages, 75 to 120 clips per speaker, 10 to 20 audio-video hours, at least 12 Nigerian states, and at least 20% manually verified. The stated target of 15,000 to 30,000 utterances requires either more than 100 speakers or more than 120 utterances per speaker, so recruitment and utterance targets must be reconciled before launch.

## Location data

The bundled Nigerian state and LGA options use the MIT-licensed
`temikeezy/nigeria-geojson-data` dataset. Review location names with local
study partners before field deployment.

## Supabase production setup

1. Create a Supabase project and install the Supabase CLI.
   Configure the email and SMS templates to deliver a one-time code compatible
   with `verifyOtp`.
2. Copy `.env.example` to `.env.local` and add the project URL and publishable key.
3. Link the project and apply the migrations:

```powershell
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

4. Set Edge Function secrets:

```powershell
supabase secrets set PAYMENTS_PROVIDER_API_KEY=...
supabase secrets set PAYMENTS_PROVIDER_TOKENIZE_URL=...
supabase secrets set PAYMENTS_PROVIDER_PAYOUT_URL=...
supabase secrets set PAYMENTS_PROVIDER_NAME=...
supabase secrets set QC_WORKER_URL=...
supabase secrets set QC_WORKER_SECRET=...
supabase secrets set ALLOWED_ORIGIN=https://your-production-domain.example
```

5. Deploy the functions:

```powershell
supabase functions deploy tokenize-payout-account
supabase functions deploy process-payment
supabase functions deploy dispatch-quality-control
```

6. Seed the active consent, compensation policy, and prompt catalog:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="..."
$env:PILOT_COMPENSATION_AMOUNT="..."
$env:PILOT_COMPENSATION_CURRENCY="NGN"
npm run supabase:seed
```

7. Assign the first administrator using the SQL editor. Subsequent assignments
should use the protected administrator interface:

```sql
insert into public.user_roles(user_id, role)
values ('AUTH_USER_UUID', 'admin')
on conflict do nothing;

update public.profiles
set role = 'admin'
where user_id = 'AUTH_USER_UUID';
```

After the first administrator signs in, open Dashboard, then **Admin and staff
workspace**. The administrator can approve pending staff requests, search for an
existing participant by name or participant ID, grant reviewer or admin access,
change a staff role, or remove staff access. Role changes are exclusive, audited,
and protected against self-demotion and removal of the final administrator.

The service-role key belongs only in the CLI, deployment secrets, and trusted
server environments. It must never be placed in a `NEXT_PUBLIC_` variable.

## Production architecture

- Supabase Auth verifies participant, reviewer, and administrator accounts.
- PostgreSQL stores consent versions, surveys, prompt assignments, metadata,
  workflow state, reviews, payments, withdrawals, risk flags, audit events,
  notifications, and dataset-release records.
- The private `raw-recordings` Storage bucket holds audio-video media.
- TUS uploads provide retry, progress, and resume behavior.
- Reviewers use short-lived signed URLs rather than public media URLs.
- Payment-provider tokenization prevents full bank account numbers from being
  stored in the research database.
- A separate quality-control worker receives signed media URLs and writes
  probe, synchronization, speech, framing, privacy, and duplicate results back
  to `recording_quality`.
- Only curated `release_items` may enter a public dataset release.

## Required external services

The repository implements the application, database, authorization, storage,
review, payment workflow, and provider adapters. A live deployment still needs:

- Supabase project credentials
- An email and/or SMS provider configured in Supabase Auth
- A supported payout provider with recipient tokenization and transfer APIs
- A quality-control worker capable of media probing and model inference
- A production domain and allowed CORS origin
- Final compensation amount, currency, and ethics-approved consent text
