import assert from "node:assert/strict";
import test from "node:test";
import { recordedCategories } from "../src/app/lib/recordedCategories.ts";

test("counts recorded languages and separates hate speech from regular recordings", () => {
  assert.deepEqual(recordedCategories([
    { language: "Hausa", prompt_assignments: { prompt_id: "HA-001" } },
    { language: "Hausa", prompt_assignments: [{ prompt_id: "HA-002" }] },
    { language: "Hausa", prompt_assignments: { prompt_id: "SAFE-HA-001" } },
    { language: "Igbo", prompt_assignments: { prompt_id: "SAFE-IG-001" } },
    { language: "Nigerian English", prompt_assignments: { prompt_id: "EN-001" } },
  ]), [
    { language: "Hausa", safeSpeech: false, count: 2 },
    { language: "Nigerian English", safeSpeech: false, count: 1 },
    { language: "Hausa", safeSpeech: true, count: 1 },
    { language: "Igbo", safeSpeech: true, count: 1 },
  ]);
});

test("keeps code-switched categories intact and handles empty submissions", () => {
  assert.deepEqual(recordedCategories([]), []);
  assert.deepEqual(recordedCategories([
    { language: "Igbo + Nigerian English", prompt_assignments: { prompt_id: "CS-IG-001" } },
  ]), [{ language: "Igbo + Nigerian English", safeSpeech: false, count: 1 }]);
});
