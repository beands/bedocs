import { defineConfig } from "@beands/bedocs";

export default defineConfig({
  ai: {
    mcp: {
      enabled: true,
    },
    skills: "../../skills",
  },
  analytics: {
    vercel: true,
  },
  content: {
    root: "content",
    sources: [
      { root: "content", type: "filesystem" },
      {
        owner: "beandsmedia",
        prefix: "changelog",
        repo: "bedocs",
        type: "github-releases",
      },
    ],
  },
  deployment: {
    adapter: "vercel",
    output: "server",
  },
  description:
    "Платформа для создания документации ваших проектов.",
  export: true,
  i18n: {
    defaultLocale: "ru",
    locales: [
      { code: "ru", label: "Русский" },
      { code: "en", label: "English" },
      { code: "de", label: "Deutsch", style: "Informal du-form" },
      { code: "hi", label: "हिन्दी", style: "Formal आप-form" },
      { code: "ja", label: "日本語", style: "Polite です/ます form" },
      {
        code: "pt",
        label: "Português",
        style: "Brazilian Portuguese, informal você",
      },
    ],
  },
  lastModified: true,
  logo: "/logo.svg",
  navigation: {
    tabs: [
      {
        label: {
          de: "Änderungen",
          en: "Changelog",
          hi: "चेंजलॉग",
          ja: "変更履歴",
          pt: "Alterações",
          ru: "Изменения",
        },
        path: "/changelog",
      },
    ],
  },
  theme: {
    accent: "teal",
  },
  title: "BeDocs",
});
