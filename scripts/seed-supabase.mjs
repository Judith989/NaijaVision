import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { corePrompts, safeSpeechPrompts } from "../src/app/prompts.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const consentBody = `
# NaijaVision participant consent

I confirm that I am at least 18 years old. I have read the study information,
understand the tasks and privacy limitations, and voluntarily consent to audio,
mouth-region video, transcript, approved metadata, public dataset release, and
AI research use. NaijaSafeSpeech participation remains separately optional.
`.trim();

const { error: consentError } = await supabase.from("consent_versions").upsert({
  version: "1.0.0",
  title: "NaijaVision Participant Consent",
  body_markdown: consentBody,
  body_sha256: createHash("sha256").update(consentBody).digest("hex"),
  public_release_required: true,
  effective_at: new Date().toISOString(),
}, { onConflict: "version" });
if (consentError) throw consentError;

const { error: policyError } = await supabase.from("compensation_policies").upsert({
  name: "NaijaVision pilot full-session compensation",
  amount: Number(process.env.PILOT_COMPENSATION_AMOUNT || 0),
  currency: process.env.PILOT_COMPENSATION_CURRENCY || "NGN",
  minimum_accepted_recordings: corePrompts.length,
  partial_payment_allowed: false,
  effective_at: new Date().toISOString(),
}, { onConflict: "name" });
if (policyError) throw policyError;

const promptRows = [...corePrompts, ...safeSpeechPrompts].map((prompt) => ({
  id: prompt.id,
  version: 1,
  prompt_type: prompt.type,
  language: prompt.language,
  language_sequence: prompt.type === "Code-switching" ? prompt.language.split("+").map((value) => value.trim()) : [prompt.language],
  original_text: prompt.text,
  normalized_text: prompt.text.toLocaleLowerCase(),
  english_translation: prompt.translation || null,
  response_seconds: prompt.responseSeconds || null,
  safe_speech: prompt.type === "NaijaSafeSpeech",
  enabled: true,
}));
const { error: promptError } = await supabase.from("prompts").upsert(promptRows, { onConflict: "id" });
if (promptError) throw promptError;

console.log(`Seeded consent, compensation policy, and ${promptRows.length} prompts.`);

