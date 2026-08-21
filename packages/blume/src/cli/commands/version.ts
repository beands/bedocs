import { defineCommand } from "citty";

import { loadConfig } from "../../core/config.ts";
import { BlumeError } from "../../core/diagnostics.ts";
import { CutError, cutVersion } from "../../core/version-cut.ts";
import { reportInternalError } from "../internal-error.ts";
import { logger } from "../log.ts";

export const versionCommand = defineCommand({
  args: {
    force: {
      description: "Перезаписать существующую папку со снимком версии.",
      type: "boolean",
    },
    id: {
      description: 'Идентификатор создаваемой версии (например, "v1.0").',
      required: false,
      type: "positional",
    },
  },
  meta: {
    description: "Сохранить текущую документацию как архивную версию.",
    name: "version",
  },
  async run({ args }) {
    const root = process.cwd();

    if (!args.id) {
      const { config } = await loadConfig(root);
      if (!config.versions) {
        logger.info(
          "Версионирование не настроено. Создайте первую версию командой `bedocs version <id>` (например, `bedocs version v1.0`)."
        );
        return;
      }
      const { current, archived } = config.versions;
      process.stdout.write(
        `  ${current.label} (текущая)${current.badge ? ` — ${current.badge}` : ""}\n`
      );
      for (const version of archived) {
        process.stdout.write(
          `  ${version.label ?? version.id} — ${version.id}/\n`
        );
      }
      return;
    }

    try {
      const result = await cutVersion(root, args.id, { force: args.force });
      logger.success(
        `Создан снимок ${result.dir} (скопировано файлов: ${result.copied})`
      );
      const totalRewrites = result.rewritten.reduce(
        (sum, entry) => sum + entry.count,
        0
      );
      if (totalRewrites > 0) {
        logger.info(
          `Переписаны абсолютные ссылки на страницах: ${result.rewritten.length}; изменено строк: ${totalRewrites}.`
        );
      }
      if (result.configUpdated) {
        logger.success(
          `Версия "${args.id}" добавлена в versions.archived файла bedocs.config.ts`
        );
      } else if (result.configSnippet) {
        logger.info(result.configSnippet);
      }
      logger.info(
        "Архивные версии неизменяемы: дальнейшие правки вносите в актуальную документацию. Перезапустите `bedocs dev`, чтобы увидеть снимок."
      );
    } catch (error) {
      if (error instanceof CutError) {
        logger.error(error.message);
        process.exit(1);
      }
      if (error instanceof BlumeError) {
        logger.error(error.diagnostic.message);
        process.exit(1);
      }
      reportInternalError(error);
      process.exit(1);
    }
  },
});
