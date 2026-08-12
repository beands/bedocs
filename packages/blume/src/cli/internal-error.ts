import { colors } from "consola/utils";

import { getBlumeVersion } from "../core/version.ts";

const ISSUES_URL = "https://github.com/beandsmedia/bedocs/issues";

// Absolute paths into the hidden generated runtime — POSIX (`…/.bedocs/…`) or
// Windows drive-letter (`C:\…\.bedocs\…`) — including any trailing `:line:col`,
// stopping at whitespace or a closing paren.
const BEDOCS_FRAME =
  /(?<abs>(?:\/[^\s()]*\/|[A-Za-z]:\\[^\s()]*\\)\.bedocs[/\\][^\s()]*)/gu;

// The separator immediately before `.bedocs/` (or `.bedocs\`) in a matched path.
const BEDOCS_MARKER = /[/\\]\.bedocs[/\\]/u;

/**
 * Rewrite `.bedocs/` frames in a stack so the generated runtime reads clearly:
 * the machine-absolute prefix is dropped to a project-relative `.bedocs/…` path
 * and tagged `(generated)`, keeping the reader oriented instead of staring at a
 * long path into a hidden directory. Frames in the user's own source (custom
 * pages keep their real location; wrappers import user files by their real path)
 * are untouched, so the actionable frame stays intact.
 */
export const remapBlumeStack = (stack: string): string =>
  stack.replaceAll(BEDOCS_FRAME, (match) => {
    const marker = match.search(BEDOCS_MARKER);
    return `${match.slice(marker + 1)} (generated)`;
  });

/**
 * Print an unexpected (non-{@link BlumeError}) failure in a stable, reportable
 * shape instead of a bare stack trace: a fixed `BLUME_INTERNAL` code, the
 * message, a trimmed stack, and an environment dump for bug reports. Callers
 * exit after this — it doesn't exit itself, so it's testable.
 */
export const reportInternalError = (error: unknown): void => {
  const err = error instanceof Error ? error : new Error(String(error));
  const lines = [
    `${colors.red(colors.bold("BLUME_INTERNAL"))} An unexpected error occurred.`,
    `  ${err.message}`,
  ];

  // A few frames are enough to locate the fault without burying the report;
  // `.bedocs/` frames are relativized so the hidden runtime reads clearly.
  const stack = remapBlumeStack(err.stack ?? "")
    .split("\n")
    .slice(1, 5)
    .map((line) => line.trim())
    .filter(Boolean);
  if (stack.length > 0) {
    lines.push("", colors.dim(stack.join("\n")));
  }

  lines.push(
    "",
    "This is likely a bug in BeDocs. Please report it with the details below:",
    colors.dim(
      [
        `  BeDocs:   ${getBlumeVersion()}`,
        `  Node:     ${process.version}`,
        `  Platform: ${process.platform} ${process.arch}`,
      ].join("\n")
    ),
    `  ${ISSUES_URL}`
  );

  process.stderr.write(`${lines.join("\n")}\n`);
};
