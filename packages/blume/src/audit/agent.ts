import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { join } from "pathe";

import { reportJson } from "./report.ts";
import type { AuditResult } from "./run.ts";

/** A coding agent CLI the audit can hand its findings to (`--claude`, `--codex`). */
export interface AgentCli {
  /** The executable to look up on PATH. */
  bin: string;
  /** How to install it, shown when the executable is missing. */
  install: string;
  /** Display name for messages. */
  name: string;
}

export type AgentKind = "claude" | "codex";

export const AGENTS: Record<AgentKind, AgentCli> = {
  claude: {
    bin: "claude",
    install: "npm install -g @anthropic-ai/claude-code",
    name: "Claude Code",
  },
  codex: {
    bin: "codex",
    install: "npm install -g @openai/codex",
    name: "Codex",
  },
};

/**
 * Write the full JSON report where the agent can read it. A file rather than
 * inline prompt text: a large site's report can exceed the platform's argv
 * limit, and the JSON already carries every finding untruncated — the terminal
 * report previews three pages per check, the file never does.
 */
export const writeAgentReport = async (
  result: AuditResult,
  root: string
): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "blume-audit-"));
  const path = join(dir, "report.json");
  await writeFile(path, reportJson(result, root));
  return path;
};

/** The handoff prompt: where the report is, how to read it, and the ground rules. */
export const fixPrompt = (reportPath: string): string =>
  `Fix the issues found by \`bedocs audit\` in this project.

The full audit report is at ${reportPath}. It is JSON: each entry in \`diagnostics\` is one finding, with the check \`code\`, a \`message\` explaining what is wrong, the affected page \`url\`, the source \`file\` to edit (relative to the current directory, with a \`line\` when the finding points at a specific front matter key), and a \`suggestion\` describing the fix.

Work through every finding:
1. Read the report and group the findings by \`file\`.
2. Apply each finding's \`suggestion\` by editing the named source file — most fixes are front matter edits at the cited line.
3. Never fix a finding by deleting a page, removing content, or hiding it from the audit; if a finding genuinely needs a human decision, leave it and say so in your summary.

When you are done, run \`bedocs build\` and then \`bedocs audit\` to verify, and repeat until the audit reports no issues.`;

const spawnAgent = (
  command: string,
  args: string[],
  shell: boolean
): Promise<number> =>
  // oxlint-disable-next-line promise/avoid-new -- adapt spawn's event callbacks
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });

/**
 * cmd.exe reports a missing executable through this exit code instead of a
 * spawn error, so a shell launch can't rely on the `error` event for the
 * "not installed" diagnosis.
 */
export const WINDOWS_COMMAND_NOT_FOUND = 9009;

/**
 * Run the agent CLI interactively with the handoff prompt, inheriting the
 * terminal so the user watches and steers the fixes rather than granting a
 * headless process blanket write access. Resolves with the agent's exit code;
 * rejects when the executable isn't on PATH.
 *
 * On Windows, npm installs agent CLIs as `.cmd` shims, which Node refuses to
 * spawn without a shell — and cmd.exe cannot carry the multi-line prompt as an
 * argument (a newline ends the command). So there the prompt is written to a
 * file next to the report and handed over via a one-line pointer that survives
 * cmd.exe quoting; a missing executable surfaces as
 * {@link WINDOWS_COMMAND_NOT_FOUND} rather than a rejection.
 */
export const launchAgent = async (
  bin: string,
  prompt: string,
  platform: NodeJS.Platform = process.platform
): Promise<number> => {
  if (platform !== "win32") {
    return await spawnAgent(bin, [prompt], false);
  }
  const dir = await mkdtemp(join(tmpdir(), "blume-audit-"));
  const promptPath = join(dir, "prompt.md");
  await writeFile(promptPath, prompt);
  // Double quotes are the one grouping cmd.exe respects; neither the temp
  // path nor the fixed pointer text can contain one.
  return await spawnAgent(
    `"${bin}" "Read ${promptPath} and follow its instructions exactly."`,
    [],
    true
  );
};
