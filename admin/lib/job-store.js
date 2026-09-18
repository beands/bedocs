import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  appendFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";

import { JOBS_DIR } from "./config.js";

// Persistent file-backed job store.
// Layout:  .jobs/<jobId>/job.json   (atomic: tmp + rename)
//          .jobs/<jobId>/events.jsonl
//          .jobs/<jobId>/draft-<page>.md

function jobDir(jobId) {
  return join(JOBS_DIR, jobId);
}
function jobFile(jobId) {
  return join(jobDir(jobId), "job.json");
}
function eventsFile(jobId) {
  return join(jobDir(jobId), "events.jsonl");
}
export function draftFile(jobId, fileName) {
  return join(
    jobDir(jobId),
    `draft-${fileName.replaceAll(/[^a-zA-Z0-9._-]/g, "_")}`
  );
}

async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export async function createJobRecord(data) {
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const job = {
    attempts: 0,
    createdAt: now,
    currentPage: null,
    error: null,
    eventsSeq: 0,
    filesWritten: [],
    jobId,
    lastSavedAt: now,
    stage: "analyze",
    status: "queued",
    updatedAt: now,
    ...data,
  };
  await mkdir(jobDir(jobId), { recursive: true });
  await atomicWrite(jobFile(jobId), JSON.stringify(job, null, 2));
  return job;
}

export async function readJob(jobId) {
  try {
    return JSON.parse(await readFile(jobFile(jobId), "utf-8"));
  } catch {
    return null;
  }
}

export async function saveJob(job) {
  const now = new Date().toISOString();
  job.updatedAt = now;
  job.lastSavedAt = now;
  await atomicWrite(jobFile(job.jobId), JSON.stringify(job, null, 2));
}

// Append an event. `job` is the in-memory record owned by the runner — seq is
// bumped on it but job.json is only persisted at checkpoints (saveJob), so
// high-frequency delta events don't cause a full rewrite each time.
export async function appendEvent(job, type, payload = {}) {
  job.eventsSeq =
    Math.max(job.eventsSeq || 0, (await lastEventId(job.jobId)) || 0) + 1;
  const event = {
    id: job.eventsSeq,
    time: new Date().toISOString(),
    type,
    ...payload,
  };
  await appendFile(eventsFile(job.jobId), `${JSON.stringify(event)}\n`);
  return event;
}

export async function lastEventId(jobId) {
  try {
    const raw = await readFile(eventsFile(jobId), "utf-8");
    const tail = raw.trimEnd().split("\n").pop();
    if (!tail) {
      return 0;
    }
    return JSON.parse(tail).id || 0;
  } catch {
    return 0;
  }
}

export async function readEvents(jobId, sinceId = 0) {
  try {
    const raw = await readFile(eventsFile(jobId), "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((e) => e && e.id > sinceId);
  } catch {
    return [];
  }
}

export async function readDraft(jobId, fileName) {
  try {
    return await readFile(draftFile(jobId, fileName), "utf-8");
  } catch {
    return "";
  }
}

export async function writeDraft(jobId, fileName, text) {
  await atomicWrite(draftFile(jobId, fileName), text);
}

export async function clearDraft(jobId, fileName) {
  await rm(draftFile(jobId, fileName), { force: true }).catch(() => {});
}

export async function listJobs({ project, activeOnly } = {}) {
  if (!existsSync(JOBS_DIR)) {
    return [];
  }
  const entries = await readdir(JOBS_DIR, { withFileTypes: true });
  const jobs = [];
  for (const e of entries) {
    if (!e.isDirectory()) {
      continue;
    }
    const job = await readJob(e.name);
    if (!job) {
      continue;
    }
    if (project && job.project !== project) {
      continue;
    }
    if (
      activeOnly &&
      !["queued", "running", "paused", "needs_attention"].includes(job.status)
    ) {
      continue;
    }
    jobs.push(job);
  }
  jobs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return jobs;
}

export async function scanUnfinished() {
  const all = await listJobs();
  // "paused" = global provider failure with a pending auto-resume; a server
  // restart must not strand it.
  return all.filter((j) => ["queued", "running", "paused"].includes(j.status));
}

export async function removeJobDir(jobId) {
  await rm(jobDir(jobId), { force: true, recursive: true });
}
