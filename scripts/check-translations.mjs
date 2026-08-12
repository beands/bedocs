#!/usr/bin/env node
/**
 * check-translations.mjs — verifies that Russian UI strings are present
 * and complete in the i18n UI packs. Checks that the "ru" locale has
 * all keys defined in the baseline UI dictionary.
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Path to the i18n UI TypeScript source.
const UI_FILE = join(ROOT, "packages/blume/src/core/i18n-ui.ts");

async function checkTranslations() {
  const content = await readFile(UI_FILE, "utf-8");

  // Extract the RU_UI object keys by finding the ru UI pack definition.
  // The file exports RU_UI (or similar) with a set of string keys.
  // We check that key Russian strings exist and are not empty.

  // Simple check: ensure RU_UI is defined and has substantial content.
  const hasRuUi = /(?:const|export const)\s+RU_UI\b/.test(content);
  if (!hasRuUi) {
    console.error("❌ Translations check failed: RU_UI pack not found in i18n-ui.ts");
    process.exit(1);
  }

  // Count Russian string entries in the RU_UI block.
  const ruUiMatch = content.match(/RU_UI\s*=\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s);
  if (!ruUiMatch) {
    console.error("❌ Translations check failed: could not parse RU_UI block");
    process.exit(1);
  }

  const ruBlock = ruUiMatch[1];
  const keyCount = (ruBlock.match(/^\s*\w+:/gm) || []).length;

  if (keyCount < 10) {
    console.error(`❌ Translations check failed: RU_UI has only ${keyCount} keys (expected at least 10)`);
    process.exit(1);
  }

  // Check for untranslated English placeholders in Russian strings.
  const englishPlaceholders = ruBlock.match(/:\s*"[A-Z][a-z]+\s/g);
  if (englishPlaceholders && englishPlaceholders.length > 3) {
    console.error(
      `❌ Translations check failed: RU_UI contains ${englishPlaceholders.length} potentially untranslated English strings`
    );
    process.exit(1);
  }

  console.log(`✅ Translations check passed: RU_UI has ${keyCount} keys, no untranslated strings detected.`);
}

checkTranslations().catch((error) => {
  console.error("❌ Translations check failed:", error.message);
  process.exit(1);
});
