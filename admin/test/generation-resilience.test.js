import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test, before, after } from "node:test";

import { spawnAdmin, waitJob, readSse } from "./helpers/app.js";

const ANALYSIS = `ПЛАН:
- **Имя файла:** index.mdx
  **Заголовок:** Главная
  **Источники:** intro.md
  **Описание:** Главная страница проекта
  **Порядок:** 0
- **Имя файла:** api.mdx
  **Заголовок:** API
  **Источники:** api.md
  **Описание:** Описание API
  **Порядок:** 1`;

const pageText = (name, title, extra = "") =>
  `\`\`\`file:${name}\n---\ntitle: "${title}"\ndescription: "${title} page"\nsidebar:\n  label: "${title}"\n  order: 0\n---\n\n# ${title}\n\n${Array.from({ length: 12 }, (_, i) => `Paragraph ${name}-${String(i).padStart(2, "0")} of generated documentation content.`).join(" ")}${extra}\n\`\`\``;

let ctx;

before(async () => {
  ctx = await spawnAdmin();
});
after(async () => {
  await ctx.stop();
  ctx.crea.server.close();
});

let seq = 0;
async function generateAndWait(behaviors, opts = {}) {
  ctx.crea.state.behaviors.length = 0; // drop leftovers from previous tests
  ctx.crea.state.behaviors.push(...behaviors);
  ctx.crea.state.byModel = {};
  if (opts.byModel) {
    ctx.crea.state.byModel = opts.byModel;
  }
  ctx.crea.state.requests.length = 0;
  // unique instructions → unique inputHash → no cross-test job dedup
  const res = await ctx.api.post("/api/projects/test-proj/generate", {
    instructions: `test-${++seq}`,
    model: "mock-model",
  });
  assert.equal(
    res.status,
    202,
    `expected 202, got ${res.status}: ${JSON.stringify(res.body)}`
  );
  assert.ok(res.body.jobId);
  const job = await waitJob(
    ctx.api,
    res.body.jobId,
    opts.statuses || ["done", "paused", "needs_attention", "canceled"],
    opts
  );
  return { job, jobId: res.body.jobId };
}

// 1. Happy path: job runs to completion, files written, events recorded.
test("happy path: generate completes and writes files", async () => {
  const { jobId, job } = await generateAndWait([
    { text: ANALYSIS, type: "stream" },
    { text: pageText("index.mdx", "Главная"), type: "stream" },
    { text: pageText("api.mdx", "API"), type: "stream" },
  ]);
  assert.equal(job.status, "done");
  assert.equal(job.pages.length, 2);
  assert.ok(job.pages.every((p) => p.status === "saved"));
  for (const f of ["index.mdx", "api.mdx"]) {
    const content = await readFile(join(ctx.projectsDir, f), "utf-8");
    assert.match(content, /title:/);
    assert.match(content, /of generated documentation content/);
  }
  assert.ok(job.checksums["index.mdx"]);
  assert.ok(job.build.status === "done");
});

// 2. Crea AI drops during analysis → retried, analysis persisted once received.
test("failure during analysis is retried and completes", async () => {
  const { job } = await generateAndWait([
    { status: 500, type: "status" },
    { fraction: 0.3, text: ANALYSIS, type: "cut" },
    { text: ANALYSIS, type: "stream" },
    { text: pageText("index.mdx", "Главная"), type: "stream" },
    { text: pageText("api.mdx", "API"), type: "stream" },
  ]);
  assert.equal(job.status, "done");
  assert.ok(job.analysis.includes("ПЛАН"));
});

// 3. Stream cut mid-page → draft checkpoint → continuation merges cleanly.
test("mid-page stream cut resumes without losing or duplicating text", async () => {
  const full = pageText("index.mdx", "Главная");
  const { job } = await generateAndWait(
    [
      { text: ANALYSIS, type: "stream" },
      { fraction: 0.6, text: full, type: "cut" },
      // the mock echoes the draft tail (like a real model) then emits the rest
      { echoLen: 100, full, type: "continue" },
      { text: pageText("api.mdx", "API"), type: "stream" },
    ],
    { timeoutMs: 20_000 }
  );

  assert.equal(job.status, "done");
  const written = await readFile(join(ctx.projectsDir, "index.mdx"), "utf-8");
  const expected = full
    .replace(/^```file:index\.mdx\n/, "")
    .replace(/\n```$/, "")
    .trim();
  assert.equal(
    written,
    expected,
    "merged page must equal the intended text with no duplicated overlap"
  );
  // a boundary fragment appears exactly once — nothing duplicated at the seam
  const tail = expected.slice(
    Math.floor(expected.length * 0.55),
    Math.floor(expected.length * 0.55) + 50
  );
  assert.equal(
    written.split(tail).length - 1,
    1,
    "boundary fragment must not be duplicated"
  );
});

// 4. 429 + Retry-After and transient 5xx → backoff then success.
test("429 with Retry-After and transient 5xx are retried", async () => {
  const { jobId, job } = await generateAndWait([
    { text: ANALYSIS, type: "stream" },
    { retryAfter: 0, status: 429, type: "status" },
    { status: 503, type: "status" },
    { text: pageText("index.mdx", "Главная"), type: "stream" },
    { text: pageText("api.mdx", "API"), type: "stream" },
  ]);
  assert.equal(job.status, "done");
  const jobState = await ctx.api.get(`/api/generation-jobs/${jobId}`);
  assert.ok(jobState.pages.every((p) => p.status === "saved"));
});

// 5+7. Process restart mid-job → resume from checkpoint; saved pages NOT regenerated.
test("server restart mid-job resumes; saved pages are not regenerated", async () => {
  ctx.crea.state.behaviors.length = 0;
  ctx.crea.state.behaviors.push(
    { text: ANALYSIS, type: "stream" },
    { text: pageText("index.mdx", "Главная"), type: "stream" },
    { ms: 60000, type: "hang" } // page 2 never finishes before the kill
  );
  ctx.crea.state.requests.length = 0;
  const res = await ctx.api.post("/api/projects/test-proj/generate", {
    instructions: `restart-test-${++seq}`,
  });
  const { jobId } = res.body;
  // wait until index.mdx is saved and the job is stuck on the hanging page
  const deadline = Date.now() + 10_000;
  for (;;) {
    const job = await ctx.api.get(`/api/generation-jobs/${jobId}`);
    if (
      job.pages?.find((p) => p.fileName === "index.mdx")?.status === "saved" &&
      job.currentPage === "api.mdx"
    ) {
      break;
    }
    if (Date.now() > deadline) {
      throw new Error("job did not reach page 2");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const indexBefore = await readFile(
    join(ctx.projectsDir, "index.mdx"),
    "utf-8"
  );

  // kill + restart the whole process; the resumed page's response is queued
  // BEFORE the restart so the auto-resume can never hit an empty queue
  ctx.crea.state.behaviors.push({
    text: pageText("api.mdx", "API"),
    type: "stream",
  });
  await ctx.restart();

  const job = await waitJob(
    ctx.api,
    jobId,
    ["done", "paused", "needs_attention"],
    { timeoutMs: 15_000 }
  );
  assert.equal(job.status, "done");
  // requests: analysis(1) + page1(1) + hanging page2(1) + resumed page2(1) = 4; a page1 regen would make 5
  assert.equal(
    ctx.crea.state.requests.length,
    4,
    "saved page must not be regenerated after restart"
  );
  const indexAfter = await readFile(
    join(ctx.projectsDir, "index.mdx"),
    "utf-8"
  );
  assert.equal(indexAfter, indexBefore);
});

// 6. Async remote job: restart resumes polling the SAME remote job (no duplicate POST).
test("async job resume polls the same remote job without reposting", async () => {
  ctx.crea.state.behaviors.length = 0;
  ctx.crea.state.behaviors.push(
    { text: ANALYSIS, type: "stream" },
    { polls: 4, text: pageText("index.mdx", "Главная"), type: "queued" },
    { text: pageText("api.mdx", "API"), type: "stream" }
  );
  ctx.crea.state.requests.length = 0;
  const res = await ctx.api.post("/api/projects/test-proj/generate", {
    instructions: `async-test-${++seq}`,
  });
  const { jobId } = res.body;
  const job = await waitJob(ctx.api, jobId, ["done", "paused"], {
    timeoutMs: 15_000,
  });
  assert.equal(job.status, "done");
  const posts = ctx.crea.state.requests.length;
  assert.equal(posts, 3, "analysis + one queued POST + one page stream");
  const polls = Object.values(ctx.crea.state.pollsPerJob).reduce(
    (a, b) => a + b,
    0
  );
  assert.ok(polls >= 4, "remote job was polled until success");
});

// 8. No-duplication is enforced by test 3's exact-equality assertion.

// 9. Build failure keeps generated documents; build is a separate retryable stage.
test("build failure keeps documents and is retryable separately", async () => {
  const ctx2 = await spawnAdmin({
    extraEnv: { BUILD_CMD: "definitely-not-a-command-xyz" },
  });
  try {
    ctx2.crea.state.behaviors.push(
      { text: ANALYSIS, type: "stream" },
      { text: pageText("index.mdx", "Главная"), type: "stream" },
      { text: pageText("api.mdx", "API"), type: "stream" }
    );
    const res = await ctx2.api.post("/api/projects/test-proj/generate", {
      instructions: "buildfail",
    });
    const job = await waitJob(ctx2.api, res.body.jobId, ["done"], {
      timeoutMs: 15_000,
    });
    assert.equal(job.status, "done");
    assert.equal(job.build.status, "error");
    for (const f of ["index.mdx", "api.mdx"]) {
      assert.ok(
        existsSync(join(ctx2.projectsDir, f)),
        `${f} must survive a failed build`
      );
    }
  } finally {
    await ctx2.stop();
    ctx2.crea.server.close();
  }
});

// 10. Cancel mid-stream keeps written files; manual resume finishes the job.
test("cancel keeps saved work; resume completes the job", async () => {
  ctx.crea.state.behaviors.length = 0;
  ctx.crea.state.behaviors.push(
    { text: ANALYSIS, type: "stream" },
    { text: pageText("index.mdx", "Главная"), type: "stream" },
    { ms: 60000, type: "hang" }
  );
  const res = await ctx.api.post("/api/projects/test-proj/generate", {
    instructions: `cancel-test-${++seq}`,
  });
  const { jobId } = res.body;
  const deadline = Date.now() + 10_000;
  for (;;) {
    const job = await ctx.api.get(`/api/generation-jobs/${jobId}`);
    if (job.currentPage === "api.mdx") {
      break;
    }
    if (Date.now() > deadline) {
      throw new Error("job did not reach page 2");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  await ctx.api.post(`/api/generation-jobs/${jobId}/cancel`, {});
  const canceled = await waitJob(ctx.api, jobId, ["canceled"]);
  assert.equal(canceled.status, "canceled");
  assert.ok(
    existsSync(join(ctx.projectsDir, "index.mdx")),
    "saved page survives cancel"
  );

  ctx.crea.state.behaviors.push({
    text: pageText("api.mdx", "API"),
    type: "stream",
  });
  await ctx.api.post(`/api/generation-jobs/${jobId}/resume`, {});
  const job = await waitJob(ctx.api, jobId, ["done", "paused"], {
    timeoutMs: 15_000,
  });
  assert.equal(job.status, "done");
});

// 11. Fatal (non-retryable) errors → needs_attention, not infinite retries.
test("401 is not retried: job goes to needs_attention", async () => {
  ctx.crea.state.behaviors.length = 0;
  ctx.crea.state.behaviors.push({ status: 401, type: "status" });
  ctx.crea.state.requests.length = 0;
  const res = await ctx.api.post("/api/projects/test-proj/generate", {
    instructions: "fatal-test",
  });
  const job = await waitJob(
    ctx.api,
    res.body.jobId,
    ["needs_attention", "paused"],
    { timeoutMs: 15_000 }
  );
  assert.equal(job.status, "needs_attention");
  assert.equal(
    ctx.crea.state.requests.length,
    1,
    "fatal error must not be retried"
  );
});

// 12. SSE: events replay from Last-Event-ID after reconnect.
test("SSE stream replays events after Last-Event-ID reconnect", async () => {
  const { jobId } = await generateAndWait([
    { text: ANALYSIS, type: "stream" },
    { text: pageText("index.mdx", "Главная"), type: "stream" },
    { text: pageText("api.mdx", "API"), type: "stream" },
  ]);
  // reconnect asking for events since id 0 — server replays the log
  const sse = readSse(ctx.api, jobId, { since: 0 });
  await new Promise((r) => setTimeout(r, 500));
  sse.close();
  await sse.done;
  assert.ok(sse.events.length > 0, "replayed events expected");
  const types = new Set(sse.events.map((e) => e.type));
  assert.ok(types.has("job.status"));
  assert.ok(types.has("page.status"));
  assert.ok(
    sse.events.every((e) => e.id > 0),
    "events carry ids for Last-Event-ID"
  );
});

// 13. crea-ai.ru never sends [DONE] — a clean EOF with full content is a
// complete response, not a failure (this was the production failure mode).
test("stream ending without [DONE] but with full content is accepted", async () => {
  const { job } = await generateAndWait([
    { fraction: 1, text: ANALYSIS, type: "endEarly" },
    { fraction: 1, text: pageText("index.mdx", "Главная"), type: "endEarly" },
    { fraction: 1, text: pageText("api.mdx", "API"), type: "endEarly" },
  ]);
  assert.equal(job.status, "done");
  assert.ok(existsSync(join(ctx.projectsDir, "index.mdx")));
  assert.ok(existsSync(join(ctx.projectsDir, "api.mdx")));
});

// 14. A model that keeps failing exhausts its retries, then the job switches
// to the next model in the fallback chain and continues — no pause.
test("failing model is replaced by a fallback model mid-job", async () => {
  const { job } = await generateAndWait([], {
    byModel: {
      "mock-model": { status: 500, type: "status" }, // fails on every request
    },
    timeoutMs: 20_000,
  });
  try {
    assert.equal(job.status, "done");
    assert.equal(
      job.model,
      "gemini-3-8-flash",
      "job must switch to the first fallback model"
    );
    const used = new Set(ctx.crea.state.requests.map((r) => r.model));
    assert.ok(used.has("gemini-3-8-flash"));
    // the primary model burned exactly its retry budget, nothing more
    const primaryCalls = ctx.crea.state.requests.filter(
      (r) => r.model === "mock-model"
    ).length;
    assert.ok(primaryCalls > 0 && primaryCalls <= 6);
  } finally {
    ctx.crea.state.byModel = {};
  }
});

// 15. A cleanly-closed but mid-file truncated stream is continued from the
// draft checkpoint — the partial page is never written to disk.
test("truncated soft-EOF page continues from draft, not written partial", async () => {
  const full = pageText("index.mdx", "Главная");
  const { job } = await generateAndWait(
    [
      { text: ANALYSIS, type: "stream" },
      { fraction: 0.6, text: full, type: "endEarly" },
      { echoLen: 100, full, type: "continue" },
      { text: pageText("api.mdx", "API"), type: "stream" },
    ],
    { timeoutMs: 20_000 }
  );
  assert.equal(job.status, "done");
  const written = await readFile(join(ctx.projectsDir, "index.mdx"), "utf-8");
  const expected = full
    .replace(/^```file:index\.mdx\n/, "")
    .replace(/\n```$/, "")
    .trim();
  assert.equal(written, expected, "no partial/truncated content on disk");
});

// 16. Every model in the chain failing is the global case: the job pauses,
// then the scheduled auto-resume finishes it once the provider recovers.
test("all models exhausted: pause, then real auto-resume completes the job", async () => {
  const ctx2 = await spawnAdmin({
    extraEnv: { GEN_MAX_ATTEMPTS: "2", GEN_PAUSE_RETRY_MS: "150" },
  });
  try {
    const fail = { status: 503, type: "status" };
    ctx2.crea.state.byModel = {
      "gemini-3-7-flash": fail,
      "gemini-3-8-flash": fail,
      "grok-4-6": fail,
      "mock-model": fail,
    };
    const res = await ctx2.api.post("/api/projects/test-proj/generate", {
      instructions: "autoresume-test",
      model: "mock-model",
    });
    assert.equal(res.status, 202);
    const jobId = res.body.jobId;
    const paused = await waitJob(ctx2.api, jobId, ["paused"], {
      timeoutMs: 15_000,
    });
    assert.equal(paused.status, "paused");

    // Provider recovers — the scheduled auto-resume finishes the job alone.
    ctx2.crea.state.byModel = {};
    ctx2.crea.state.behaviors.push(
      { text: ANALYSIS, type: "stream" },
      { text: pageText("index.mdx", "Главная"), type: "stream" },
      { text: pageText("api.mdx", "API"), type: "stream" }
    );
    const job = await waitJob(ctx2.api, jobId, ["done"], {
      timeoutMs: 15_000,
    });
    assert.equal(job.status, "done");
    assert.ok(
      (job.autoResumes || 0) >= 1,
      "job must record at least one auto-resume round"
    );
  } finally {
    await ctx2.stop();
    ctx2.crea.server.close();
  }
});
