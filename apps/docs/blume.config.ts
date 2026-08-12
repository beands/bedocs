import { defineConfig } from "blume";

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
  banner: {
    content: "BeDocs is now publicly available.",
    dismissible: true,
    id: "beta",
  },
  content: {
    root: "content",
    sources: [
      { root: "content", type: "filesystem" },
      {
        owner: "haydenbleasel",
        prefix: "changelog",
        repo: "blume",
        type: "github-releases",
      },
    ],
  },
  deployment: {
    adapter: "vercel",
    output: "server",
  },
  description:
    "Open-source, markdown-first documentation powered by Astro and Vite.",
  export: true,
  github: {
    dir: "apps/docs",
    owner: "haydenbleasel",
    repo: "blume",
  },
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
          de: "Doku",
          en: "Docs",
          hi: "दस्तावेज़",
          ja: "ドキュメント",
          pt: "Documentação",
          ru: "Документация",
        },
        path: "/docs",
      },
      { label: "CLI", path: "/cli" },
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
  seo: {
    og: { titles: { "/cli": "CLI" } },
    x: { creator: "@haydenbleasel", handle: "@haydenbleasel" },
  },
  theme: {
    accent: "teal",
  },
  title: "BeDocs",
});
