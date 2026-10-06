import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("new accounts require administrator approval at the database boundary", async () => {
  const [sql, verifiedApproval] = await Promise.all([
    read("supabase/migrations/202609240001_account_approval.sql"),
    read("supabase/migrations/202609240003_verified_account_approval.sql"),
  ]);
  assert.match(sql, /account_status set default 'pending'/);
  assert.match(sql, /values \(new\.id, v_display_name, 'pending', 'none'\)/);
  assert.match(sql, /create or replace function public\.approve_account/);
  assert.match(sql, /create or replace function public\.decline_account/);
  assert.match(sql, /public\.has_active_account\(\)/);
  assert.match(sql, /drop policy if exists profiles_self_update/);
  assert.match(sql, /raw_recordings_active_participant_insert/);
  assert.match(sql, /v_pending_count >= 100/);
  assert.match(sql, /public\.is_reviewer\(\) and assigned_reviewer_id = auth\.uid\(\)/);
  assert.match(verifiedApproval, /create or replace function public\.list_verified_pending_accounts/);
  assert.match(verifiedApproval, /u\.email_confirmed_at is not null/);
  assert.match(verifiedApproval, /The applicant must verify their email before approval/);
});

test("agreed participant and reviewer rates are installed and unpaid totals are recalculated", async () => {
  const [sql, reviewerControls] = await Promise.all([
    read("supabase/migrations/202609240002_compensation_rates.sql"),
    read("supabase/migrations/202609240004_reviewer_policy_controls.sql"),
  ]);
  assert.match(sql, /750 per completed language set/);
  assert.match(sql, /20 per unique video reviewed/);
  assert.match(sql, /where compensation_basis = 'per_language_completed'\s+and status not in \('payment_processing', 'paid'\)/);
  assert.match(sql, /where status not in \('processing', 'paid'\)/);
  assert.match(sql, /replace_reviewer_compensation_policy/);
  assert.match(reviewerControls, /v_id uuid := gen_random_uuid\(\)/);
  assert.match(reviewerControls, /NGN 30 per unique video reviewed/);
});

test("account cleanup is dry-run by default and always preserves administrators", async () => {
  const script = await read("scripts/cleanup-accounts.mjs");
  assert.match(script, /profile\.role === "admin"/);
  assert.match(script, /Mode: \$\{execute \? "EXECUTE" : "DRY RUN"\}/);
  assert.match(script, /--confirm-delete-unlisted-accounts/);
  assert.match(script, /Refusing to execute because one or more requested keep IDs were not found/);
});

test("public authentication remains usable and privileged edge calls require active accounts", async () => {
  const [signup, signin, forgot, security, payout] = await Promise.all([
    read("src/app/signup/page.tsx"),
    read("src/app/signin/page.tsx"),
    read("src/app/forgot-password/page.tsx"),
    read("supabase/functions/_shared/security.ts"),
    read("supabase/functions/tokenize-payout-account/index.ts"),
  ]);
  assert.doesNotMatch(signup, /captchaToken|HCaptcha/);
  assert.doesNotMatch(signin, /captchaToken|HCaptcha/);
  assert.doesNotMatch(forgot, /captchaToken|HCaptcha/);
  assert.match(signup, /administrator must approve the account/i);
  assert.match(security, /eq\("role", "admin"\)\.eq\("account_status", "active"\)/);
  assert.match(payout, /requireActiveAccount\(user\.id\)/);
  assert.match(payout, /providerMessage/);
  assert.match(await read("src/app/page.tsx"), /edgeFunctionErrorMessage/);
});

test("participants can correct language selection before recording and are warned when it is missing", async () => {
  const [contribution, dashboard] = await Promise.all([
    read("src/app/page.tsx"),
    read("src/app/dashboard/page.tsx"),
  ]);
  assert.match(contribution, /requestedMode\.get\("survey"\) === "edit"/);
  assert.match(contribution, /if \(editingSurvey\) \{/);
  assert.match(contribution, /setStep\(savedConsent \? "profile" : "study"\)/);
  assert.match(contribution, /Language selection is locked after recording begins/);
  assert.match(contribution, /Select at least one native language, your primary language, and at least one language used daily/);
  assert.match(contribution, /No languages selected yet/);
  assert.doesNotMatch(contribution, /<label className="wide"><span>Native languages/);
  assert.match(dashboard, /No languages are selected/);
  assert.match(dashboard, /Update language selection/);
  assert.match(dashboard, /survey=edit/);
});

test("reviewers can decide recordings in bulk without premature or duplicate earnings", async () => {
  const [contribution, paymentGuard] = await Promise.all([
    read("src/app/page.tsx"),
    read("supabase/migrations/202610010001_reviewer_payment_after_final_approval.sql"),
  ]);
  assert.match(contribution, /reviewAllRecordings/);
  assert.match(contribution, /Approve all/);
  assert.match(contribution, /Decline all/);
  assert.match(contribution, /Redo all/);
  assert.match(contribution, /review-side-dialog/);
  assert.match(paymentGuard, /new\.recommendation <> 'approved'/);
  assert.match(paymentGuard, /new\.admin_review_status <> 'accepted'/);
  assert.match(paymentGuard, /count\(distinct r\.prompt_assignment_id\)/);
  assert.match(paymentGuard, /set status = 'cancelled'/);
});

test("participant forms distinguish required and optional information", async () => {
  const contribution = await read("src/app/page.tsx");
  assert.match(contribution, /required-badge/);
  assert.match(contribution, /Camera resolution <small>optional · only if known<\/small>/);
  assert.match(contribution, /Device brand <small>optional<\/small>/);
  assert.doesNotMatch(contribution.match(/const requiredAnswers = \[[\s\S]*?\];/)?.[0] || "", /cameraResolution|deviceBrand/);
});

test("recording can begin without bank verification while payment remains protected", async () => {
  const [contribution, deferredPayout, paymentClaim] = await Promise.all([
    read("src/app/page.tsx"),
    read("supabase/migrations/202610010002_defer_payout_until_payment.sql"),
    read("supabase/migrations/202609150001_atomic_payment_processing.sql"),
  ]);
  assert.match(contribution, /Bank verification is not required to begin recording/);
  assert.match(contribution, /Continue and add payment details later/);
  assert.match(deferredPayout, /alter column payout_account_id drop not null/);
  assert.match(deferredPayout, /attach_verified_payout_to_pending_payments/);
  assert.doesNotMatch(deferredPayout, /A verified payout account is required/);
  assert.match(paymentClaim, /verified_at is not null/);
  assert.match(paymentClaim, /Verified payout recipient is unavailable/);
});

test("manual payout fallback is restricted, reviewable, and never self-verifying", async () => {
  const [migration, contribution, administration] = await Promise.all([
    read("supabase/migrations/202610060001_manual_payout_fallback.sql"),
    read("src/app/page.tsx"),
    read("src/app/AdminOperations.tsx"),
  ]);
  assert.match(migration, /alter table public\.manual_payout_details enable row level security/);
  assert.match(migration, /revoke all on table public\.manual_payout_details from public, anon, authenticated/);
  assert.match(migration, /if not public\.is_admin\(\) then raise exception 'Administrator access required'/);
  assert.match(migration, /create or replace function public\.save_manual_payout_details/);
  assert.match(migration, /create or replace function public\.list_admin_account_information/);
  assert.match(migration, /status='pending'/);
  assert.match(contribution, /Save for administrator verification/);
  assert.match(contribution, /save_manual_payout_details/);
  assert.match(administration, /All account information/);
  assert.match(administration, /Show full number/);
  assert.match(administration, /approve_manual_payout_details/);
});

test("only administrators can send private in-platform messages to users", async () => {
  const [migration, administration] = await Promise.all([
    read("supabase/migrations/202610060003_admin_user_messages.sql"),
    read("src/app/AdminOperations.tsx"),
  ]);
  assert.match(migration, /create or replace function public\.send_admin_message/);
  assert.match(migration, /if not public\.is_admin\(\)/);
  assert.match(migration, /insert into public\.notifications/);
  assert.match(migration, /write_audit_event/);
  assert.match(administration, /send_admin_message/);
  assert.match(administration, /Message user/);
});
