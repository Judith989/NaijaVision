import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function render() {
  const outputPath = fileURLToPath(new URL("../out/index.html", import.meta.url));
  return readFile(outputPath, "utf8");
}

test("statically exports the NaijaVision open contribution platform", async () => {
  const html = await render();

  assert.match(html, /<title>NaijaVision: Contribute to Nigerian Language Research<\/title>/i);
  assert.match(html, /Help machines/);
  assert.match(html, /the way Nigeria speaks/);
  assert.match(html, /Open worldwide/);
  assert.match(html, /Create a minimal verified account/);
  assert.doesNotMatch(html, /Review data/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});
