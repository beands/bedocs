// Live monitor for a generation job: SSE stream with automatic
// Last-Event-ID reconnect (built into EventSource) + REST fallback.

import { api } from "./api.js";

const TERMINAL = new Set(["done", "canceled"]);

export class JobMonitor {
  constructor(jobId, { onEvent, onState, onConn } = {}) {
    this.jobId = jobId;
    this.onEvent = onEvent || (() => {});
    this.onState = onState || (() => {});
    this.onConn = onConn || (() => {});
    this.es = null;
    this.state = null;
    this.closed = false;
    this.pollTimer = null;
  }

  async start() {
    await this.refresh();
    if (TERMINAL.has(this.state?.status)) {
      this.onConn("done");
      return;
    }
    this.#openStream();
  }

  #openStream() {
    if (this.closed) {
      return;
    }
    const es = new EventSource(
      `/api/generation-jobs/${encodeURIComponent(this.jobId)}/events`
    );
    this.es = es;
    es.onopen = () => this.onConn("live");
    es.onerror = () => {
      // EventSource retries automatically and sends Last-Event-ID, so the
      // server replays only what was missed. Show the reconnecting state.
      this.onConn(
        es.readyState === EventSource.CLOSED ? "lost" : "reconnecting"
      );
    };
    for (const type of [
      "job.status",
      "stage",
      "page.status",
      "page.delta",
      "page.snapshot",
      "retry",
      "log",
    ]) {
      es.addEventListener(type, (e) => {
        let data;
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        this.onEvent(type, data.payload ?? data, e.lastEventId);
        if (
          type === "job.status" ||
          type === "page.status" ||
          type === "stage"
        ) {
          this.refresh();
        }
      });
    }
  }

  async refresh() {
    try {
      this.state = await api.job(this.jobId);
      this.onState(this.state);
      if (TERMINAL.has(this.state.status)) {
        this.close("done");
      }
    } catch {
      // job may be briefly unavailable during server restart — keep polling
      this.#schedulePoll();
    }
  }

  #schedulePoll() {
    if (this.closed || this.pollTimer) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.refresh();
    }, 3000);
  }

  close(reason = "closed") {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.es?.close();
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    this.onConn(reason);
  }
}

// ─── Shared rendering helpers for a job ─────────────────────

export const STAGE_META = {
  analyze: { icon: "search", name: "Анализ файлов и создание плана" },
  build: { icon: "hammer", name: "Пересборка сайта" },
  pages: { icon: "file-text", name: "Генерация страниц" },
};

export function stageOrder(job) {
  return ["analyze", "pages", "build"].map((stage) => {
    let status = "pending";
    if (job.stage === stage) {
      status = job.status === "done" ? "done" : "running";
    }
    if (stage === "analyze" && job.analysis) {
      status = "done";
    }
    if (
      stage === "pages" &&
      job.pages?.length &&
      job.pages.every((p) => p.status === "saved")
    ) {
      status = "done";
    }
    if (stage === "build") {
      status =
        job.build?.status === "done"
          ? "done"
          : job.stage === "build"
            ? job.build?.status === "error"
              ? "error"
              : "running"
            : "pending";
    }
    if (job.status === "needs_attention" && job.error?.stage === stage) {
      status = "error";
    }
    return { stage, status };
  });
}
