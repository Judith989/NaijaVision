// Keep every distinct instruction, but show each returned recording only once.
export function groupReturnedFeedback<T extends { recording_id: string; comments?: string | null }>(reviews: T[]): T[] {
  const grouped = new Map<string, { review: T; comments: Set<string> }>();
  for (const review of reviews) {
    let entry = grouped.get(review.recording_id);
    if (!entry) {
      entry = { review, comments: new Set() };
      grouped.set(review.recording_id, entry);
    }
    const comment = review.comments?.trim();
    if (comment) entry.comments.add(comment);
  }
  return Array.from(grouped.values(), ({ review, comments }) => ({
    ...review,
    comments: comments.size ? Array.from(comments).join("\n\n") : null,
  }));
}
