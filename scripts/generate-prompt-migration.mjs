import { corePrompts, safeSpeechPrompts } from "../src/app/prompts.ts";

const quote = (value) => value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const prompts = [...corePrompts, ...safeSpeechPrompts];
const safeSequences = {
  "SAFE-CS-001": ["Igbo", "Nigerian English"],
  "SAFE-CS-002": ["Yorùbá", "Nigerian Pidgin"],
  "SAFE-CS-003": ["Hausa", "Nigerian English"],
  "SAFE-CS-004": ["Nigerian Pidgin", "Nigerian English"],
};
const rows = prompts.map((prompt) => {
  const isNumberPrompt = prompt.type === "Numbers and names";
  const safeSequence = safeSequences[prompt.id];
  const storedType = isNumberPrompt ? "Reading" : safeSequence ? "Code-switching" : prompt.type;
  const storedLanguage = isNumberPrompt ? "Nigerian English" : safeSequence ? safeSequence.join(" + ") : prompt.language;
  const sequence = safeSequence || (prompt.type === "Code-switching"
    ? prompt.language.split("+").map((value) => value.trim())
    : [storedLanguage]);
  return `(${[
    quote(prompt.id),
    "1",
    quote(storedType),
    quote(storedLanguage),
    `array[${sequence.map(quote).join(",")}]::text[]`,
    quote(prompt.text),
    quote(prompt.text.toLocaleLowerCase()),
    quote(prompt.translation),
    prompt.responseSeconds || "null",
    prompt.type === "NaijaSafeSpeech" ? "true" : "false",
    "true",
  ].join(",")})`;
});

process.stdout.write(`insert into public.prompts (
  id, version, prompt_type, language, language_sequence, original_text,
  normalized_text, english_translation, response_seconds, safe_speech, enabled
) values
${rows.join(",\n")}
on conflict (id) do update set
  version = excluded.version,
  prompt_type = excluded.prompt_type,
  language = excluded.language,
  language_sequence = excluded.language_sequence,
  original_text = excluded.original_text,
  normalized_text = excluded.normalized_text,
  english_translation = excluded.english_translation,
  response_seconds = excluded.response_seconds,
  safe_speech = excluded.safe_speech,
  enabled = excluded.enabled;\n`);
