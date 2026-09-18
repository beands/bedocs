import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { runBuild } from "./build.js";
import {
  PROJECTS_DIR,
  GEN_MAX_CONTINUATIONS,
  GEN_DRAFT_FLUSH_MS,
  DEFAULT_MODEL,
} from "./config.js";
import {
  chatCompletion,
  pollRemoteJob,
  withRetry,
  isAbortError,
  isRetryable,
} from "./crea-ai.js";
import { listMdxFiles, atomicWriteFile } from "./fs-utils.js";
import * as store from "./job-store.js";
import {
  buildAnalyzePrompt,
  parsePlanPages,
  buildPagePrompt,
  buildContinuationPrompt,
  parseGeneratedFiles,
} from "./prompts.js";
import { readSettings } from "./settings.js";
import { isValidDocFileName, safeJoin } from "./validate.js";

// ─── In-memory run state ──────────────────────────────────────
// Single-process (PM2 fork) — in-memory guards are sufficient.

const runs = new Map(); // jobId -> { controller, promise }
const subscribers = new Map(); // jobId -> Set<fn>
const emitQueues = new Map(); // jobId -> Promise (serialize event writes)

function emit(job, type, payload = {}) {
  const prev = emitQueues.get(job.jobId) || Promise.resolve();
  const next = prev
    .then(() => store.appendEvent(job, type, payload))
    .then((event) => {
      const subs = subscribers.get(job.jobId);
      if (subs) {
        for (const fn of subs) {
          try {
            fn(event);
          } catch {
            /* subscriber error */
          }
        }
      }
      return event;
    })
    .catch(() => {});
  emitQueues.set(job.jobId, next);
  return next;
}

export function subscribe(jobId, fn) {
  let set = subscribers.get(jobId);
  if (!set) {
    set = new Set();
    subscribers.set(jobId, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ─── Job creation ─────────────────────────────────────────────

export class JobError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function createJob({
  project,
  instructions,
  model,
  selectedFiles,
}) {
  const settings = await readSettings();
  if (!settings.creaAiKey) {
    throw new JobError(
      "API-ключ crea-ai не настроен. Добавьте ключ в настройках."
    );
  }

  const projectPath = safeJoin(PROJECTS_DIR, project);
  if (!projectPath || !existsSync(projectPath)) {
    throw new JobError("Проект не найден", 404);
  }

  const allFiles = await listMdxFiles(projectPath);
  if (allFiles.length === 0) {
    throw new JobError(
      "В проекте нет файлов. Сначала загрузите Markdown файлы."
    );
  }

  const filesToProcess =
    selectedFiles && selectedFiles.length > 0
      ? allFiles.filter((f) => selectedFiles.includes(f))
      : allFiles;
  if (filesToProcess.length === 0) {
    throw new JobError("Не выбраны файлы для обработки.");
  }

  const fileContents = {};
  const fileHashes = {};
  for (const file of filesToProcess) {
    fileContents[file] = await readFile(join(projectPath, file), "utf-8");
    fileHashes[file] = sha256(fileContents[file]);
  }
  const aiModel = model || settings.defaultModel || DEFAULT_MODEL;
  const inputHash = sha256(
    JSON.stringify({
      files: fileHashes,
      instructions: instructions || "",
      model: aiModel,
    })
  );

  // Idempotency: an active job with identical inputs is reused, not duplicated.
  const active = await store.listJobs({ activeOnly: true, project });
  const dup = active.find(
    (j) =>
      j.inputHash === inputHash &&
      ["queued", "running", "paused", "needs_attention"].includes(j.status)
  );
  if (dup) {
    return { job: dup, deduplicated: true };
  }

  const job = await store.createJobRecord({
    analysis: null,
    build: { status: "pending" },
    fileHashes,
    inputHash,
    instructions: instructions || "",
    model: aiModel,
    pages: [],
    project,
    selectedFiles: filesToProcess,
  });
  await emit(job, "job.status", { stage: job.stage, status: job.status });

  // Fire-and-forget: the job outlives the HTTP request and the browser tab.
  runJob(job.jobId).catch((error) =>
    console.error(`job ${job.jobId} runner error:`, error)
  );
  return { deduplicated: false, job };
}

// ─── Run loop ─────────────────────────────────────────────────

export function isRunning(jobId) {
  return runs.has(jobId);
}

export async function runJob(jobId) {
  if (runs.has(jobId)) {
    return runs.get(jobId).promise;
  }
  const job = await store.readJob(jobId);
  if (!job) {
    throw new JobError("Задание не найдено", 404);
  }
  if (job.status === "canceled") {
    return job;
  }
  // A "done" job with a failed build is re-runnable: only the build stage repeats.
  if (job.status === "done" && job.build?.status !== "error") {
    return job;
  }

  const controller = new AbortController();
  const promise = execute(job, controller.signal).finally(() =>
    runs.delete(jobId)
  );
  runs.set(jobId, { controller, promise });
  return promise;
}

async function execute(job, signal) {
  const settings = await readSettings();
  job.status = "running";
  job.error = null;
  await store.saveJob(job);
  await emit(job, "job.status", { stage: job.stage, status: "running" });

  try {
    // ── Stage: analysis + plan ──
    if (!job.analysis) {
      job.stage = "analyze";
      await emit(job, "stage", {
        name: "Анализ файлов и создание плана",
        stage: "analyze",
        status: "running",
      });
      const prompt = buildAnalyzePrompt(
        job.project,
        await loadJobFiles(job),
        job.instructions
      );
      const analysis = await callAi(job, {
        apiKey: settings.creaAiKey,
        maxTokens: 8000,
        messages: [
          {
            role: "system",
            content:
              "Ты — архитектор документации. Проанализируй ВСЕ файлы и создай детальный план документации проекта. План должен описывать каждую страницу: имя файла, заголовок, какие исходные файлы использовать, краткое содержание, порядок в sidebar, связи с другими страницами.",
          },
          { role: "user", content: prompt },
        ],
        signal,
      });
      job.analysis = analysis;
      let pages = parsePlanPages(analysis, job.selectedFiles);
      if (pages.length === 0) {
        pages = job.selectedFiles.map((f) => ({
          description: "",
          fileName: f.endsWith(".mdx") ? f : f.replace(/\.md$/, ".mdx"),
          order: 0,
          sources: [f],
          title: f.replace(/\.mdx?$/, ""),
        }));
      }
      job.pages = pages.map((p, i) => ({
        attempts: 0,
        continuations: 0,
        description: p.description,
        fileName: p.fileName,
        order: p.order ?? i,
        sources: p.sources,
        status: "pending",
        title: p.title,
      }));
      await store.saveJob(job); // checkpoint: plan persisted before any page work
      await emit(job, "stage", {
        name: "Анализ файлов и создание плана",
        pages: job.pages.length,
        stage: "analyze",
        status: "done",
      });
    }

    // ── Stage: per-page generation ──
    job.stage = "pages";
    await emit(job, "stage", {
      name: "Генерация страниц",
      stage: "pages",
      status: "running",
      total: (job.pages || []).length,
    });
    const fileContents = await loadJobFiles(job);
    for (const page of job.pages) {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (page.status === "saved") {
        continue;
      } // idempotent: done pages are never regenerated
      page.status = "generating";
      page.attempts += 1;
      job.currentPage = page.fileName;
      await store.saveJob(job);
      await emit(job, "page.status", {
        attempt: page.attempts,
        fileName: page.fileName,
        status: "generating",
      });
      try {
        const written = await generatePage(
          job,
          page,
          fileContents,
          settings.creaAiKey,
          signal
        );
        page.status = "saved";
        page.generated = written;
        for (const f of written) {
          if (!job.filesWritten.includes(f)) job.filesWritten.push(f);
        }
        await store.saveJob(job);
        await emit(job, "page.status", {
          fileName: page.fileName,
          files: written,
          status: "saved",
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        page.status = "error";
        page.error = error.message;
        await store.saveJob(job);
        await emit(job, "page.status", {
          fileName: page.fileName,
          status: "error",
          error: error.message,
        });
        throw error;
      }
    }
    job.currentPage = null;
    await emit(job, "stage", {
      name: "Генерация страниц",
      stage: "pages",
      status: "done",
    });

    // ── Stage: single rebuild at the end ──
    if (job.build?.status !== "done") {
      job.stage = "build";
      await store.saveJob(job);
      await emit(job, "stage", {
        name: "Пересборка сайта",
        stage: "build",
        status: "running",
      });
      const buildResult = await runBuild();
      job.build = {
        at: new Date().toISOString(),
        error: buildResult.error || null,
        output: buildResult.output || "",
        status: buildResult.success ? "done" : "error",
      };
      await emit(job, "stage", {
        error: job.build.error,
        name: "Пересборка сайта",
        stage: "build",
        status: job.build.status,
      });
    }

    job.status = "done";
    job.stage = "done";
    await store.saveJob(job);
    await emit(job, "job.status", {
      build: job.build,
      filesWritten: job.filesWritten,
      status: "done",
    });
  } catch (error) {
    if (isAbortError(error)) {
      job.status = "canceled";
      await store.saveJob(job);
      await emit(job, "job.status", { status: "canceled" });
      return job;
    }
    job.error = {
      message: error.message,
      stage: job.stage,
      page: job.currentPage,
      at: new Date().toISOString(),
    };
    // Retryable failures that exhausted attempts pause for auto/manual resume;
    // fatal ones need attention (fix key/model/input, then resume).
    job.status = isRetryable(error) ? "paused" : "needs_attention";
    await store.saveJob(job);
    await emit(job, "job.status", { error: job.error, status: job.status });
    return job;
  }
  return job;
}

async function loadJobFiles(job) {
  const projectPath = safeJoin(PROJECTS_DIR, job.project);
  const contents = {};
  for (const file of job.selectedFiles) {
    try {
      contents[file] = await readFile(join(projectPath, file), "utf-8");
    } catch {
      /* file may have been deleted between runs */
    }
  }
  return contents;
}

// One AI call with retry policy. Emits retry events so the UI shows attempts.
// If a previous attempt already created a remote async job (remoteStatusUrl
// persisted), we resume polling THAT job instead of posting a duplicate.
async function callAi(job, { apiKey, messages, maxTokens, signal, onDelta }) {
  return withRetry(
    async () => {
      if (job.remoteStatusUrl) {
        const polled = await pollRemoteJob({
          apiKey,
          signal,
          statusUrl: job.remoteStatusUrl,
        });
        job.remoteJobId = null;
        job.remoteStatusUrl = null;
        return polled.text;
      }
      const result = await chatCompletion({
        apiKey,
        maxTokens,
        messages,
        model: job.model,
        onDelta,
        signal,
        stream: true,
      });
      if (result.async) {
        // Persist remote job ids so a restart/resume polls the same job.
        job.remoteJobId = result.remoteJobId;
        job.remoteStatusUrl = result.statusUrl;
        await store.saveJob(job);
        await emit(job, "log", {
          message: "Crea-AI: асинхронное задание, опрос статуса…",
        });
        const polled = await pollRemoteJob({
          apiKey,
          signal,
          statusUrl: result.statusUrl,
        });
        job.remoteJobId = null;
        job.remoteStatusUrl = null;
        return polled.text;
      }
      return result.text;
    },
    {
      onRetry: async ({ attempt, waitMs, error }) => {
        await emit(job, "retry", {
          attempt,
          waitMs,
          error: error.message,
          stage: job.stage,
          page: job.currentPage,
        });
      },
      signal,
    }
  );
}

// ─── Page generation with checkpoints ────────────────────────

async function generatePage(job, page, fileContents, apiKey, signal) {
  const projectPath = safeJoin(PROJECTS_DIR, job.project);
  let draft = await store.readDraft(job.jobId, page.fileName);
  let lastFlush = 0;
  let pendingDraft = null;

  const flushDraft = async () => {
    if (pendingDraft !== null) {
      const text = pendingDraft;
      pendingDraft = null;
      lastFlush = Date.now();
      await store.writeDraft(job.jobId, page.fileName, text);
    }
  };

  const sourceContents = {};
  for (const src of page.sources || []) {
    if (fileContents[src]) sourceContents[src] = fileContents[src];
  }
  if (Object.keys(sourceContents).length === 0) {
    Object.assign(sourceContents, fileContents);
  }

  const baseMessages = () => [
    {
      content:
        "Ты — технический писатель, создающий качественную документацию в формате MDX на русском языке. Используй frontmatter (title, description, sidebar label, order), компоненты BeDocs: <Card>, <CardGroup>, <Steps>, <Step>, :::tip, :::note. Сохраняй ВСЮ техническую информацию, примеры кода, API. Не выдумывай факты — используй только данные из исходных файлов. Создавай связную документацию со ссылками на другие страницы.",
      role: "system",
    },
    {
      content: buildPagePrompt(
        job.project,
        page,
        sourceContents,
        job.pages,
        job.instructions,
        job.analysis || ""
      ),
      role: "user",
    },
  ];

  const result = await withRetry(
    async () => {
      // Too many failed continuations → drop the fragment and regen the page.
      if (draft.length > 50 && page.continuations >= GEN_MAX_CONTINUATIONS) {
        draft = "";
        await store.clearDraft(job.jobId, page.fileName);
        await emit(job, "log", {
          message: `${page.fileName}: черновик отброшен, полная перегенерация`,
        });
      }
      const continuing = draft.length > 50;
      const messages = continuing
        ? [
            { content: baseMessages()[0].content, role: "system" },
            {
              content: buildPagePrompt(
                job.project,
                page,
                sourceContents,
                job.pages,
                job.instructions,
                job.analysis || ""
              ),
              role: "user",
            },
            {
              content: buildContinuationPrompt(page, draft.slice(-4000)),
              role: "user",
            },
          ]
        : baseMessages();

      let streamed = "";
      let finishedText;
      try {
        finishedText = await callAi(job, {
          apiKey,
          maxTokens: 16000,
          messages,
          onDelta: (delta, full) => {
            streamed = full;
            const combined = continuing ? mergeContinuation(draft, full) : full;
            pendingDraft = combined;
            const now = Date.now();
            if (now - lastFlush >= GEN_DRAFT_FLUSH_MS) {
              lastFlush = now;
              store
                .writeDraft(job.jobId, page.fileName, combined)
                .catch(() => {});
            }
            emit(job, "page.delta", {
              fileName: page.fileName,
              text: combined,
            }).catch(() => {});
          },
          signal,
        });
      } catch (error) {
        // Preserve whatever arrived before the break, then let retry resume.
        if (error.partialText || streamed) {
          draft = mergeContinuation(draft, error.partialText || streamed);
          await store.writeDraft(job.jobId, page.fileName, draft);
          if (continuing || draft.length > 50) page.continuations += 1;
          await emit(job, "page.status", {
            fileName: page.fileName,
            status: "retry",
            saved: draft.length,
          });
        }
        throw error;
      }

      const combined = continuing
        ? mergeContinuation(draft, finishedText)
        : finishedText;
      const files = extractPageFiles(page, combined);
      if (!files || Object.keys(files).length === 0) {
        // Unparseable/too-short output: keep draft, retry (continuation context
        // gives the model another shot before we give up on the fragment).
        const e = new Error("AI вернул пустой или невалидный ответ");
        e.retryable = true;
        throw e;
      }
      // Success: write every produced file atomically, right now.
      const written = [];
      job.checksums = job.checksums || {};
      for (const [fileName, content] of Object.entries(files)) {
        if (!isValidDocFileName(fileName)) {
          continue;
        }
        const target = safeJoin(projectPath, fileName);
        if (!target) {
          continue;
        }
        await atomicWriteFile(target, content);
        job.checksums[fileName] = sha256(content);
        written.push(fileName);
      }
      if (written.length === 0) {
        const e = new Error("AI вернул пустой или невалидный ответ");
        e.retryable = true;
        throw e;
      }
      await store.clearDraft(job.jobId, page.fileName);
      return written;
    },
    {
      onRetry: async ({ attempt, waitMs, error }) => {
        await store.saveJob(job);
        await emit(job, "retry", {
          attempt,
          waitMs,
          error: error.message,
          stage: "pages",
          page: page.fileName,
        });
      },
      signal,
    }
  );
  await flushDraft();
  return result;
}

// Merge a continued fragment onto a saved draft, stripping the overlap the
// model repeats at the boundary. The draft tail may lag the echoed text by a
// few bytes (socket cut mid-chunk), so probes are searched anywhere inside the
// head of the addition, not only at position 0.
export function mergeContinuation(existing, addition) {
  if (!existing) {
    return addition || "";
  }
  if (!addition) {
    return existing;
  }
  if (addition.startsWith(existing)) {
    return addition;
  }
  if (existing.endsWith(addition)) {
    return existing;
  }
  // Aligned overlap: the model echoed the draft tail right at position 0.
  const maxK = Math.min(existing.length, addition.length, 4000);
  for (let k = maxK; k >= 8; k--) {
    if (existing.slice(-k) === addition.slice(0, k)) {
      return existing + addition.slice(k);
    }
  }
  // Unaligned: the draft lost bytes at the socket break, so its tail sits a
  // little inside the echoed head. Require a reasonably long probe to avoid
  // false hits on repetitive prose.
  const headWindow = addition.slice(0, 400);
  for (let k = Math.min(existing.length, addition.length, 400); k >= 12; k--) {
    const pos = headWindow.indexOf(existing.slice(-k));
    if (pos > 0) {
      return existing + addition.slice(pos + k);
    }
  }
  return existing + addition;
}

function extractPageFiles(page, text) {
  const parsed = parseGeneratedFiles(text);
  if (Object.keys(parsed).length > 0) {
    return parsed;
  }
  const clean = text
    .replace(/^```(?:file:)?(?:\S+\.mdx?|mdx?)?\n?/m, "")
    .replace(/```$/m, "")
    .trim();
  if (clean.length > 100) {
    const name = page.fileName.endsWith(".mdx")
      ? page.fileName
      : `${page.fileName}.mdx`;
    return { [name]: clean };
  }
  return null;
}

// ─── Job controls ─────────────────────────────────────────────

export async function resumeJob(jobId) {
  const job = await store.readJob(jobId);
  if (!job) {
    throw new JobError("Задание не найдено", 404);
  }
  if (job.status === "done" && job.build?.status !== "error") {
    throw new JobError("Задание уже завершено", 409);
  }
  if (runs.has(jobId)) {
    return { job, resumed: false, alreadyRunning: true };
  }
  // Reset failed/interrupted pages to pending; saved pages are kept.
  for (const p of job.pages || []) {
    if (["error", "generating"].includes(p.status)) {
      p.status = "pending";
      p.error = null;
    }
  }
  if (job.status !== "done") {
    job.status = "queued";
  }
  job.error = null;
  await store.saveJob(job);
  await emit(job, "job.status", { resumed: true, status: "queued" });
  runJob(jobId).catch((error) =>
    console.error(`job ${jobId} runner error:`, error)
  );
  return { job, resumed: true };
}

export async function retryBuild(jobId) {
  const job = await store.readJob(jobId);
  if (!job) {
    throw new JobError("Задание не найдено", 404);
  }
  if (runs.has(jobId)) {
    throw new JobError("Задание уже выполняется", 409);
  }
  job.build = { status: "pending" };
  if (job.status === "done") {
    // rerun only the build stage
    const controller = new AbortController();
    const promise = (async () => {
      job.stage = "build";
      await emit(job, "stage", {
        name: "Пересборка сайта",
        stage: "build",
        status: "running",
      });
      const buildResult = await runBuild();
      job.build = {
        at: new Date().toISOString(),
        error: buildResult.error || null,
        output: buildResult.output || "",
        status: buildResult.success ? "done" : "error",
      };
      await store.saveJob(job);
      await emit(job, "stage", {
        error: job.build.error,
        stage: "build",
        status: job.build.status,
      });
      return job;
    })().finally(() => runs.delete(jobId));
    runs.set(jobId, { controller, promise });
    return { job, retried: true };
  }
  return resumeJob(jobId);
}

export async function cancelJob(jobId) {
  const job = await store.readJob(jobId);
  if (!job) {
    throw new JobError("Задание не найдено", 404);
  }
  const run = runs.get(jobId);
  if (run) {
    run.controller.abort(); // execute() marks the job canceled
    return { canceled: true, job };
  }
  if (["queued", "paused", "needs_attention"].includes(job.status)) {
    job.status = "canceled";
    await store.saveJob(job);
    await emit(job, "job.status", { status: "canceled" });
    return { canceled: true, job };
  }
  return { canceled: false, job };
}

// ─── State for API/UI ─────────────────────────────────────────

export async function getJobState(jobId) {
  const job = await store.readJob(jobId);
  if (!job) {
    return null;
  }
  const state = { ...job };
  state.running = runs.has(jobId);
  const total = (job.pages || []).length;
  const done = (job.pages || []).filter((p) => p.status === "saved").length;
  state.progress =
    total > 0 ? Math.round((done / total) * 100) : job.analysis ? 10 : 0;
  if (job.stage === "build" || job.status === "done") {
    state.progress = Math.max(state.progress, 95);
  }
  if (job.currentPage) {
    state.draft = await store.readDraft(jobId, job.currentPage);
  }
  return state;
}

// Called once at server start: unfinished jobs resume from their checkpoints.
export async function resumeUnfinishedJobs() {
  const unfinished = await store.scanUnfinished();
  for (const job of unfinished) {
    await emit(job, "log", {
      message:
        "Сервер перезапущен — задание возобновляется с контрольной точки",
    });
    runJob(job.jobId).catch((error) =>
      console.error(`job ${job.jobId} resume error:`, error)
    );
  }
  return unfinished.length;
}
