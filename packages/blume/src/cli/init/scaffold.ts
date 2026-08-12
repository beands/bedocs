import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

import { basename, dirname, isAbsolute, join, relative } from "pathe";

import { bedocsPackageJson, toPackageName } from "../../core/package-json.ts";

export const TEMPLATES = [
  "docs",
  "api",
  "sdk",
  "changelog",
  "synthix",
  "taskcraft",
  "beandsbooker",
  "universal",
] as const;
export type Template = (typeof TEMPLATES)[number];

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** The content-source kinds `init` can scaffold a config block for. */
export const SOURCE_KINDS = [
  "filesystem",
  "github-releases",
  "notion",
  "sanity",
  "mdx-remote",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Everything the scaffolder needs, whether prompted or derived from flags. */
export interface InitAnswers {
  contentDir: string;
  /** Target directory as the user gave it (`.` = current directory). */
  directory: string;
  packageManager: PackageManager;
  sources: SourceKind[];
  template: Template;
  title: string;
}

/** One file the scaffold plan will write; `path` is absolute. */
export interface ScaffoldFile {
  content: string;
  path: string;
}

/** Log sink for scaffold output — satisfied by both consola and clack's `log`. */
export interface ScaffoldLog {
  info: (message: string) => void;
  success: (message: string) => void;
}

/** A starter: a config fragment plus seed content files (paths relative to root). */
interface Starter {
  configExtra: string;
  files: (contentDir: string) => { content: string; path: string }[];
}

const page = (title: string, description: string, body: string): string =>
  `---\ntitle: ${title}\ndescription: ${description}\n---\n\n${body}\n`;

export const STARTERS: Record<Template, Starter> = {
  api: {
    configExtra: `
  openapi: {
    enabled: true,
    route: "/api",
    sources: [
      {
        label: "BeDocs API",
        spec: "https://bedocs.com/api/v3/openapi.json",
      },
    ],
  },`,
    files: (dir) => [
      {
        content: page(
          "API Reference",
          "Explore the BeDocs API.",
          "# API Reference\n\nYour OpenAPI specification is displayed on [`/api`](/api). Specify your specification in `openapi.sources` in `bedocs.config.ts`."
        ),
        path: join(dir, "index.mdx"),
      },
    ],
  },
  changelog: {
    configExtra: `
  navigation: {
    tabs: [
      { label: "Docs", path: "/" },
      { label: "Changelog", path: "/changelog" },
    ],
  },`,
    files: (dir) => [
      {
        content: page(
          "Introduction",
          "Welcome to your new BeDocs documentation.",
          "# Introduction\n\nWrite your documentation here, and release notes in the `changelog/` folder."
        ),
        path: join(dir, "index.mdx"),
      },
      {
        content: `---\ntitle: v1.0.0\ntype: changelog\ndate: 2026-01-01\n---\n\nThe first release. Edit \`${dir}/changelog/v1-0-0.mdx\` or add new entries beside it.\n`,
        path: join(dir, "changelog", "v1-0-0.mdx"),
      },
    ],
  },
  docs: {
    configExtra: "",
    files: (dir) => [
      {
        content: page(
          "Introduction",
          "Welcome to your new BeDocs documentation.",
          `# Introduction\n\nWelcome to **BeDocs** — a documentation platform based on Astro and Vite.\n\nEdit \`${dir}/index.mdx\` to get started, then run \`bedocs dev\`.`
        ),
        path: join(dir, "index.mdx"),
      },
    ],
  },
  sdk: {
    configExtra: "",
    files: (dir) => [
      {
        content: page(
          "Introduction",
          "Get started with the BeDocs SDK.",
          "# Introduction\n\nInstall the SDK and make your first call. See [Installation](/installation)."
        ),
        path: join(dir, "index.mdx"),
      },
      {
        content: page(
          "Installation",
          "Установка SDK.",
          "# Установка\n\n```package-install\nyour-sdk\n```"
        ),
        path: join(dir, "installation.mdx"),
      },
    ],
  },
  synthix: {
    configExtra: `
  theme: {
    accent: "purple",
    fonts: {
      body: "space-grotesk",
      display: "space-grotesk",
      mono: "jetbrains-mono",
    },
  },
  navigation: {
    tabs: [
      { label: "Документация", path: "/" },
      { label: "API", path: "/api" },
    ],
  },`,
    files: (dir) => [
      {
        content: page(
          "Synthix",
          "Документация платформы Synthix.",
          "# Synthix\n\n**Synthix** — платформа для синтеза аудио с помощью ИИ.\n\n## Возможности\n\n- Генерация аудио по текстовому описанию\n- Вокальный синтез\n- REST API и WebSocket\n\n## Начало работы\n\nИзучите [руководство по установке](/installation) или [API-справочник](/api)."
        ),
        path: join(dir, "index.mdx"),
      },
      {
        content: page(
          "Установка",
          "Установка и настройка Synthix SDK.",
          "# Установка\n\n```package-install\n@synthix/sdk\n```\n\n## Быстрый старт\n\n```ts\nimport { Synthix } from \"@synthix/sdk\";\n\nconst client = new Synthix({ apiKey: process.env.SYNTHIX_API_KEY });\n```"
        ),
        path: join(dir, "installation.mdx"),
      },
    ],
  },
  taskcraft: {
    configExtra: `
  theme: {
    accent: "teal",
    fonts: {
      body: "inter",
      display: "inter-tight",
      mono: "fira-code",
    },
  },
  navigation: {
    tabs: [
      { label: "Руководства", path: "/" },
      { label: "API", path: "/api" },
      { label: "Changelog", path: "/changelog" },
    ],
  },`,
    files: (dir) => [
      {
        content: page(
          "Taskcraft",
          "Документация системы управления задачами Taskcraft.",
          "# Taskcraft\n\n**Taskcraft** — система управления задачами и проектами для команд.\n\n## Возможности\n\n- Канбан-доски и спринты\n- Временные трекеры\n- REST API и вебхуки\n\n## Начало работы\n\nПрочитайте [руководство по началу работы](/getting-started)."
        ),
        path: join(dir, "index.mdx"),
      },
      {
        content: page(
          "Начало работы",
          "Быстрый старт с Taskcraft API.",
          "# Начало работы\n\n## Получение API-ключа\n\n1. Зарегистрируйтесь на [taskcraft.ru](https://taskcraft.ru)\n2. Перейдите в **Настройки → API**\n3. Создайте новый ключ\n\n## Установка\n\n```package-install\n@taskcraft/sdk\n```"
        ),
        path: join(dir, "getting-started.mdx"),
      },
      {
        content: `---\ntitle: v1.0.0\ntype: changelog\ndate: 2026-01-01\n---\n\nПервый релиз Taskcraft. Редактируйте \`${dir}/changelog/v1-0-0.mdx\` или добавляйте новые записи рядом.\n`,
        path: join(dir, "changelog", "v1-0-0.mdx"),
      },
    ],
  },
  beandsbooker: {
    configExtra: `
  theme: {
    accent: "orange",
    fonts: {
      body: "manrope",
      display: "playfair-display",
      mono: "ibm-plex-mono",
    },
  },
  navigation: {
    tabs: [
      { label: "Документация", path: "/" },
      { label: "API", path: "/api" },
    ],
  },`,
    files: (dir) => [
      {
        content: page(
          "BeandsBooker",
          "Документация сервиса бронирования BeandsBooker.",
          "# BeandsBooker\n\n**BeandsBooker** — сервис онлайн-бронирования для малого бизнеса.\n\n## Возможности\n\n- Онлайн-запись клиентов\n- Управление расписанием\n- REST API для интеграции\n\n## Начало работы\n\nИзучите [API-справочник](/api) или [руководство по интеграции](/integration)."
        ),
        path: join(dir, "index.mdx"),
      },
      {
        content: page(
          "Интеграция",
          "Интеграция BeandsBooker в ваш сайт.",
          "# Интеграция\n\n## Виджет записи\n\nВставьте виджет на любую страницу:\n\n```html\n<script src=\"https://cdn.beandsbooker.ru/widget.js\" data-business=\"your-id\"></script>\n```\n\n## REST API\n\nБазовый URL: `https://api.beandsbooker.ru/v1`"
        ),
        path: join(dir, "integration.mdx"),
      },
    ],
  },
  universal: {
    configExtra: "",
    files: (dir) => [
      {
        content: page(
          "Документация",
          "Универсальный шаблон документации BeDocs.",
          "# Добро пожаловать\n\nЭто универсальный шаблон **BeDocs** — подходит для любого типа документации.\n\n## Возможности\n\n- Markdown и MDX\n- Локальный поиск\n- Темная и светлая темы\n- i18n с русским по умолчанию\n\n## Начало работы\n\nОтредактируйте `index.mdx` и запустите `bedocs dev`."
        ),
        path: join(dir, "index.mdx"),
      },
    ],
  },
};

/**
 * Install + dev commands to print for the chosen package manager, plus the
 * prefix that runs a locally installed bin (`exec`, e.g. `npx bedocs eject`) —
 * dependency bins aren't on PATH, so a bare `bedocs …` hint would not run.
 */
export const commandsFor = (
  pm: PackageManager
): { build: string; dev: string; exec: string; install: string } => ({
  // `bun build` invokes Bun's bundler, not the package.json `build` script —
  // unlike `bun dev`, the script name is shadowed by a builtin subcommand.
  build: pm === "npm" || pm === "bun" ? `${pm} run build` : `${pm} build`,
  dev: pm === "npm" ? "npm run dev" : `${pm} dev`,
  exec: { bun: "bunx", npm: "npx", pnpm: "pnpm exec", yarn: "yarn" }[pm],
  install: `${pm} install`,
});

/**
 * Derive the package manager from an npm user-agent string (the first
 * `name/version` token of `npm_config_user_agent`), falling back to npm.
 */
export const detectPackageManager = (userAgent?: string): PackageManager => {
  const name = userAgent?.split("/")[0] as PackageManager | undefined;
  return name !== undefined && PACKAGE_MANAGERS.includes(name) ? name : "npm";
};

/**
 * The content dir is joined into every scaffolded file path, so an absolute or
 * `../`-escaping value would write outside the project. Returns an error
 * message, or `undefined` when the dir is safe.
 */
export const validateContentDir = (
  root: string,
  dir: string
): string | undefined =>
  isAbsolute(dir) || relative(root, join(root, dir)).startsWith("..")
    ? "Must be a relative path inside the project."
    : undefined;

/** Turn a directory name into a display title: `my-docs` → `My Docs`. */
export const titleize = (raw: string): string => {
  const words = raw
    .replaceAll(/[-_.]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
  return words.length === 0
    ? "My Docs"
    : words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
};

/** True when any selected source is remote (everything except `filesystem`). */
const hasRemoteSource = (sources: SourceKind[]): boolean =>
  sources.some((source) => source !== "filesystem");

/**
 * Config snippets for each remote source kind, with placeholder values to
 * replace and comments naming the env var each source authenticates with.
 */
const SOURCE_SNIPPETS: Record<Exclude<SourceKind, "filesystem">, string> = {
  "github-releases": `      // Changelog entries from GitHub Releases. Private repos read
      // GITHUB_TOKEN from the environment.
      {
        type: "github-releases",
        owner: "your-org",
        repo: "your-repo",
        prefix: "changelog",
      },`,
  "mdx-remote": `      // MDX fetched from a GitHub repo. Private repos read GITHUB_TOKEN
      // from the environment.
      {
        type: "mdx-remote",
        github: { owner: "your-org", repo: "your-repo", path: "docs" },
        prefix: "remote",
      },`,
  notion: `      // Pages from a Notion database. Reads NOTION_TOKEN from the environment.
      {
        type: "notion",
        database: "your-database-id",
        prefix: "notion",
      },`,
  sanity: `      // Documents from a Sanity dataset. Private datasets read SANITY_TOKEN
      // from the environment.
      {
        type: "sanity",
        projectId: "your-project-id",
        dataset: "production",
        query: \`*[_type == "doc"]\`,
        prefix: "sanity",
      },`,
};

/**
 * The `content` block for the generated config, or an empty string when the
 * defaults (filesystem source, `docs` root) apply — keeping the default
 * scaffold byte-identical to a config with no `content` key at all.
 */
const contentBlockFor = (answers: InitAnswers): string => {
  const sources =
    answers.sources.length === 0 ? ["filesystem" as const] : answers.sources;
  if (!hasRemoteSource(sources)) {
    return answers.contentDir === "docs"
      ? ""
      : `
  content: {
    root: ${JSON.stringify(answers.contentDir)},
  },`;
  }
  // Explicit sources replace the implicit filesystem desugar, so the local
  // content dir must be listed alongside the remote sources to stay included.
  const entries = SOURCE_KINDS.filter((kind) => sources.includes(kind)).map(
    (kind) =>
      kind === "filesystem"
        ? `      { type: "filesystem", root: ${JSON.stringify(answers.contentDir)} },`
        : SOURCE_SNIPPETS[kind]
  );
  return `
  content: {
    sources: [
${entries.join("\n")}
    ],
  },`;
};

/** The full `bedocs.config.ts` text for the chosen answers. */
export const buildConfig = (
  answers: InitAnswers
): string => `import { defineConfig } from "@beands/bedocs";

export default defineConfig({
  title: ${JSON.stringify(answers.title)},
  description: "Документация на базе BeDocs.",${STARTERS[answers.template].configExtra}${contentBlockFor(answers)}
});
`;

/** SDK dependencies required by the selected remote sources. */
const extraDepsFor = (sources: SourceKind[]): Record<string, string> => ({
  ...(sources.includes("notion") && { "@notionhq/client": "^2.2.15" }),
  ...(sources.includes("sanity") && { "@sanity/client": "^7.25.0" }),
});

/** Every file `init` should write for the given answers, package.json first. */
export const buildPlan = (
  root: string,
  answers: InitAnswers
): ScaffoldFile[] => {
  const files: ScaffoldFile[] = [
    {
      content: bedocsPackageJson(
        toPackageName(basename(root)),
        extraDepsFor(answers.sources)
      ),
      path: join(root, "package.json"),
    },
    { content: buildConfig(answers), path: join(root, "bedocs.config.ts") },
  ];
  // Seed pages only make sense when a local filesystem source will read them.
  if (answers.sources.length === 0 || answers.sources.includes("filesystem")) {
    files.push(
      ...STARTERS[answers.template]
        .files(answers.contentDir)
        .map((file) => ({ ...file, path: join(root, file.path) }))
    );
  }
  return files;
};

const writeFileSafe = async (
  file: ScaffoldFile,
  log: ScaffoldLog
): Promise<boolean> => {
  if (existsSync(file.path)) {
    log.info(`Skipped existing ${file.path}`);
    return false;
  }
  await mkdir(dirname(file.path), { recursive: true });
  await writeFile(file.path, file.content, "utf-8");
  log.success(`Created ${file.path}`);
  return true;
};

/**
 * Write the plan's files, skipping any that already exist. Reports whether a
 * `package.json` was newly created (it decides the install next-step).
 */
export const applyPlan = async (
  files: ScaffoldFile[],
  log: ScaffoldLog
): Promise<{ createdPackage: boolean }> => {
  const created = await Promise.all(
    files.map((file) => writeFileSafe(file, log))
  );
  const createdPackage = files.some(
    (file, index) => created[index] && basename(file.path) === "package.json"
  );
  return { createdPackage };
};

/** Env vars the selected sources read, in a stable order. */
const envVarsFor = (sources: SourceKind[]): string[] =>
  [
    ["GITHUB_TOKEN", ["github-releases", "mdx-remote"]] as const,
    ["NOTION_TOKEN", ["notion"]] as const,
    ["SANITY_TOKEN", ["sanity"]] as const,
  ]
    .filter(([, kinds]) => kinds.some((kind) => sources.includes(kind)))
    .map(([envVar]) => envVar);

/** The next-steps message: `cd` hint, install/dev commands, and token setup. */
export const nextSteps = (
  answers: InitAnswers,
  createdPackage: boolean
): string => {
  const commands = commandsFor(answers.packageManager);
  const lines: string[] = [];
  if (answers.directory !== ".") {
    lines.push(`cd ${answers.directory}`);
  }
  if (createdPackage) {
    lines.push(commands.install);
  }
  lines.push(commands.dev);
  const envVars = envVarsFor(answers.sources);
  const auth =
    envVars.length > 0
      ? `\nУстановите ${envVars.join(" и ")} в .env.local для аутентификации источников.\n`
      : "";
  return `Следующие шаги:\n\n  ${lines.join("\n  ")}\n${auth}`;
};
