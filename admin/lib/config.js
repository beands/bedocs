import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = import.meta.dirname;
export const ADMIN_DIR = resolve(__dirname, "..");

const { env } = process;

export const DOCS_ROOT = resolve(
  env.DOCS_ROOT || join(ADMIN_DIR, "..", "apps", "docs")
);
export const CONTENT_DIR = join(DOCS_ROOT, "content");
export const PROJECTS_DIR = join(CONTENT_DIR, "projects");
export const SETTINGS_FILE = env.SETTINGS_FILE
  ? resolve(env.SETTINGS_FILE)
  : join(ADMIN_DIR, "settings.json");
export const CONFIG_FILE = join(DOCS_ROOT, "bedocs.config.ts");
export const JOBS_DIR = env.JOBS_DIR
  ? resolve(env.JOBS_DIR)
  : join(ADMIN_DIR, ".jobs");

export const CREA_AI_BASE = (
  env.CREA_AI_BASE || "https://crea-ai.ru/v1"
).replace(/\/+$/, "");
export const PORT = Number(env.ADMIN_PORT || env.PORT || 3001);
export const SITE_URL = (env.SITE_URL || "").replace(/\/+$/, "");

// Build command: how the docs site is rebuilt after generation.
// Default matches the self-hosted deployment; tests override via env.
export const BUN_BIN = env.BUN_BIN || "/home/beands/.bun/bin/bun";
export const BUILD_CMD = env.BUILD_CMD || ""; // e.g. "echo build" in tests
export const BUILD_TIMEOUT_MS = Number(env.BUILD_TIMEOUT_MS || 300_000);
export const PM2_APP = env.PM2_APP || "bedocs";

// Generation retry policy
export const GEN_MAX_ATTEMPTS = Number(env.GEN_MAX_ATTEMPTS || 5);
export const GEN_BACKOFF_BASE_MS = Number(env.GEN_BACKOFF_BASE_MS || 1000);
export const GEN_BACKOFF_MAX_MS = Number(env.GEN_BACKOFF_MAX_MS || 60_000);
export const GEN_REQUEST_TIMEOUT_MS = Number(
  env.GEN_REQUEST_TIMEOUT_MS || 300_000
);
export const GEN_POLL_INTERVAL_MS = Number(env.GEN_POLL_INTERVAL_MS || 3000);
export const GEN_POLL_MAX_MS = Number(env.GEN_POLL_MAX_MS || 360_000);
export const GEN_DRAFT_FLUSH_MS = Number(env.GEN_DRAFT_FLUSH_MS || 500);
export const GEN_MAX_CONTINUATIONS = Number(env.GEN_MAX_CONTINUATIONS || 4);

export const DEFAULT_MODEL = env.DEFAULT_MODEL || "gemini-2-5-flash";
