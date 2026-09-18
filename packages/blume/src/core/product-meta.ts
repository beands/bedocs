/**
 * Centralized product metadata for BeDocs.
 *
 * All user-facing identifiers (product name, CLI command, config filenames,
 * generated directory, package name, env prefix) are defined here to avoid
 * scattering string literals across the codebase. This keeps branding changes
 * in one place and simplifies upstream sync.
 *
 * Internal paths (`packages/blume`) are intentionally kept as-is to reduce
 * merge conflicts with upstream Blume.
 */
export const productMeta = {
  /** CLI binary name. */
  cliName: "bedocs",
  /** Accepted config filenames in priority order. */
  configFiles: ["bedocs.config.ts", "bedocs.config.mjs", "bedocs.config.js"],
  /** Default locale code. */
  defaultLocale: "ru",
  /** Human-readable product name shown in UI, CLI, docs. */
  displayName: "BeDocs",
  /** Environment variable prefix for BeDocs-specific settings. */
  envPrefix: "BEDOCS_",
  /** Generated runtime directory name. */
  generatedDir: ".bedocs",
  /** Legacy config filenames from BeDocs — loaded with a deprecation warning. */
  legacyConfigFiles: ["blume.config.ts", "blume.config.mjs", "blume.config.js"],
  /** Additional supported locales. */
  locales: ["ru", "en"],
  /** npm package name (published). */
  packageName: "@beands/bedocs",
  /** Upstream project name (for legal/attribution contexts only). */
  upstreamName: "Blume",
  /** Upstream repository URL. */
  upstreamUrl: "https://github.com/haydenbleasel/blume",
  /** Product website (placeholder — update before release). */
  website: "https://docs.beandsmedia.ru",
} as const;

/** Type for productMeta to enforce literal types in consumers. */
export type ProductMeta = typeof productMeta;
