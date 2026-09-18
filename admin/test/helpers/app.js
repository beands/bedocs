import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { startMockCrea } from "./mock-crea.js";

const ADMIN_DIR = join(import.meta.dirname, "..", "..");

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitForServer(base, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${base}/api/projects`);
      if (r.ok) {
        return;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 50));
    if (i === tries - 1) {
      throw new Error("admin server did not start");
    }
  }
}

function makeApi(base) {
  return {
    base,
    del: (p) => fetch(`${base}${p}`, { method: "DELETE" }),
    get: (p) => fetch(`${base}${p}`).then((r) => r.json()),
    post: (p, body) =>
      fetch(`${base}${p}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      }).then(async (r) => ({ status: r.status, body: await r.json() })),
    raw: (p, opts) => fetch(`${base}${p}`, opts),
  };
}

// Spawn admin/server.js against a temp DOCS_ROOT/JOBS_DIR and a mock Crea AI.
export async function spawnAdmin({
  mock,
  files = {
    "api.md": "# API\n\nAPI reference content.",
    "intro.md": "# Intro\n\nSome source content for the docs.",
  },
  settings,
  extraEnv = {},
} = {}) {
  const crea = mock || (await startMockCrea());
  const tmp = await mkdtemp(join(tmpdir(), "bedocs-admin-test-"));
  const docsRoot = join(tmp, "docs");
  const projectsDir = join(docsRoot, "content", "projects", "test-proj");
  const jobsDir = join(tmp, "jobs");
  await mkdir(projectsDir, { recursive: true });
  await mkdir(jobsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(projectsDir, name), content);
  }
  await writeFile(
    join(docsRoot, "bedocs.config.ts"),
    "export default { navigation: { tabs: [] } };\n"
  );
  const settingsFile = join(tmp, "settings.json");
  await writeFile(
    settingsFile,
    JSON.stringify({
      creaAiKey: "test-key-1234",
      defaultModel: "mock-model",
      ...settings,
    })
  );

  const envFor = (port) => ({
    ...process.env,
    ADMIN_PORT: String(port),
    BUILD_CMD: "skip",
    CREA_AI_BASE: crea.url,
    DOCS_ROOT: docsRoot,
    GEN_BACKOFF_BASE_MS: "30",
    GEN_BACKOFF_MAX_MS: "300",
    GEN_DRAFT_FLUSH_MS: "20",
    GEN_POLL_INTERVAL_MS: "30",
    GEN_REQUEST_TIMEOUT_MS: "10000",
    JOBS_DIR: jobsDir,
    PM2_APP: "",
    SETTINGS_FILE: settingsFile,
    SITE_URL: "http://docs.test",
    ...extraEnv,
  });

  async function start() {
    const port = await freePort();
    const child = spawn(process.execPath, [join(ADMIN_DIR, "server.js")], {
      env: envFor(port),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let errLog = "";
    child.stderr.on("data", (d) => (errLog += d));
    const base = `http://127.0.0.1:${port}`;
    try {
      await waitForServer(base);
    } catch (error) {
      throw new Error(`${error.message}\nstderr: ${errLog}`, { cause: error });
    }
    return { api: makeApi(base), child, port };
  }

  const first = await start();
  return {
    api: first.api,
    child: first.child,
    crea,
    tmp,
    jobsDir,
    projectsDir,
    // Re-spawn against the same dirs — simulates a PM2/process restart.
    async restart() {
      first.child.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 150));
      const next = await start();
      this.api = next.api;
      this.child = next.child;
      return next;
    },
    async stop() {
      this.child?.kill("SIGKILL");
    },
  };
}

// Wait until a job reaches one of the given statuses (polls the REST API).
export async function waitJob(
  api,
  jobId,
  statuses,
  { timeoutMs = 15_000, intervalMs = 50 } = {}
) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await api.get(`/api/generation-jobs/${jobId}`);
    if (job && list.includes(job.status)) {
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `job ${jobId} did not reach ${list.join("/")} (last: ${job?.status})`
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Read SSE events from the job stream until closed or aborted.
export function readSse(api, jobId, { since = 0, onEvent } = {}) {
  const controller = new AbortController();
  const events = [];
  const done = (async () => {
    const res = await api.raw(
      `/api/generation-jobs/${jobId}/events?since=${since}`,
      { signal: controller.signal }
    );
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done: d, value } = await reader.read();
        if (d) {
          break;
        }
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = { data: "", id: null, type: "message" };
          for (const line of block.split("\n")) {
            if (line.startsWith("id:")) {
              ev.id = Number(line.slice(3).trim());
            } else if (line.startsWith("event:")) {
              ev.type = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              ev.data += line.slice(5);
            }
          }
          if (ev.data) {
            try {
              ev.parsed = JSON.parse(ev.data);
            } catch {
              /* keep raw */
            }
            events.push(ev);
            onEvent?.(ev);
          }
        }
      }
    } catch {
      /* aborted or closed */
    }
  })();
  return {
    close: () => controller.abort(),
    done,
    events,
  };
}
