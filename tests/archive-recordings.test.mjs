import assert from "node:assert/strict";
import test from "node:test";
import { isFinallyApproved, languageFolder, recordingArchivePath, safePathSegment } from "../scripts/archive-recordings-lib.mjs";

test("creates friendly participant, submission, language, and prompt paths", () => {
  const archivePath = recordingArchivePath(
    { id: "submission-id", participant_id: "NV-E91DBCA3B551" },
    { id: "recording-id", prompt_id: "IG-001", language: "Igbo", object_path: "user/submission/file.webm" },
  );
  assert.equal(archivePath, "NV-E91DBCA3B551/submission-id/Igbo/IG-001_recording-id.webm");
});

test("groups every safe speech prompt in the NaijaSafeSpeech folder", () => {
  assert.equal(languageFolder({ prompt_id: "SAFE-IG-001", language: "Igbo", safe_speech: true }), "NaijaSafeSpeech");
});

test("normalizes known language folder names and unsafe path characters", () => {
  assert.equal(languageFolder({ prompt_id: "PCM-001", language: "Nigerian Pidgin" }), "Nigerian-Pidgin");
  assert.equal(safePathSegment("bad/name:*"), "bad-name");
});

test("requires a recorded final approval before cloud deletion", () => {
  assert.equal(isFinallyApproved({ status: "payment_eligible", approved_at: "2026-09-24T00:00:00Z" }), true);
  assert.equal(isFinallyApproved({ status: "paid", approved_at: "2026-09-24T00:00:00Z" }), true);
  assert.equal(isFinallyApproved({ status: "awaiting_review", approved_at: null }), false);
  assert.equal(isFinallyApproved({ status: "payment_eligible", approved_at: null }), false);
});
