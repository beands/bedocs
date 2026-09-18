import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

export default defineConfig({
  // Tests run on Bun's `bun:test` runner (Jest-compatible API), so the Vitest
  // lint preset is intentionally not extended — its
  // `prefer-importing-vitest-globals` rule misreads `bun:test` imports.
  // anti-slop last: it disables the two core rules it fix/break-loops with
  // (consistent-indexed-object-style, no-immediate-mutation).
  extends: [core, react, antiSlop],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    // Astro components are linted by `astro check`, not oxlint, which misparses
    // single-file `.astro` syntax (template + frontmatter).
    "**/*.astro",
    // Blume's generated runtime is an implementation detail.
    "**/.blume",
    // Vendored agent-skill assets (e.g. remotion-best-practices example code)
    // are upstream content, not project source; linting them just diverges from
    // upstream and gets clobbered on the next skill update.
    "**/.agents/skills/**",
    "**/.claude/skills/**",
    // Docs code-sample source shown verbatim in a before/after diff; the
    // PascalCase `Button` export IS the example, so naming rules don't apply.
    "apps/docs/diffs",
    // The admin panel is a standalone Express app outside the Bun workspaces
    // (own npm toolchain: node:test + Playwright, not the package's TS code).
    // Its predecessor predates this ruleset and was never lint-clean; several
    // core rules (no-await-in-loop, func-style) conflict with intentional
    // sequential checkpointing in the generation runner.
    "admin/**",
    "packages/video/src/components",
    "packages/video/src/lib/utils.ts",
    "packages/video/src/lib/remocn-ui",
    "packages/blume/CHANGELOG.md",
  ],
});
