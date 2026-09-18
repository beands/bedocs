import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { PROJECTS_DIR, CONFIG_FILE } from "./config.js";

export async function listMdxFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.match(/\.(md|mdx)$/))
    .map((e) => e.name)
    .sort();
}

// Atomic file write: temp + rename so readers never see a partial file.
export async function atomicWriteFile(file, content) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, file);
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function updateConfigNavigation() {
  try {
    if (!existsSync(PROJECTS_DIR)) {
      return;
    }
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    const projectNames = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    let config = await readFile(CONFIG_FILE, "utf-8");
    const tabs = [];
    for (const name of projectNames) {
      const title = name
        .replaceAll(/-/g, " ")
        .replaceAll(/\b\w/g, (c) => c.toUpperCase());
      tabs.push(`      { label: "${title}", path: "/projects/${name}" },`);
    }
    tabs.push(`      {
        label: {
          de: "Änderungen",
          en: "Changelog",
          hi: "चेंजलॉग",
          ja: "変更履歴",
          pt: "Alterações",
          ru: "Изменения",
        },
        path: "/changelog",
      },`);
    const tabsBlock = `    tabs: [\n${tabs.join("\n")}\n    ],`;
    config = config.replace(/ {4}tabs: \[[\s\S]*?\],/, tabsBlock);
    await writeFile(CONFIG_FILE, config);
  } catch (error) {
    console.error("Failed to update config navigation:", error.message);
  }
}
