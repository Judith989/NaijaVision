import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { isFinallyApproved, recordingArchivePath } from "./archive-recordings-lib.mjs";

const args = new Set(process.argv.slice(2));
const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : ""; };
const submissionId = valueAfter("--submission");
const allPaid = args.has("--all-paid");
const allApproved = args.has("--all-approved");
const deleteAfterVerify = args.has("--delete-after-verify");
const outputRoot = path.resolve(valueAfter("--output") || `naijavision-archive-${new Date().toISOString().replaceAll(":", "-")}`);
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this terminal.");
const selectedModes = [Boolean(submissionId), allPaid, allApproved].filter(Boolean).length;
if (selectedModes !== 1) throw new Error("Choose exactly one selection mode: --submission <uuid>, --all-approved, or --all-paid.");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
let submissionQuery = supabase.from("submissions").select("id,participant_id,status,approved_at,paid_at,created_at");
if (submissionId) submissionQuery = submissionQuery.eq("id", submissionId);
else if (allPaid) submissionQuery = submissionQuery.eq("status", "paid");
else submissionQuery = submissionQuery.in("status", ["payment_eligible", "payment_processing", "paid"]).not("approved_at", "is", null);
const { data: submissions, error: submissionError } = await submissionQuery;
if (submissionError) throw submissionError;
if (!submissions?.length) throw new Error("No matching submissions were found.");

await mkdir(outputRoot, { recursive: true });
const manifest = { created_at: new Date().toISOString(), source_project: url, delete_after_verify: deleteAfterVerify, recordings: [] };
const manifestPath = path.join(outputRoot, "manifest.json");
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx" });
const persistManifest = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2));
for (const submission of submissions) {
  if (deleteAfterVerify && !isFinallyApproved(submission)) {
    throw new Error(`Refusing to delete submission ${submission.id}: administrator final approval is required.`);
  }
  const { data: recordings, error } = await supabase.from("recordings")
    .select("id,submission_id,object_path,checksum_sha256,content_type,file_size,duration_seconds,language,original_transcript,prompt_assignments(prompt_id,prompts(safe_speech))")
    .eq("submission_id", submission.id).is("storage_deleted_at", null).order("uploaded_at");
  if (error) throw error;
  for (const rawRecording of recordings || []) {
    const assignment = Array.isArray(rawRecording.prompt_assignments) ? rawRecording.prompt_assignments[0] : rawRecording.prompt_assignments;
    const prompt = Array.isArray(assignment?.prompts) ? assignment.prompts[0] : assignment?.prompts;
    const recording = { ...rawRecording, prompt_id: assignment?.prompt_id || "Unknown-Prompt", safe_speech: Boolean(prompt?.safe_speech) };
    const { data, error: downloadError } = await supabase.storage.from("raw-recordings").download(recording.object_path);
    if (downloadError || !data) throw downloadError || new Error(`Download failed: ${recording.object_path}`);
    const bytes = Buffer.from(await data.arrayBuffer());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== recording.checksum_sha256) throw new Error(`Checksum mismatch: ${recording.object_path}`);
    const archivePath = recordingArchivePath(submission, recording);
    const localPath = path.join(outputRoot, archivePath);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, bytes, { flag: "wx" });
    const manifestRecording = { ...recording };
    delete manifestRecording.prompt_assignments;
    manifest.recordings.push({ ...manifestRecording, local_path: archivePath, verified_sha256: checksum });
    await persistManifest();
    if (deleteAfterVerify) {
      const archivedAt = new Date().toISOString();
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
console.log(`Verified ${manifest.recordings.length} recordings. Manifest: ${manifestPath}`);
