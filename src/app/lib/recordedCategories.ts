export type CategoryRecording = {
  language: string;
  prompt_assignments: { prompt_id: string } | Array<{ prompt_id: string }> | null;
};

export function recordedCategories(recordings: CategoryRecording[]) {
  const categories = new Map<string, { language: string; safeSpeech: boolean; count: number }>();
  for (const recording of recordings) {
    const assignment = Array.isArray(recording.prompt_assignments)
      ? recording.prompt_assignments[0]
      : recording.prompt_assignments;
    const safeSpeech = Boolean(assignment?.prompt_id.startsWith("SAFE-"));
    const language = recording.language.trim() || "Unknown language";
    const key = JSON.stringify([language, safeSpeech]);
    const category = categories.get(key) || { language, safeSpeech, count: 0 };
    category.count += 1;
    categories.set(key, category);
  }
  return [...categories.values()].sort((a, b) =>
    Number(a.safeSpeech) - Number(b.safeSpeech) || a.language.localeCompare(b.language, "en"));
}
