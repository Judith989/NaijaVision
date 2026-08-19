import { corePrompts, safeSpeechPrompts } from "../src/app/prompts.ts";

const quote = (value) => value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const prompts = [...corePrompts, ...safeSpeechPrompts];
const rows = prompts.map((prompt) => {
  const sequence = prompt.type === "Code-switching"
    ? prompt.language.split("+").map((value) => value.trim())
    : [prompt.language];
  return `(${[
    quote(prompt.id),
    "1",
    quote(prompt.type),
    quote(prompt.language),
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
