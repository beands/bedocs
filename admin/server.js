import { existsSync } from "node:fs";
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  rm,
  stat,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import multer from "multer";

import { runBuild } from "./lib/build.js";
import {
  ADMIN_DIR,
  PROJECTS_DIR,
  PORT,
  SITE_URL,
  CREA_AI_BASE,
} from "./lib/config.js";
import { listMdxFiles, updateConfigNavigation } from "./lib/fs-utils.js";
import {
  createJob,
  resumeJob,
  cancelJob,
  retryBuild,
  getJobState,
  subscribe,
  isRunning,
  resumeUnfinishedJobs,
  JobError,
} from "./lib/generation-runner.js";
import * as store from "./lib/job-store.js";
import { readSettings, writeSettings, publicSettings } from "./lib/settings.js";
import {
  isValidProjectName,
  isValidDocFileName,
  safeJoin,
} from "./lib/validate.js";

const __dirname = import.meta.dirname;

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(join(__dirname, "public")));

// Vendored client assets (installed via admin/package.json — no CDN at runtime).
for (const [route, rel] of [
  ["/vendor/lucide", join("node_modules", "lucide", "dist", "umd")],
  [
    "/vendor/fonts",
    join("node_modules", "@fontsource-variable", "inter", "files"),
  ],
]) {
  const dir = join(ADMIN_DIR, rel);
  if (existsSync(dir)) {
    app.use(route, express.static(dir));
  }
}

const asyncRoute = (fn) => (req, res) =>
  fn(req, res).catch((error) => {
    const status = error instanceof JobError ? error.status : 500;
    res.status(status).json({ error: error.message });
  });

function resolveProjectPath(req, res) {
  const { name } = req.params;
  if (!isValidProjectName(name)) {
    res.status(400).json({ error: "Недопустимое имя проекта" });
    return null;
  }
  const p = safeJoin(PROJECTS_DIR, name);
  if (!p || !existsSync(p)) {
    res.status(404).json({ error: "Проект не найден" });
    return null;
  }
  return p;
}

// ─── Settings ──────────────────────────────────────────────────

app.get(
  "/api/settings",
  asyncRoute(async (req, res) => {
    res.json(publicSettings(await readSettings()));
  })
);

app.post(
  "/api/settings",
  asyncRoute(async (req, res) => {
    const { creaAiKey, defaultModel, fallbackModels, siteUrl } = req.body || {};
    const s = await readSettings();
    if (creaAiKey !== undefined && !String(creaAiKey).startsWith("***")) {
      s.creaAiKey = creaAiKey;
    }
    if (defaultModel) {
      s.defaultModel = defaultModel;
    }
    if (fallbackModels !== undefined) {
      s.fallbackModels = (
        Array.isArray(fallbackModels) ? fallbackModels : [fallbackModels]
      )
        .flatMap((m) => String(m).split(","))
        .map((m) => m.trim())
        .filter(Boolean);
    }
    if (siteUrl !== undefined) {
      s.siteUrl = String(siteUrl).replace(/\/+$/, "");
    }
    await writeSettings(s);
    res.json({ success: true, ...publicSettings(s) });
  })
);

// Public client config (site base URL for "open site" links).
app.get(
  "/api/config",
  asyncRoute(async (req, res) => {
    const s = await readSettings();
    res.json({ siteUrl: s.siteUrl || SITE_URL || "" });
  })
);

// ─── Projects API ──────────────────────────────────────────────

app.get(
  "/api/projects",
  asyncRoute(async (req, res) => {
    if (!existsSync(PROJECTS_DIR)) {
      await mkdir(PROJECTS_DIR, { recursive: true });
      return res.json({ projects: [] });
    }
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    const projects = [];
    const allJobs = await store.listJobs();
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const projectPath = join(PROJECTS_DIR, entry.name);
      const files = await listMdxFiles(projectPath);
      const stats = await stat(projectPath);
      const lastJob = allJobs.find((j) => j.project === entry.name) || null;
      projects.push({
        created: stats.birthtime,
        fileNames: files,
        files: files.length,
        lastJob: lastJob
          ? {
              jobId: lastJob.jobId,
              status: lastJob.status,
              updatedAt: lastJob.updatedAt,
              filesWritten: lastJob.filesWritten?.length || 0,
            }
          : null,
        modified: stats.mtime,
        name: entry.name,
        slug: entry.name,
        url: `/projects/${entry.name}`,
      });
    }
    res.json({ projects });
  })
);

app.get(
  "/api/projects/:name",
  asyncRoute(async (req, res) => {
    const projectPath = resolveProjectPath(req, res);
    if (!projectPath) {
      return;
    }
    const files = await listMdxFiles(projectPath);
    const fileContents = {};
    for (const file of files) {
      fileContents[file] = await readFile(join(projectPath, file), "utf-8");
    }
    res.json({
      fileContents,
      files,
      name: req.params.name,
      url: `/projects/${req.params.name}`,
    });
  })
);

app.post(
  "/api/projects",
  asyncRoute(async (req, res) => {
    const { name, description } = req.body || {};
    if (!name || !isValidProjectName(name)) {
      return res
        .status(400)
        .json({ error: "Имя проекта: только строчные буквы, цифры и дефисы" });
    }
    const projectPath = safeJoin(PROJECTS_DIR, name);
    if (!projectPath || existsSync(projectPath)) {
      return res.status(409).json({ error: "Проект уже существует" });
    }
    await mkdir(projectPath, { recursive: true });
    const title = name
      .replaceAll(/-/g, " ")
      .replaceAll(/\b\w/g, (c) => c.toUpperCase());
    const indexContent = `---\ntitle: ${title}\ndescription: ${description || `Документация проекта ${title}.`}\nsidebar:\n  label: ${title}\n  order: 0\n---\n\n# ${title}\n\n${description || `Документация проекта **${title}**.`}\n\nЗагрузите Markdown файлы через панель управления или используйте AI-генерацию для создания структурированной документации.\n`;
    await writeFile(join(projectPath, "index.mdx"), indexContent);
    await updateConfigNavigation();
    res.json({ name, success: true, url: `/projects/${name}` });
  })
);

app.delete(
  "/api/projects/:name",
  asyncRoute(async (req, res) => {
    const projectPath = resolveProjectPath(req, res);
    if (!projectPath) {
      return;
    }
    await rm(projectPath, { recursive: true });
    await updateConfigNavigation();
    res.json({ success: true });
  })
);

// ─── File Upload API ───────────────────────────────────────────

app.post(
  "/api/projects/:name/upload",
  upload.array("files", 50),
  asyncRoute(async (req, res) => {
    const projectPath = resolveProjectPath(req, res);
    if (!projectPath) {
      return;
    }
    const uploaded = [];
    for (const file of req.files || []) {
      const name = file.originalname.replace(/^.*[\\/]/, ""); // strip client-side paths
      if (!isValidDocFileName(name)) {
        continue;
      }
      await writeFile(join(projectPath, name), file.buffer);
      uploaded.push(name);
    }
    res.json({ success: true, uploaded });
  })
);

// Upload + process (convert MD to MDX with frontmatter) + rebuild
app.post(
  "/api/projects/:name/upload-and-process",
  upload.array("files", 50),
  asyncRoute(async (req, res) => {
    const projectPath = resolveProjectPath(req, res);
    if (!projectPath) {
      return;
    }

    const uploaded = [];
    const processed = [];

    for (const file of req.files || []) {
      const original = file.originalname.replace(/^.*[\\/]/, "");
      if (!/\.(md|mdx)$/.test(original)) {
        continue;
      }
      const rawContent = file.buffer.toString("utf-8");
      const baseName = original.replace(/\.(md|mdx)$/, "");

      let mdxContent;
      if (rawContent.trimStart().startsWith("---")) {
        mdxContent = rawContent;
      } else {
        const titleMatch = rawContent.match(/^#\s+(.+)$/m);
        const rawTitle = titleMatch
          ? titleMatch[1].trim()
          : baseName
              .replaceAll(/-/g, " ")
              .replaceAll(/\b\w/g, (c) => c.toUpperCase());
        const title = rawTitle.replaceAll(/"/g, '\\"');
        const rawDesc = rawContent
          .slice(0, 160)
          .replaceAll(/[#*`\n\r]/g, " ")
          .trim();
        const description = rawDesc.replaceAll(/"/g, '\\"');
        const order = uploaded.length;
        mdxContent = `---\ntitle: "${title}"\ndescription: "${description}"\nsidebar:\n  label: "${title}"\n  order: ${order}\n---\n\n${rawContent}`;
      }

      const mdxName = `${baseName}.mdx`;
      if (!isValidDocFileName(mdxName)) {
        continue;
      }
      await writeFile(join(projectPath, mdxName), mdxContent, "utf-8");

      if (original !== mdxName && existsSync(join(projectPath, original))) {
        await rm(join(projectPath, original)).catch(() => {});
      }

      uploaded.push(mdxName);
      processed.push({ from: original, to: mdxName });
    }

    if (uploaded.length === 0) {
      return res.status(400).json({ error: "Нет .md или .mdx файлов" });
    }

    const buildResult = await runBuild();

    res.json({
      message: `Загружено ${uploaded.length} файл(ов), сайт пересобран`,
      processed,
      rebuild: buildResult,
      success: true,
      uploaded,
    });
  })
);

app.post(
  "/api/projects/:name/files",
  asyncRoute(async (req, res) => {
    const projectPath = resolveProjectPath(req, res);
    if (!projectPath) {
      return;
    }
    const { fileName, content } = req.body || {};
    if (!fileName || content === undefined) {
      return res.status(400).json({ error: "Требуются fileName и content" });
    }
    if (!isValidDocFileName(fileName)) {
      return res.status(400).json({ error: "Недопустимое имя файла" });
    }
    const target = safeJoin(projectPath, fileName);
    if (!target) {
      return res.status(400).json({ error: "Недопустимое имя файла" });
    }
    await writeFile(target, content, "utf-8");
    res.json({ fileName, success: true });
  })
);

app.delete(
  "/api/projects/:name/files/:filename",
  asyncRoute(async (req, res) => {
    const projectPath = resolveProjectPath(req, res);
    if (!projectPath) {
      return;
    }
    const { filename } = req.params;
    if (!isValidDocFileName(filename)) {
      return res.status(400).json({ error: "Недопустимое имя файла" });
    }
    const filePath = safeJoin(projectPath, filename);
    if (!filePath || !existsSync(filePath)) {
      return res.status(404).json({ error: "Файл не найден" });
    }
    await rm(filePath);
    res.json({ success: true });
  })
);

// ─── Build API ─────────────────────────────────────────────────

app.post(
  "/api/rebuild",
  asyncRoute(async (req, res) => {
    const result = await runBuild();
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  })
);

// ─── AI Generation jobs (background, resumable) ────────────────

app.post(
  "/api/projects/:name/generate",
  asyncRoute(async (req, res) => {
    if (!isValidProjectName(req.params.name)) {
      return res.status(400).json({ error: "Недопустимое имя проекта" });
    }
    const { instructions, model, selectedFiles } = req.body || {};
    const { job, deduplicated } = await createJob({
      instructions,
      model,
      project: req.params.name,
      selectedFiles,
    });
    res.status(202).json({
      deduplicated,
      eventsUrl: `/api/generation-jobs/${job.jobId}/events`,
      jobId: job.jobId,
      status: job.status,
    });
  })
);

app.get(
  "/api/generation-jobs",
  asyncRoute(async (req, res) => {
    const jobs = await store.listJobs({
      activeOnly: req.query.active === "1",
      project: req.query.project,
    });
    res.json({
      jobs: jobs.map((j) => ({
        createdAt: j.createdAt,
        error: j.error,
        jobId: j.jobId,
        model: j.model,
        pages: (j.pages || []).map((p) => ({
          fileName: p.fileName,
          title: p.title,
          status: p.status,
        })),
        progress: j.pages?.length
          ? Math.round(
              (j.pages.filter((p) => p.status === "saved").length /
                j.pages.length) *
                100
            )
          : 0,
        project: j.project,
        running: isRunning(j.jobId),
        stage: j.stage,
        status: j.status,
        updatedAt: j.updatedAt,
      })),
    });
  })
);

app.get(
  "/api/generation-jobs/:jobId",
  asyncRoute(async (req, res) => {
    const state = await getJobState(req.params.jobId);
    if (!state) {
      return res.status(404).json({ error: "Задание не найдено" });
    }
    res.json(state);
  })
);

// Server-Sent Events stream. Replays missed events via Last-Event-ID.
app.get(
  "/api/generation-jobs/:jobId/events",
  asyncRoute(async (req, res) => {
    const job = await store.readJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Задание не найдено" });
    }

    res.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    });
    res.write(": ok\n\n");

    const send = (ev) => {
      res.write(
        `id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`
      );
    };

    const sinceId =
      Number(req.headers["last-event-id"] || req.query.since || 0) || 0;
    for (const ev of await store.readEvents(job.jobId, sinceId)) {
      send(ev);
    }

    // Snapshot of the in-flight page so a reconnecting client catches up
    // without replaying every delta (no id → doesn't move the cursor).
    const fresh = await store.readJob(job.jobId);
    if (fresh?.currentPage) {
      const draft = await store.readDraft(job.jobId, fresh.currentPage);
      if (draft) {
        res.write(
          `event: page.snapshot\ndata: ${JSON.stringify({ fileName: fresh.currentPage, text: draft })}\n\n`
        );
      }
    }

    const unsubscribe = subscribe(job.jobId, send);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  })
);

app.post(
  "/api/generation-jobs/:jobId/resume",
  asyncRoute(async (req, res) => {
    const result = await resumeJob(req.params.jobId);
    res.json({ success: true, ...result });
  })
);

app.post(
  "/api/generation-jobs/:jobId/cancel",
  asyncRoute(async (req, res) => {
    const result = await cancelJob(req.params.jobId);
    res.json({ success: true, ...result });
  })
);

app.post(
  "/api/generation-jobs/:jobId/retry",
  asyncRoute(async (req, res) => {
    const stage = req.body?.stage;
    const result =
      stage === "build"
        ? await retryBuild(req.params.jobId)
        : await resumeJob(req.params.jobId);
    res.json({ success: true, ...result });
  })
);

// ─── Models list from crea-ai ──────────────────────────────────

app.get(
  "/api/models",
  asyncRoute(async (req, res) => {
    const settings = await readSettings();
    if (!settings.creaAiKey) {
      return res.json({ models: [] });
    }
    const response = await fetch(`${CREA_AI_BASE}/models`, {
      headers: { Authorization: `Bearer ${settings.creaAiKey}` },
    });
    if (!response.ok) {
      return res
        .status(502)
        .json({ error: "Не удалось получить список моделей" });
    }
    const data = await response.json();
    const models = (data.data || []).map((m) => ({ id: m.id, name: m.id }));
    res.json({ models });
  })
);

// ─── Start ─────────────────────────────────────────────────────

const server = app.listen(PORT, "0.0.0.0", async () => {
  console.log(`BeDocs Admin Panel: http://0.0.0.0:${PORT}`);
  console.log(`Projects: ${PROJECTS_DIR}`);
  const resumed = await resumeUnfinishedJobs();
  if (resumed > 0) {
    console.log(`Resumed ${resumed} unfinished generation job(s)`);
  }
});

export { app, server };
