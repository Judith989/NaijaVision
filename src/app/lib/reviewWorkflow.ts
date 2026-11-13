export const reviewWorkStatuses = ["submitted", "automated_qc", "awaiting_review", "resubmitted"];
export const adminReviewStatuses = [...reviewWorkStatuses, "changes_requested", "approved", "payment_eligible", "payment_processing", "paid", "rejected", "withdrawn"];

type SubmissionState = { status: string; recommendation?: string; recommendation_status?: string };

export function reviewStage(item: SubmissionState) {
  if (item.status === "changes_requested") return "participant";
  if (["rejected", "withdrawn"].includes(item.status)) return "closed";
  if (["approved", "paid"].includes(item.status)) return "completed";
  if (["payment_eligible", "payment_processing"].includes(item.status)) return "payment";
  // A previous return marker can remain after the participant resubmits.
  if (item.recommendation_status === "returned") return "reviewer_correction";
  if (item.recommendation && item.recommendation_status === "pending") return "admin";
  return "reviewer";
}

export function reviewStageLabel(item: SubmissionState) {
  const stage = reviewStage(item);
  if (stage === "participant") return "Returned to participant: awaiting corrected recordings";
  if (stage === "reviewer_correction") return "Returned to reviewer: awaiting revised review";
  if (stage === "reviewer") return item.status === "resubmitted" ? "Resubmitted: awaiting reviewer" : "Awaiting reviewer decision and handoff";
  return item.status.replaceAll("_", " ");
}
