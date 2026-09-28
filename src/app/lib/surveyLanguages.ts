export function surveyLanguages(responses: unknown): string[] {
  if (!responses || typeof responses !== "object" || Array.isArray(responses)) return [];
  const survey = responses as Record<string, unknown>;
  const values = [survey.primary, survey.homeLanguage, survey.workLanguage];
  for (const field of ["nativeLanguages", "otherLanguages", "dailyLanguages"]) {
    if (Array.isArray(survey[field])) values.push(...survey[field]);
  }
  return [...new Set(values.filter((value): value is string => typeof value === "string")
    .map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en"));
}
