# Recording deletion and retention

Participants may delete individual unsubmitted recordings from their dashboard or review screen, or discard an entire unsubmitted contribution. The server checks ownership, active account status, and draft/recording/uploading status with no prior submission timestamp. A confirmation is required in the UI. Review, redo, approved and paid submissions cannot be deleted by participants.

The cleanup worker runs every five minutes and processes up to ten queued files. Finally rejected submissions become eligible 30 days after their final rejection. Existing rejections receive 30 days from migration installation. Restoring a rejected submission before cleanup cancels its eligibility; a later rejection starts a fresh period. Once cleanup is queued, restoration is blocked because files may already have been removed.

Approved or archived files are excluded. Approved-file cleanup continues to use the verified download/archive process; this worker never creates an archive or assumes a download is complete. Payment records and reviewed recording rows remain intact. Submissions with any approved timestamp, active/payment-completed payment, or archived recordings are excluded from rejection cleanup.

Each job preserves the recording ID, submission ID, original path, metadata, reason, attempts, errors and deletion timestamp. Audit events record draft deletion requests and completed storage deletions. Jobs have no cascading foreign keys. Storage is deleted through the Storage API, not by deleting storage.objects rows. A failed deletion retries after one hour; crashed invocations can retry after a five-minute lease expires. Only service_role can claim or finish jobs. Admins can read the deletion log table.

Deploy:
1. Apply migrations/202611130001_recording_retention.sql.
2. Deploy functions/cleanup-recordings with JWT verification disabled; it authenticates the same server-only x-notification-secret as the existing notification worker.
3. Run recording-retention-schedule.sql. It copies the existing scheduler credential inside the database without exposing it.
4. Verify cron.job and successful cleanup function responses. Never use participant recordings as destructive test fixtures.

Local checks: npm run build; node --test tests/*.test.mjs; npx eslint src/app/page.tsx src/app/dashboard/page.tsx src/app/lib/localRecordingCleanup.ts.
