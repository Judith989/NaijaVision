import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const requestedKeepIds = new Set([
  "NV-9683C865199A",
  "NV-8757AF695A76",
  "NV-1811078A22FF",
  "NV-C2129897308B",
  "NV-41D2945D8734",
]);
const execute = process.argv.includes("--execute");
const confirmation = process.argv.includes("--confirm-delete-unlisted-accounts");
if (execute && !confirmation) throw new Error("Execution requires --confirm-delete-unlisted-accounts.");

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this terminal.");
const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: profiles, error: profileError } = await supabase.from("profiles")
  .select("user_id,participant_id,display_name,role,account_status,created_at")
  .order("created_at");
if (profileError) throw profileError;
const authUsers = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  authUsers.push(...data.users);
  if (data.users.length < 1000) break;
}
const profileByUserId = new Map((profiles || []).map((profile) => [profile.user_id, profile]));
const accounts = authUsers.map((user) => profileByUserId.get(user.id) || {
  user_id: user.id,
  participant_id: null,
  display_name: user.user_metadata?.full_name || user.email || "Auth user without profile",
  role: null,
  account_status: "missing_profile",
  created_at: user.created_at,
});

const keep = [];
const remove = [];
for (const profile of accounts) {
  const preserved = profile.role === "admin" || requestedKeepIds.has(profile.participant_id);
  (preserved ? keep : remove).push(profile);
}

const foundIds = new Set(accounts.map((profile) => profile.participant_id).filter(Boolean));
const missing = [...requestedKeepIds].filter((id) => !foundIds.has(id));
console.log(`Mode: ${execute ? "EXECUTE" : "DRY RUN"}`);
console.log("\nPRESERVE (listed IDs plus every administrator):");
for (const profile of keep) console.log(`  ${profile.display_name || "Unnamed"} | ${profile.participant_id} | ${profile.role}`);
console.log("\nDELETE:");
for (const profile of remove) console.log(`  ${profile.display_name || "Unnamed"} | ${profile.participant_id} | ${profile.role} | ${profile.account_status}`);
if (missing.length) console.warn(`\nWARNING: requested keep IDs not found: ${missing.join(", ")}`);
console.log(`\nSummary: preserve ${keep.length}; delete ${remove.length}.`);

if (!execute) {
  console.log("No accounts or files were changed. Review this list before using --execute --confirm-delete-unlisted-accounts.");
  process.exit(0);
}
if (missing.length) throw new Error("Refusing to execute because one or more requested keep IDs were not found.");

for (const profile of remove) {
  const { data: recordings, error: recordingError } = await supabase.from("recordings")
    .select("object_path").eq("user_id", profile.user_id).is("storage_deleted_at", null);
  if (recordingError) throw recordingError;
  const objectPaths = (recordings || []).map((row) => row.object_path).filter(Boolean);
  for (let index = 0; index < objectPaths.length; index += 100) {
    const { error } = await supabase.storage.from("raw-recordings").remove(objectPaths.slice(index, index + 100));
    if (error) throw new Error(`Could not remove recordings for ${profile.participant_id}: ${error.message}`);
  }
  const { error: deleteError } = await supabase.auth.admin.deleteUser(profile.user_id);
  if (deleteError) throw new Error(`Could not delete ${profile.participant_id}: ${deleteError.message}`);
  console.log(`Deleted ${profile.display_name || "Unnamed"} | ${profile.participant_id} (${objectPaths.length} storage objects).`);
}
