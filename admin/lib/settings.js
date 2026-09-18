import { readFile, writeFile, rename } from "node:fs/promises";

import { SETTINGS_FILE, DEFAULT_MODEL, SITE_URL } from "./config.js";

const DEFAULTS = { creaAiKey: "", defaultModel: DEFAULT_MODEL, siteUrl: "" };

export async function readSettings() {
  try {
    const parsed = JSON.parse(await readFile(SETTINGS_FILE, "utf-8"));
    return { ...DEFAULTS, ...parsed };
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
    hasKey: Boolean(s.creaAiKey),
    siteUrl: s.siteUrl || SITE_URL || "",
  };
}
