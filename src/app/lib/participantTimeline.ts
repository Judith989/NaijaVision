type SubmissionProgress = { status: string; submitted_at: string | null };
export function participantTimeline(submission: SubmissionProgress | undefined, reviewed: boolean): Array<[string, boolean]> {
  const status = submission?.status;
  const approved = Boolean(status && ["approved", "payment_eligible", "payment_processing", "paid"].includes(status));
  const finalDecision = approved || status === "rejected";
  const inReview = Boolean(status && ["submitted", "automated_qc", "awaiting_review", "resubmitted"].includes(status));
  return [
    ["Submitted", Boolean(submission?.submitted_at)],
    ["Human review", finalDecision || (inReview && reviewed)],
    ["Final approval", approved],
    ["Paid", status === "paid"],
  ];
}
