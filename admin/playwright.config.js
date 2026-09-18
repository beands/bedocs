import { defineConfig } from "@playwright/test";

// The admin server and the mock Crea AI are spawned by the spec itself
// (helpers/app.js), so no webServer block is needed here.
export default defineConfig({
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  reporter: [["list"]],
  retries: 0,
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  workers: 1, // specs share spawned servers' temp dirs — run serially,
});
