import path from "node:path";

const INVALID_PATH_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

export const APPROVED_SUBMISSION_STATUSES = new Set(["payment_eligible", "payment_processing", "paid"]);

export function safePathSegment(value, fallback = "Unknown") {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(INVALID_PATH_CHARACTERS, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return cleaned || fallback;
}

export function languageFolder(recording) {
  if (recording.safe_speech || String(recording.prompt_id || "").toUpperCase().startsWith("SAFE-")) {
    return "NaijaSafeSpeech";
  }
  const language = String(recording.language || "").trim().toLowerCase();
  const knownFolders = new Map([
    ["igbo", "Igbo"],
    ["yoruba", "Yoruba"],
    ["yorùbá", "Yoruba"],
    ["hausa", "Hausa"],
    ["nigerian pidgin", "Nigerian-Pidgin"],
    ["nigerian english", "Nigerian-English"],
    ["participant choice", "Participant-Choice"],
  ]);
  return knownFolders.get(language) || safePathSegment(recording.language, "Other");
}

export function recordingArchivePath(submission, recording) {
  const extension = path.extname(recording.object_path || "") || ".webm";
  const participant = safePathSegment(submission.participant_id, "Unknown-Participant");
  const submissionFolder = safePathSegment(submission.id, "Unknown-Submission");
  const prompt = safePathSegment(recording.prompt_id, "Unknown-Prompt");
  const recordingId = safePathSegment(recording.id, "Unknown-Recording");
  return [participant, submissionFolder, languageFolder(recording), `${prompt}_${recordingId}${extension}`].join("/");
}

export function isFinallyApproved(submission) {
  return Boolean(submission?.approved_at) && APPROVED_SUBMISSION_STATUSES.has(submission.status);
}
