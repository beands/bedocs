import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, before, after } from "node:test";

import { spawnAdmin } from "./helpers/app.js";

let ctx;

before(async () => {
  ctx = await spawnAdmin();
});
after(async () => {
  await ctx.stop();
  ctx.crea.server.close();
});

// ─── Path traversal / input validation ─────────────────────────

test("project names are validated everywhere", async () => {
  for (const bad of [
    "..%2F..%2Fetc",
    "UPPER",
    "a b",
    "x".repeat(100),
    "a..z",
  ]) {
    const r = await ctx.api.raw(`/api/projects/${encodeURIComponent(bad)}`);
    assert.equal(
      r.status,
      400,
      `GET /api/projects/${bad} must be 400, got ${r.status}`
    );
  }
  // these never reach the handler — the URL is normalized away (still no traversal)
  for (const bad of ["..", "a/b"]) {
    const r = await ctx.api.raw(`/api/projects/${encodeURIComponent(bad)}`);
    assert.ok(
      [400, 404].includes(r.status),
      `GET /api/projects/${bad} must not be 200, got ${r.status}`
    );
  }
});

test("file names reject traversal and non-md extensions", async () => {
  for (const bad of [
    "../../evil.mdx",
    "..\\evil.md",
    "sub/dir.mdx",
    ".hidden.mdx",
    "evil.txt",
    "a..b.mdx",
  ]) {
    const r = await ctx.api.post("/api/projects/test-proj/files", {
      content: "x",
      fileName: bad,
    });
    assert.equal(
      r.status,
      400,
      `fileName ${bad} must be rejected, got ${r.status}`
    );
    const d = await ctx.api.raw(
      `/api/projects/test-proj/files/${encodeURIComponent(bad)}`,
      { method: "DELETE" }
    );
    assert.ok(
      [400, 404].includes(d.status),
      `DELETE ${bad} must not succeed, got ${d.status}`
    );
  }
  assert.ok(
    !existsSync(join(ctx.tmp, "evil.mdx")),
    "no file written outside the project dir"
  );
});

test("project creation rejects invalid slugs", async () => {
  for (const bad of ["../x", "Bad Name", "", "проект"]) {
    const r = await ctx.api.post("/api/projects", { name: bad });
    assert.equal(
      r.status,
      400,
      `name ${JSON.stringify(bad)} must be 400, got ${r.status}`
    );
  }
});

test("generate endpoint validates project name", async () => {
  const r = await ctx.api.post("/api/projects/..%2Fsecret/generate", {});
  assert.equal(r.status, 400);
});

// ─── Secret handling ───────────────────────────────────────────

test("API key is masked in settings responses", async () => {
  const s = await ctx.api.get("/api/settings");
  assert.equal(s.creaAiKey, "***1234");
  assert.equal(s.hasKey, true);
  assert.ok(
    !JSON.stringify(s).includes("test-key-1234"),
    "full key must never be exposed"
  );
});

test("masked key is not written back on settings save", async () => {
  await ctx.api.post("/api/settings", {
    creaAiKey: "***1234",
    defaultModel: "mock-model",
  });
  const s = await ctx.api.get("/api/settings");
  assert.equal(
    s.creaAiKey,
    "***1234",
    "masked placeholder must not overwrite the real key"
  );
});
