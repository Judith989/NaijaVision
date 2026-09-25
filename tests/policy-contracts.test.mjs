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
  const sql = await read("supabase/migrations/202609240002_compensation_rates.sql");
  assert.match(sql, /750 per completed language set/);
  assert.match(sql, /20 per unique video reviewed/);
  assert.match(sql, /where compensation_basis = 'per_language_completed'\s+and status not in \('payment_processing', 'paid'\)/);
  assert.match(sql, /where status not in \('processing', 'paid'\)/);
  assert.match(sql, /replace_reviewer_compensation_policy/);
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
});
