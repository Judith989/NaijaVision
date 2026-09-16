import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : ""; };
const submissionId = valueAfter("--submission");
const allPaid = args.has("--all-paid");
const deleteAfterVerify = args.has("--delete-after-verify");
const outputRoot = path.resolve(valueAfter("--output") || `naijavision-archive-${new Date().toISOString().replaceAll(":", "-")}`);
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this terminal.");
if (!submissionId && !allPaid) throw new Error("Choose --submission <uuid> or --all-paid.");
if (submissionId && allPaid) throw new Error("Use only one selection mode.");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
let submissionQuery = supabase.from("submissions").select("id,participant_id,status,paid_at,created_at");
submissionQuery = submissionId ? submissionQuery.eq("id", submissionId) : submissionQuery.eq("status", "paid");
const { data: submissions, error: submissionError } = await submissionQuery;
if (submissionError) throw submissionError;
if (!submissions?.length) throw new Error("No matching submissions were found.");

await mkdir(outputRoot, { recursive: true });
const manifest = { created_at: new Date().toISOString(), source_project: url, delete_after_verify: deleteAfterVerify, recordings: [] };
for (const submission of submissions) {
  if (deleteAfterVerify && submission.status !== "paid") throw new Error(`Refusing to delete submission ${submission.id}: status is ${submission.status}, not paid.`);
  const { data: recordings, error } = await supabase.from("recordings")
    .select("id,submission_id,object_path,checksum_sha256,content_type,file_size,duration_seconds,language,original_transcript")
    .eq("submission_id", submission.id).is("storage_deleted_at", null).order("uploaded_at");
  if (error) throw error;
  const submissionDirectory = path.join(outputRoot, `${submission.participant_id}-${submission.id}`);
  await mkdir(submissionDirectory, { recursive: true });
  for (const recording of recordings || []) {
    const { data, error: downloadError } = await supabase.storage.from("raw-recordings").download(recording.object_path);
    if (downloadError || !data) throw downloadError || new Error(`Download failed: ${recording.object_path}`);
    const bytes = Buffer.from(await data.arrayBuffer());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== recording.checksum_sha256) throw new Error(`Checksum mismatch: ${recording.object_path}`);
    const filename = `${recording.id}${path.extname(recording.object_path) || ".webm"}`;
    const localPath = path.join(submissionDirectory, filename);
    await writeFile(localPath, bytes, { flag: "wx" });
    manifest.recordings.push({ ...recording, local_path: path.relative(outputRoot, localPath), verified_sha256: checksum });
    if (deleteAfterVerify) {
      const archivedAt = new Date().toISOString();
      const archivePath = path.relative(outputRoot, localPath);
      const { error: archiveError } = await supabase.from("recordings").update({ archived_at: archivedAt, archive_path: archivePath }).eq("id", recording.id);
      if (archiveError) throw archiveError;
      const { error: removeError } = await supabase.storage.from("raw-recordings").remove([recording.object_path]);
      if (removeError) throw removeError;
      const { error: updateError } = await supabase.from("recordings").update({ storage_deleted_at: new Date().toISOString() }).eq("id", recording.id);
      if (updateError) throw updateError;
    }
    console.log(`${deleteAfterVerify ? "Archived and removed" : "Downloaded"}: ${recording.object_path}`);
  }
}
await writeFile(path.join(outputRoot, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(`Verified ${manifest.recordings.length} recordings. Manifest: ${path.join(outputRoot, "manifest.json")}`);
