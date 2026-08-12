import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { join } from "pathe";

import {
  EvalsFileError,
  loadEvalsFile,
  locateQuestion,
} from "../src/eval/schema.ts";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

const evalsFixture = async (content: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "blume-eval-schema-"));
  dirs.push(dir);
  const path = join(dir, "evals.yaml");
  await writeFile(path, content);
  return path;
};

const FULL = `version: 1
questions:
  - id: install-node-version
    question: What is the minimum Node.js version required?
    expected:
      - Node 22.12 or newer
    routes: /guides/install
  - id: deploy-vercel
    question: How do I deploy to Vercel?
    expected:
      - run blume build
      - the output directory is dist
    routes:
      - /guides/deploy
      - /guides/install
    severity: warning
    skip: true
`;

describe("loadEvalsFile", () => {
  it("parses the full form and applies defaults", async () => {
    const path = await evalsFixture(FULL);
    const { evals, raw } = await loadEvalsFile(path);
    expect(evals.version).toBe(1);
    expect(evals.questions).toHaveLength(2);

    const [first, second] = evals.questions;
    expect(first?.id).toBe("install-node-version");
    // A scalar `routes` is normalized to a list.
    expect(first?.routes).toEqual(["/guides/install"]);
    expect(first?.severity).toBe("error");
    expect(first?.skip).toBe(false);

    expect(second?.routes).toEqual(["/guides/deploy", "/guides/install"]);
    expect(second?.severity).toBe("warning");
    expect(second?.skip).toBe(true);

    expect(raw).toBe(FULL);
  });

  it("accepts a bare top-level list as shorthand", async () => {
    const path = await evalsFixture(
      `- id: quick
  question: Does the shorthand work?
  expected:
    - yes it does
`
    );
    const { evals } = await loadEvalsFile(path);
    expect(evals.version).toBe(1);
    expect(evals.questions[0]?.id).toBe("quick");
  });

  it("rejects a missing file with an init hint", async () => {
    const missing = join(tmpdir(), "blume-eval-nowhere", "evals.yaml");
    await expect(loadEvalsFile(missing)).rejects.toThrow("bedocs eval init");
  });

  it("rejects malformed YAML", async () => {
    const path = await evalsFixture("questions:\n  - id: [unclosed\n");
    await expect(loadEvalsFile(path)).rejects.toThrow("Invalid YAML");
  });

  it("rejects duplicate question ids", async () => {
    const path = await evalsFixture(
      `- id: twice
  question: First?
  expected: [a]
- id: twice
  question: Second?
  expected: [b]
`
    );
    await expect(loadEvalsFile(path)).rejects.toThrow(
      'duplicate question id "twice"'
    );
  });

  it("rejects a question with no expected facts", async () => {
    const path = await evalsFixture(
      `- id: empty
  question: Anything?
  expected: []
`
    );
    await expect(loadEvalsFile(path)).rejects.toThrow("at least one fact");
  });

  it("rejects a non-kebab-case id", async () => {
    const path = await evalsFixture(
      `- id: Not A Slug
  question: Anything?
  expected: [a]
`
    );
    await expect(loadEvalsFile(path)).rejects.toThrow("kebab-case");
  });

  it("rejects unknown keys", async () => {
    const path = await evalsFixture(
      `- id: extra
  question: Anything?
  expected: [a]
  answers: [b]
`
    );
    await expect(loadEvalsFile(path)).rejects.toThrow(EvalsFileError);
  });
});

describe("locateQuestion", () => {
  it("finds the 1-based line of a question's id entry", () => {
    expect(locateQuestion(FULL, "install-node-version")).toBe(3);
    expect(locateQuestion(FULL, "deploy-vercel")).toBe(8);
  });

  it("matches quoted ids and returns undefined for unknown ids", () => {
    const raw = `questions:\n  - id: "quoted-id"\n    question: Hm?\n`;
    expect(locateQuestion(raw, "quoted-id")).toBe(2);
    expect(locateQuestion(raw, "absent")).toBeUndefined();
  });
});
