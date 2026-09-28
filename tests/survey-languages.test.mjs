import assert from "node:assert/strict";
import test from "node:test";
import { surveyLanguages } from "../src/app/lib/surveyLanguages.ts";

test("includes every survey language selection without duplicates", () => {
  assert.deepEqual(surveyLanguages({
    primary: "Hausa", homeLanguage: "Igbo", workLanguage: "Nigerian English",
    nativeLanguages: ["Hausa"], otherLanguages: ["Yorùbá"], dailyLanguages: ["Nigerian Pidgin", "Igbo"],
  }), ["Hausa", "Igbo", "Nigerian English", "Nigerian Pidgin", "Yorùbá"]);
});

test("handles missing and malformed survey fields without inventing languages", () => {
  for (const value of [null, undefined, [], {}, "Hausa"]) assert.deepEqual(surveyLanguages(value), []);
  assert.deepEqual(surveyLanguages({ primary: "  Hausa  ", nativeLanguages: [null, 4, "", "Hausa"], otherLanguages: "Igbo" }), ["Hausa"]);
});
