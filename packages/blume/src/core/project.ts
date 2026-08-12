import { existsSync } from "node:fs";

import { isAbsolute, join, resolve } from "pathe";

import { productMeta } from "./product-meta.ts";
import type { ResolvedConfig } from "./schema.ts";
import type { ProjectContext } from "./types.ts";

const CONFIG_FILENAMES = productMeta.configFiles;
const LEGACY_CONFIG_FILENAMES = productMeta.legacyConfigFiles;

const THEME_FILENAMES = ["theme.css"];
const COMPONENTS_FILENAMES = ["components.tsx", "components.ts"];

const firstExisting = (root: string, names: readonly string[]): string | null => {
  for (const name of names) {
    const candidate = join(root, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

/**
 * Locate the BeDocs config file for a project root, if any.
 * Falls back to legacy BeDocs config filenames with a deprecation warning.
 */
export const findConfigFile = (root: string): string | null => {
  const primary = firstExisting(root, CONFIG_FILENAMES);
  if (primary) {
    return primary;
  }
  const legacy = firstExisting(root, LEGACY_CONFIG_FILENAMES);
  if (legacy) {
    console.warn(
      `⚠️  Найден устаревший конфиг файл BeDocs (legacy): ${legacy}\n` +
        `   Рекомендуется переместить его в bedocs.config.ts.\n` +
        `   Запустите "bedocs migrate blume" для автоматической миграции.\n`
    );
  }
  return legacy;
};

/**
 * Resolve the generated runtime directory for a project. Defaults to
 * `<root>/.bedocs`; an override (e.g. `.bedocs-verify` for an isolated build that
 * runs alongside a live `bedocs dev`) may be relative to the root or absolute.
 */
export const resolveRuntimeDir = (
  root: string,
  runtimeDir: string = productMeta.generatedDir
): string =>
  isAbsolute(runtimeDir) ? runtimeDir : join(resolve(root), runtimeDir);

/**
 * Resolve every path BeDocs needs from a project root and its resolved config.
 * Paths are absolute and normalized. `options.runtimeDir` relocates the whole
 * generated runtime (and its build output) so a verify build/check can run
 * without touching a live dev server's `.bedocs/` or the real `dist/`.
 */
export const resolveProjectContext = (
  root: string,
  config: ResolvedConfig,
  options?: { runtimeDir?: string }
): ProjectContext => {
  const absoluteRoot = resolve(root);
  const contentRoot = isAbsolute(config.content.root)
    ? config.content.root
    : join(absoluteRoot, config.content.root);

  const pagesPath = join(absoluteRoot, config.content.pages);
  const pagesRoot = existsSync(pagesPath) ? pagesPath : null;

  const outDir = resolveRuntimeDir(absoluteRoot, options?.runtimeDir);
  // A relocated runtime keeps its build output self-contained under itself, so a
  // verify build never empties the user's real `<root>/dist`.
  const distDir = options?.runtimeDir
    ? join(outDir, "dist")
    : join(absoluteRoot, "dist");

  return {
    componentsFile: firstExisting(absoluteRoot, COMPONENTS_FILENAMES),
    configFile: findConfigFile(absoluteRoot),
    contentRoot,
    distDir,
    outDir,
    pagesRoot,
    root: absoluteRoot,
    themeFile: firstExisting(absoluteRoot, THEME_FILENAMES),
  };
};
