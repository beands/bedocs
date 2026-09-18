import { spawn } from "node:child_process";

import {
  DOCS_ROOT,
  BUN_BIN,
  BUILD_CMD,
  BUILD_TIMEOUT_MS,
  PM2_APP,
} from "./config.js";

// Rebuild the docs site. BUILD_CMD overrides the default bun invocation
// (used by tests and local dev where the production bun path is absent).
// BUILD_CMD=skip short-circuits the build entirely.
export function runBuild() {
  if (BUILD_CMD === "skip") {
    return Promise.resolve({
      output: "build skipped",
      skipped: true,
      success: true,
    });
  }
  const cmd = BUILD_CMD
    ? BUILD_CMD.split(" ").filter(Boolean)
    : [BUN_BIN, "run", "build", "--", "--no-strict"];
  return new Promise((resolve) => {
    let buildProcess;
    try {
      buildProcess = spawn(cmd[0], cmd.slice(1), {
        cwd: DOCS_ROOT,
        env: {
          ...process.env,
          PATH: `/home/beands/projects/node_modules/.bin:${process.env.PATH}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      return resolve({ success: false, error: error.message, output: "" });
    }
    let output = "";
    buildProcess.stdout.on("data", (d) => (output += d.toString()));
    buildProcess.stderr.on("data", (d) => (output += d.toString()));
    buildProcess.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        error: `Не удалось запустить сборку: ${err.message}`,
        output: output.slice(-1000),
        success: false,
      });
    });
    const timeout = setTimeout(() => {
      buildProcess.kill();
      resolve({
        error: "Таймаут сборки",
        output: output.slice(-500),
        success: false,
      });
    }, BUILD_TIMEOUT_MS);
    buildProcess.on("close", (code) => {
      clearTimeout(timeout);
      if (PM2_APP) {
        spawn("pm2", ["restart", PM2_APP, "--update-env"], {
          stdio: "ignore",
        }).on("error", () => {});
      }
      if (code === 0) {
        resolve({ success: true, output: output.slice(-500) });
      } else {
        resolve({
          success: false,
          error: "Сборка завершилась с ошибкой",
          output: output.slice(-1000),
        });
      }
    });
  });
}
