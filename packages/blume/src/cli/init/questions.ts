import { basename, resolve } from "pathe";

import {
  detectPackageManager,
  titleize,
  validateContentDir,
} from "./scaffold.ts";
import type {
  InitAnswers,
  PackageManager,
  SourceKind,
  Template,
} from "./scaffold.ts";

/** One prompt option: value plus display label and optional hint. */
interface PromptOption<Value> {
  hint?: string;
  label: string;
  value: Value;
}

/**
 * The prompt surface `collectAnswers` needs — structurally satisfied by the
 * `@clack/prompts` module itself, and by plain fakes in tests. Every prompt
 * resolves to a cancel symbol when the user aborts.
 */
export interface Prompter {
  multiselect: (opts: {
    initialValues?: SourceKind[];
    message: string;
    options: PromptOption<SourceKind>[];
    required?: boolean;
  }) => Promise<SourceKind[] | symbol>;
  select: (opts: {
    message: string;
    options: PromptOption<Template>[];
  }) => Promise<Template | symbol>;
  text: (opts: {
    defaultValue?: string;
    initialValue?: string;
    message: string;
    placeholder?: string;
    validate?: (value: string | undefined) => string | undefined;
  }) => Promise<string | symbol>;
}

/** Flag values the user passed explicitly; each one skips its question. */
export interface InitFlags {
  contentDir?: string;
  directory?: string;
  packageManager?: PackageManager;
  template?: Template;
}

const cancelled = (value: unknown): value is symbol =>
  typeof value === "symbol";

/**
 * Run the interactive init flow, returning the collected answers or `null`
 * when the user cancels. All questions run before anything is written, so a
 * cancel never leaves a partial scaffold behind.
 */
export const collectAnswers = async (
  prompter: Prompter,
  flags: InitFlags,
  defaults: { cwd: string; userAgent?: string }
): Promise<InitAnswers | null> => {
  const directory =
    flags.directory ??
    (await prompter.text({
      defaultValue: ".",
      message: "Где создать проект?",
      placeholder: "./my-docs",
    }));
  if (cancelled(directory)) {
    return null;
  }

  const root = resolve(defaults.cwd, directory);
  const title = await prompter.text({
    initialValue: titleize(basename(root)),
    message: "Как называется ваш сайт документации?",
    validate: (value) =>
      value?.trim() ? undefined : "Укажите название сайта документации.",
  });
  if (cancelled(title)) {
    return null;
  }

  const template =
    flags.template ??
    (await prompter.select({
      message: "Выберите шаблон:",
      options: [
        { hint: "Сайт документации на Markdown", label: "docs", value: "docs" },
        { hint: "Справочник OpenAPI на /api", label: "api", value: "api" },
        { hint: "Документация SDK со страницей установки", label: "sdk", value: "sdk" },
        {
          hint: "Документация плюс вкладка changelog",
          label: "changelog",
          value: "changelog",
        },
        {
          hint: "Synthix — платформа синтеза аудио",
          label: "synthix",
          value: "synthix",
        },
        {
          hint: "Taskcraft — управление задачами",
          label: "taskcraft",
          value: "taskcraft",
        },
        {
          hint: "BeandsBooker — онлайн-бронирование",
          label: "beandsbooker",
          value: "beandsbooker",
        },
        {
          hint: "Универсальный шаблон",
          label: "universal",
          value: "universal",
        },
      ],
    }));
  if (cancelled(template)) {
    return null;
  }

  const picked = await prompter.multiselect({
    initialValues: ["filesystem"],
    message: "Где хранится контент?",
    options: [
      { hint: "Локальные .mdx файлы", label: "filesystem", value: "filesystem" },
      {
        hint: "Changelog из GitHub Releases",
        label: "github-releases",
        value: "github-releases",
      },
      { hint: "База данных Notion", label: "notion", value: "notion" },
      { hint: "Датасет Sanity", label: "sanity", value: "sanity" },
      {
        hint: "MDX из GitHub-репозитория",
        label: "mdx-remote",
        value: "mdx-remote",
      },
    ],
    required: false,
  });
  if (cancelled(picked)) {
    return null;
  }
  // No selection desugars to the implicit local source, same as the schema.
  const sources: SourceKind[] = picked.length === 0 ? ["filesystem"] : picked;

  let contentDir = flags.contentDir ?? "docs";
  if (flags.contentDir === undefined && sources.includes("filesystem")) {
    const answer = await prompter.text({
      defaultValue: "docs",
      message: "Директория с контентом?",
      placeholder: "docs",
      validate: (value) => validateContentDir(root, value || "docs"),
    });
    if (cancelled(answer)) {
      return null;
    }
    contentDir = answer;
  }

  return {
    contentDir,
    directory,
    packageManager:
      flags.packageManager ?? detectPackageManager(defaults.userAgent),
    sources,
    template,
    title,
  };
};
