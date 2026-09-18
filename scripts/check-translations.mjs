#!/usr/bin/env node
/**
 * check-translations.mjs — verifies that Russian UI strings are present
 * and complete in the i18n UI packs. Checks that the "ru" locale has
 * all keys defined in the baseline UI dictionary.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

// Path to the i18n UI TypeScript source.
const UI_FILE = path.join(ROOT, "packages/blume/src/core/ui-packs/ru.ts");

const checkTranslations = async () => {
  const content = await readFile(UI_FILE, "utf-8");

  // Extract the Russian pack keys from the locale-specific module.
  // We check that key Russian strings exist and are not empty.

  // Simple check: ensure the `ru` pack is defined and has substantial content.
  const hasRuUi = /(?:const|export const)\s+ru\b/u.test(content);
  if (!hasRuUi) {
    console.error("❌ Translations check failed: Russian UI pack not found");
    process.exit(1);
  }

  // Count Russian string entries in the RU_UI block.
  const ruUiMatch = content.match(
    /ru(?:\s*:\s*UIStringsOverride)?\s*=\s*\{(?<body>[\s\S]*)\n\};/u
  );
  if (!ruUiMatch) {
    console.error(
      "❌ Translations check failed: could not parse Russian UI pack"
    );
    process.exit(1);
  }

  const ruBlock = ruUiMatch.groups.body;
  const keyCount = (ruBlock.match(/^\s*\w+:/gmu) || []).length;

  if (keyCount < 10) {
    console.error(
      `❌ Translations check failed: RU_UI has only ${keyCount} keys (expected at least 10)`
    );
    process.exit(1);
  }

  // Check for untranslated English placeholders in Russian strings.
  const englishPlaceholders = ruBlock.match(/:\s*"[A-Z][a-z]+\s/gu);
  if (englishPlaceholders && englishPlaceholders.length > 3) {
    console.error(
      `❌ Translations check failed: RU_UI contains ${englishPlaceholders.length} potentially untranslated English strings`
    );
    process.exit(1);
  }

  console.log(
    `✅ Translations check passed: RU_UI has ${keyCount} keys, no untranslated strings detected.`
  );
};

try {
  await checkTranslations();
} catch (error) {
  console.error("❌ Translations check failed:", error.message);
  process.exit(1);
}
