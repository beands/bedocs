import { readFile, writeFile, rename } from "node:fs/promises";

import { SETTINGS_FILE, DEFAULT_MODEL, SITE_URL } from "./config.js";

const DEFAULTS = {
  creaAiKey: "",
  defaultModel: DEFAULT_MODEL,
  fallbackModels: [],
  siteUrl: "",
};

export async function readSettings() {
  try {
    const parsed = JSON.parse(await readFile(SETTINGS_FILE, "utf-8"));
    const s = { ...DEFAULTS, ...parsed };
    // Accept a comma-separated string as well as an array.
    if (typeof s.fallbackModels === "string") {
      s.fallbackModels = s.fallbackModels
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
    }
    if (!Array.isArray(s.fallbackModels)) {
      s.fallbackModels = [];
    }
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

// Atomic write: temp file + rename so a crash never leaves a truncated file.
export async function writeSettings(settings) {
  const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2));
  await rename(tmp, SETTINGS_FILE);
}

export function maskKey(key) {
  return key ? `***${key.slice(-4)}` : "";
}

export function publicSettings(s) {
  return {
    creaAiKey: maskKey(s.creaAiKey),
    defaultModel: s.defaultModel || DEFAULT_MODEL,
    fallbackModels: Array.isArray(s.fallbackModels)
      ? s.fallbackModels.join(", ")
      : "",
    hasKey: Boolean(s.creaAiKey),
    siteUrl: s.siteUrl || SITE_URL || "",
  };
}
