import { rm } from "node:fs/promises";

import { defineCommand } from "citty";
import { join } from "pathe";

import { loadConfig } from "../../core/config.ts";
import {
  resolveProjectContext,
  resolveRuntimeDir,
} from "../../core/project.ts";
import { readDevLock } from "../dev-lock.ts";
import { logger } from "../log.ts";
import { prepareProject } from "../prepare.ts";

export const syncCommand = defineCommand({
  args: {
    force: {
      description: "Clear the source cache before refetching.",
      type: "boolean",
    },
    preview: {
      description: "Include drafts and unpublished CMS content.",
      type: "boolean",
    },
    strict: { description: "Fail on diagnostics.", type: "boolean" },
  },
  meta: {
    description: "Обновить удалённые источники контента и регенерировать runtime.",
    name: "sync",
  },
  async run({ args }) {
    const root = process.cwd();

    // `--force` drops the snapshots so a stale or corrupt cache can't be served;
    // scoped to `.bedocs/cache`, so a running dev server's runtime is untouched.
    if (args.force) {
      const { config } = await loadConfig(root);
      const context = resolveProjectContext(root, config);
      await rm(join(context.outDir, "cache"), { force: true, recursive: true });
      logger.info("Cleared source cache.");
    }

    // Dev mode keeps drafts and skips the static-build gate; `refresh` forces
    // remote sources to re-fetch rather than serve their cached snapshot. A
    // running dev server hot-reloads from the regenerated runtime — so when one
    // is live, regenerate with the same site fallback (its URL) it used, else
    // its astro.config loses `site` (dropping OG and canonicals) and Astro
    // restarts cold.
    const lock = readDevLock(resolveRuntimeDir(root));
    const devServerUrl = lock?.port
      ? `http://localhost:${lock.port}`
      : undefined;
    await prepareProject({
      devServerUrl,
      mode: "dev",
      preview: args.preview,
      refresh: true,
      root,
      strict: args.strict,
    });

    logger.success("Synced content sources.");
  },
});
