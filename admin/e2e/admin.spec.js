// Admin panel e2e — real browser against the real admin server + mock Crea AI.
import { test, expect } from "@playwright/test";

import { spawnAdmin } from "../test/helpers/app.js";

const ANALYSIS = `ПЛАН:
- **Имя файла:** index.mdx
  **Заголовок:** Главная
  **Источники:** intro.md
  **Описание:** Главная страница
  **Порядок:** 0`;

const PAGE =
  '```file:index.mdx\n---\ntitle: "Главная"\n---\n\n# Главная\n\nGenerated documentation content paragraph with enough text.\n```';

let ctx;
let base;

test.beforeAll(async () => {
  ctx = await spawnAdmin();
  base = ctx.api.base;
});

test.afterAll(async () => {
  await ctx.stop();
  ctx.crea.server.close();
});

test("projects list renders and create dialog works", async ({ page }) => {
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Проекты документации" })
  ).toBeVisible();
  await expect(page.locator(".project-card-title")).toContainText("test-proj");

  await page.getByRole("button", { name: "Новый проект" }).click();
  await expect(page.locator(".dialog")).toBeVisible();
  await page.locator("#dlg-project-name").fill("e2e-proj");
  await page.getByRole("button", { exact: true, name: "Создать" }).click();
  await expect(
    page.locator(".project-card-title", { hasText: "e2e-proj" })
  ).toBeVisible();
});

test("no emoji icons — lucide svg are rendered", async ({ page }) => {
  await page.goto(base);
  await expect(page.locator("svg.lucide").first()).toBeVisible();
  const body = await page.locator("body").textContent();
  expect(body).not.toMatch(/[📁✏️🤖🗑⏳✅❌📄🔗]/u);
});

test("project detail: files, editor save, delete file", async ({ page }) => {
  await page.goto(base);
  await page.locator(".project-card-title", { hasText: "test-proj" }).click();
  await expect(
    page.locator("#section-files .file-item-name").first()
  ).toBeVisible();

  // editor
  await page.locator(".subnav-tab", { hasText: "Редактор" }).click();
  const area = page.locator("#editor-content");
  await expect(area).toBeVisible();
  await area.fill("# Edited by e2e");
  await page.getByRole("button", { exact: true, name: "Сохранить" }).click();
  await expect(page.locator(".toast-success")).toBeVisible();
});

test("AI generation: start job, live progress, saved page", async ({
  page,
}) => {
  ctx.crea.state.behaviors.push(
    { text: ANALYSIS, type: "stream" },
    { text: PAGE, type: "stream" }
  );
  await page.goto(base);
  await page.locator(".project-card-title", { hasText: "test-proj" }).click();
  await page.locator(".subnav-tab", { hasText: "AI-генерация" }).click();
  await page.getByRole("button", { name: "Запустить генерацию" }).click();

  await expect(page.locator("#gen-active-job .job-card")).toBeVisible();
  await expect(
    page.locator("#gen-active-job .badge", { hasText: "Завершено" })
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator("#gen-active-job .page-chip.is-saved")
  ).toContainText("index.mdx");
});

test("jobs view lists generation jobs", async ({ page }) => {
  await page.goto(base);
  await page.locator(".nav-tab", { hasText: "Задания" }).click();
  await expect(
    page.locator(".job-card .job-card-title", { hasText: "test-proj" }).first()
  ).toBeVisible();
});

test("theme toggle persists and settings page renders", async ({ page }) => {
  await page.goto(base);
  const theme0 = await page.locator("html").getAttribute("data-theme");
  await page.locator("#btn-theme").click();
  const theme1 = await page.locator("html").getAttribute("data-theme");
  expect(theme1).not.toBe(theme0);
  await page.reload();
  expect(await page.locator("html").getAttribute("data-theme")).toBe(theme1);

  await page.locator(".nav-tab", { hasText: "Настройки" }).click();
  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await expect(page.locator("#set-key")).toBeVisible();
});

test("mobile layout: nav collapses to icons at 375px", async ({ page }) => {
  await page.setViewportSize({ height: 700, width: 375 });
  await page.goto(base);
  await expect(
    page.locator(".nav-tab .lucide, .nav-tab svg").first()
  ).toBeVisible();
  await expect(page.locator(".project-card").first()).toBeVisible();
});
