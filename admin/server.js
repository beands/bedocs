import express from "express";
import multer from "multer";
import cors from "cors";
import { readdir, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(__dirname, "..", "apps", "docs");
const CONTENT_DIR = join(DOCS_ROOT, "content");
const PROJECTS_DIR = join(CONTENT_DIR, "projects");
const SETTINGS_FILE = join(__dirname, "settings.json");
const CREA_AI_BASE = "https://crea-ai.ru/v1";
const CONFIG_FILE = join(DOCS_ROOT, "bedocs.config.ts");

const app = express();
const PORT = process.env.ADMIN_PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(join(__dirname, "public")));

// ─── Settings ──────────────────────────────────────────────────

async function readSettings() {
  try {
    return JSON.parse(await readFile(SETTINGS_FILE, "utf-8"));
  } catch {
    return { creaAiKey: "", defaultModel: "gpt-4o" };
  }
}

async function writeSettings(settings) {
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

app.get("/api/settings", async (req, res) => {
  const s = await readSettings();
  res.json({
    creaAiKey: s.creaAiKey ? "***" + s.creaAiKey.slice(-4) : "",
    hasKey: Boolean(s.creaAiKey),
    defaultModel: s.defaultModel || "gpt-4o",
  });
});

app.post("/api/settings", async (req, res) => {
  try {
    const { creaAiKey, defaultModel } = req.body;
    const s = await readSettings();
    if (creaAiKey !== undefined && !creaAiKey.startsWith("***")) s.creaAiKey = creaAiKey;
    if (defaultModel) s.defaultModel = defaultModel;
    await writeSettings(s);
    res.json({ success: true, creaAiKey: s.creaAiKey ? "***" + s.creaAiKey.slice(-4) : "", hasKey: Boolean(s.creaAiKey) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Projects API ──────────────────────────────────────────────

app.get("/api/projects", async (req, res) => {
  try {
    if (!existsSync(PROJECTS_DIR)) {
      await mkdir(PROJECTS_DIR, { recursive: true });
      return res.json({ projects: [] });
    }
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = join(PROJECTS_DIR, entry.name);
      const files = await listMdxFiles(projectPath);
      const stats = await stat(projectPath);
      projects.push({
        name: entry.name, slug: entry.name, files: files.length,
        fileNames: files, created: stats.birthtime, modified: stats.mtime,
        url: `/projects/${entry.name}`,
      });
    }
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:name", async (req, res) => {
  try {
    const projectPath = join(PROJECTS_DIR, req.params.name);
    if (!existsSync(projectPath)) return res.status(404).json({ error: "Проект не найден" });
    const files = await listMdxFiles(projectPath);
    const fileContents = {};
    for (const file of files) fileContents[file] = await readFile(join(projectPath, file), "utf-8");
    res.json({ name: req.params.name, files, fileContents, url: `/projects/${req.params.name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.match(/^[a-z0-9-]+$/)) {
      return res.status(400).json({ error: "Имя проекта: только строчные буквы, цифры и дефисы" });
    }
    const projectPath = join(PROJECTS_DIR, name);
    if (existsSync(projectPath)) return res.status(409).json({ error: "Проект уже существует" });
    await mkdir(projectPath, { recursive: true });
    const title = name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const indexContent = `---\ntitle: ${title}\ndescription: ${description || `Документация проекта ${title}.`}\nsidebar:\n  label: ${title}\n  order: 0\n---\n\n# ${title}\n\n${description || `Документация проекта **${title}**.`}\n\nЗагрузите Markdown файлы через панель управления или используйте AI-генерацию для создания структурированной документации.\n`;
    await writeFile(join(projectPath, "index.mdx"), indexContent);
    await updateConfigNavigation();
    res.json({ success: true, name, url: `/projects/${name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:name", async (req, res) => {
  try {
    const projectPath = join(PROJECTS_DIR, req.params.name);
    if (!existsSync(projectPath)) return res.status(404).json({ error: "Проект не найден" });
    await rm(projectPath, { recursive: true });
    await updateConfigNavigation();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── File Upload API ───────────────────────────────────────────

app.post("/api/projects/:name/upload", upload.array("files", 50), async (req, res) => {
  try {
    const projectPath = join(PROJECTS_DIR, req.params.name);
    if (!existsSync(projectPath)) return res.status(404).json({ error: "Проект не найден" });
    const uploaded = [];
    for (const file of req.files || []) {
      if (!file.originalname.match(/\.(md|mdx)$/)) continue;
      await writeFile(join(projectPath, file.originalname), file.buffer);
      uploaded.push(file.originalname);
    }
    res.json({ success: true, uploaded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload + process (convert MD to MDX with frontmatter) + rebuild
app.post("/api/projects/:name/upload-and-process", upload.array("files", 50), async (req, res) => {
  try {
    const projectPath = join(PROJECTS_DIR, req.params.name);
    if (!existsSync(projectPath)) return res.status(404).json({ error: "Проект не найден" });

    const uploaded = [];
    const processed = [];

    for (const file of req.files || []) {
      if (!file.originalname.match(/\.(md|mdx)$/)) continue;
      const rawContent = file.buffer.toString("utf-8");
      const baseName = file.originalname.replace(/\.(md|mdx)$/, "");

      // Convert .md to .mdx with frontmatter
      let mdxContent;
      if (rawContent.trimStart().startsWith("---")) {
        // Already has frontmatter — keep as is, just rename to .mdx
        mdxContent = rawContent;
      } else {
        // Extract first heading as title
        const titleMatch = rawContent.match(/^#\s+(.+)$/m);
        const rawTitle = titleMatch ? titleMatch[1].trim() : baseName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const title = rawTitle.replace(/"/g, '\\"');
        const rawDesc = rawContent.slice(0, 160).replace(/[#*`\n\r]/g, " ").trim();
        const description = rawDesc.replace(/"/g, '\\"');
        const order = uploaded.length;
        mdxContent = `---\ntitle: "${title}"\ndescription: "${description}"\nsidebar:\n  label: "${title}"\n  order: ${order}\n---\n\n${rawContent}`;
      }

      const mdxName = baseName + ".mdx";
      await writeFile(join(projectPath, mdxName), mdxContent, "utf-8");

      // Remove old .md if exists and name differs
      if (file.originalname !== mdxName && existsSync(join(projectPath, file.originalname))) {
        await rm(join(projectPath, file.originalname)).catch(() => {});
      }

      uploaded.push(mdxName);
      processed.push({ from: file.originalname, to: mdxName });
    }

    if (uploaded.length === 0) {
      return res.status(400).json({ error: "Нет .md или .mdx файлов" });
    }

    // Auto-rebuild
    const buildResult = await runBuild();

    res.json({
      success: true,
      uploaded,
      processed,
      rebuild: buildResult,
      message: `Загружено ${uploaded.length} файл(ов), сайт пересобран`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:name/files", async (req, res) => {
  try {
    const projectPath = join(PROJECTS_DIR, req.params.name);
    if (!existsSync(projectPath)) return res.status(404).json({ error: "Проект не найден" });
    const { fileName, content } = req.body;
    if (!fileName || content === undefined) return res.status(400).json({ error: "Требуются fileName и content" });
    await writeFile(join(projectPath, fileName), content, "utf-8");
    res.json({ success: true, fileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:name/files/:filename", async (req, res) => {
  try {
    const filePath = join(PROJECTS_DIR, req.params.name, req.params.filename);
    if (!existsSync(filePath)) return res.status(404).json({ error: "Файл не найден" });
    await rm(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Build API ─────────────────────────────────────────────────

function runBuild() {
  return new Promise((resolve) => {
    const buildProcess = spawn("/home/beands/.bun/bin/bun", ["run", "build", "--", "--no-strict"], {
      cwd: DOCS_ROOT,
      env: { ...process.env, PATH: `/home/beands/projects/node_modules/.bin:${process.env.PATH}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    buildProcess.stdout.on("data", (d) => (output += d.toString()));
    buildProcess.stderr.on("data", (d) => (output += d.toString()));
    const timeout = setTimeout(() => {
      buildProcess.kill();
      resolve({ success: false, error: "Таймаут сборки", output: output.slice(-500) });
    }, 300000);
    buildProcess.on("close", (code) => {
      clearTimeout(timeout);
      spawn("pm2", ["restart", "bedocs", "--update-env"], { stdio: "ignore" });
      if (code === 0) resolve({ success: true, output: output.slice(-500) });
      else resolve({ success: false, error: "Сборка завершилась с ошибкой", output: output.slice(-1000) });
    });
  });
}

app.post("/api/rebuild", async (req, res) => {
  try {
    const result = await runBuild();
    if (result.success) res.json(result);
    else res.status(500).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Generation via Crea-AI (staged) ─────────────────────────

app.post("/api/projects/:name/generate", async (req, res) => {
  try {
    const projectPath = join(PROJECTS_DIR, req.params.name);
    if (!existsSync(projectPath)) return res.status(404).json({ error: "Проект не найден" });
    const settings = await readSettings();
    if (!settings.creaAiKey) return res.status(400).json({ error: "API-ключ crea-ai не настроен. Добавьте ключ в настройках." });
    const { instructions, model, selectedFiles } = req.body;
    const allFiles = await listMdxFiles(projectPath);
    if (allFiles.length === 0) return res.status(400).json({ error: "В проекте нет файлов. Сначала загрузите Markdown файлы." });

    // Use selected files or all files
    const filesToProcess = selectedFiles && selectedFiles.length > 0
      ? allFiles.filter(f => selectedFiles.includes(f))
      : allFiles;

    if (filesToProcess.length === 0) return res.status(400).json({ error: "Не выбраны файлы для обработки." });

    const fileContents = {};
    for (const file of filesToProcess) fileContents[file] = await readFile(join(projectPath, file), "utf-8");
    const aiModel = model || settings.defaultModel || "gemini-2-5-flash";

    const stages = [];

    // Stage 1: Analyze ALL content and create a documentation plan
    stages.push({ stage: 1, name: `Анализ ${filesToProcess.length} файлов и создание плана`, status: "processing" });
    const analyzePrompt = buildAnalyzePrompt(req.params.name, fileContents, instructions);
    const analyzeResponse = await callCreaAi(settings.creaAiKey, aiModel, [
      { role: "system", content: "Ты — архитектор документации. Проанализируй ВСЕ файлы и создай детальный план документации проекта. План должен описывать каждую страницу: имя файла, заголовок, какие исходные файлы использовать, краткое содержание, порядок в sidebar, связи с другими страницами." },
      { role: "user", content: analyzePrompt },
    ], 8000);
    const analysis = analyzeResponse.choices?.[0]?.message?.content || "";
    stages[0].status = "done";
    stages[0].detail = analysis.slice(0, 600);

    // Parse plan from analysis — extract page list
    const planPages = parsePlanPages(analysis, filesToProcess);

    if (planPages.length === 0) {
      // Fallback: process each file individually
      for (const f of filesToProcess) {
        planPages.push({ fileName: f, title: f.replace(/\.mdx?$/, ""), sources: [f], description: "" });
      }
    }

    // Stage 2: Generate each page according to the plan
    const allGenerated = {};
    for (let i = 0; i < planPages.length; i++) {
      const page = planPages[i];
      const stageNum = 2 + i;
      stages.push({
        stage: stageNum,
        name: `Генерация ${i + 1}/${planPages.length}: ${page.fileName}`,
        status: "processing",
        detail: page.title + (page.sources.length > 0 ? ` (из: ${page.sources.join(", ")})` : ""),
      });

      // Gather source content for this page
      const sourceContents = {};
      for (const src of page.sources) {
        if (fileContents[src]) sourceContents[src] = fileContents[src];
      }
      // If no specific sources, use all files as context
      if (Object.keys(sourceContents).length === 0) {
        Object.assign(sourceContents, fileContents);
      }

      const genPrompt = buildPagePrompt(req.params.name, page, sourceContents, planPages, instructions, analysis);
      const genResponse = await callCreaAi(settings.creaAiKey, aiModel, [
        { role: "system", content: "Ты — технический писатель, создающий качественную документацию в формате MDX на русском языке. Используй frontmatter (title, description, sidebar label, order), компоненты BeDocs: <Card>, <CardGroup>, <Steps>, <Step>, :::tip, :::note. Сохраняй ВСЮ техническую информацию, примеры кода, API. Не выдумывай факты — используй только данные из исходных файлов. Создавай связную документацию со ссылками на другие страницы." },
        { role: "user", content: genPrompt },
      ], 16000);
      const genText = genResponse.choices?.[0]?.message?.content || "";
      const parsed = parseGeneratedFiles(genText);

      if (Object.keys(parsed).length > 0) {
        Object.assign(allGenerated, parsed);
        stages[stages.length - 1].status = "done";
        stages[stages.length - 1].generated = Object.keys(parsed);
      } else {
        // If AI didn't return file format, save as the planned filename
        const plannedName = page.fileName.endsWith(".mdx") ? page.fileName : page.fileName + ".mdx";
        const cleanContent = genText.replace(/^```(?:mdx?)?\n?/m, "").replace(/```$/m, "").trim();
        if (cleanContent.length > 100) {
          allGenerated[plannedName] = cleanContent;
          stages[stages.length - 1].status = "done";
          stages[stages.length - 1].generated = [plannedName];
        } else {
          stages[stages.length - 1].status = "error";
          stages[stages.length - 1].detail = "AI вернул пустой ответ";
        }
      }
    }

    // Stage 3: Write files
    const written = [];
    for (const [fileName, content] of Object.entries(allGenerated)) {
      await writeFile(join(projectPath, fileName), content, "utf-8");
      written.push(fileName);
    }
    stages.push({ stage: stages.length + 1, name: `Сохранение (${written.length} файлов)`, status: "done", files: written });

    // Stage 4: Auto-rebuild
    const buildResult = await runBuild();
    stages.push({ stage: stages.length + 1, name: "Пересборка сайта", status: buildResult.success ? "done" : "error", detail: buildResult.output?.slice(0, 300) });

    res.json({
      success: true,
      model: aiModel,
      stages,
      filesWritten: written,
      filesProcessed: filesToProcess,
      plan: planPages,
      analysis: analysis.slice(0, 2000),
      message: `AI создал ${written.length} страниц документации по плану из ${filesToProcess.length} исходных файлов. Сайт пересобран.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function callCreaAi(apiKey, model, messages, maxTokens) {
  const response = await fetch(`${CREA_AI_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: maxTokens || 8000 }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Crea-AI API вернул ошибку ${response.status}: ${errText.slice(0, 300)}`);
  }
  const data = await response.json();

  // Direct chat.completion response
  if (data.choices && data.choices[0]) return data;

  // Async job response — poll status_url until succeeded
  if (data.status === "queued" && data.status_url) {
    const jobId = data.id;
    const statusUrl = `${CREA_AI_BASE.replace("/v1", "")}${data.status_url}`;
    const maxPolls = 120; // 120 * 3s = 6 min max
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!pollRes.ok) {
        const errText = await pollRes.text();
        throw new Error(`Crea-AI poll error ${pollRes.status}: ${errText.slice(0, 300)}`);
      }
      const pollData = await pollRes.json();
      if (pollData.status === "succeeded" && pollData.result) {
        return pollData.result;
      }
      if (pollData.status === "failed") {
        throw new Error(`Crea-AI job failed: ${pollData.error || "unknown"}`);
      }
      // Continue polling if queued or running
    }
    throw new Error("Crea-AI job timeout (6 min)");
  }

  throw new Error("Crea-AI unexpected response: " + JSON.stringify(data).slice(0, 300));
}

function buildAnalyzePrompt(projectName, files, instructions) {
  const fileList = Object.keys(files).map((name) => `- ${name} (${files[name].length} симв.)`).join("\n");
  // RAG: send full content of all files (truncated to 3000 chars each to fit context)
  const fullContent = Object.entries(files).map(([name, content]) => {
    const truncated = content.length > 3000 ? content.slice(0, 3000) + "\n... [обрезано]" : content;
    return `### Файл: ${name}\n\n${truncated}`;
  }).join("\n\n---\n\n");
  return `Проект: ${projectName}\n\nСписок файлов:\n${fileList}\n\nПолное содержимое файлов:\n${fullContent}\n\nИнструкции: ${instructions || "Создать полноценную структурированную документацию проекта"}\n\nПроанализируй ВСЕ файлы и создай ПЛАН документации в следующем формате:\n\nДля каждой страницы укажи:\n- **Имя файла:** filename.mdx\n- **Заголовок:** Русский заголовок страницы\n- **Источники:** какие исходные файлы использовать\n- **Описание:** краткое содержание (1-2 предложения)\n- **Порядок:** число для sidebar order\n- **Связи:** на какие другие страницы ссылается\n\nСоздай от 5 до 15 страниц. Объедини связанные файлы в одну страницу где уместно. Создай страницу index.mdx как главную страницу проекта.\n\nНачни план со строки "ПЛАН:" и затем перечисли каждую страницу.`;
}

function parsePlanPages(analysis, availableFiles) {
  const pages = [];
  // Try to parse structured plan from AI response
  const planMatch = analysis.match(/ПЛАН:([\s\S]*?)$/i);
  const planText = planMatch ? planMatch[1] : analysis;

  // Match patterns like "**Имя файла:** xxx.mdx" followed by other fields
  const pageRegex = /\*\*Имя файла:\*\*\s*(\S+\.mdx?)[\s\S]*?(?=\*\*Имя файла:\*\*|$)/gi;
  let match;
  while ((match = pageRegex.exec(planText)) !== null) {
    const block = match[0];
    const fileName = match[1];
    const titleMatch = block.match(/\*\*Заголовок:\*\*\s*(.+)/i);
    const sourcesMatch = block.match(/\*\*Источники:\*\*\s*(.+)/i);
    const descMatch = block.match(/\*\*Описание:\*\*\s*(.+)/i);
    const orderMatch = block.match(/\*\*Порядок:\*\*\s*(\d+)/i);

    const title = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.mdx?$/, "").replace(/[-_]/g, " ");
    const sourcesRaw = sourcesMatch ? sourcesMatch[1].trim() : "";
    const sources = sourcesRaw
      .split(/[,;]\s*/)
      .map(s => s.trim().replace(/^["']|["']$/g, ""))
      .filter(s => availableFiles.includes(s) || availableFiles.some(f => f.includes(s)));
    const description = descMatch ? descMatch[1].trim() : "";
    const order = orderMatch ? parseInt(orderMatch[1]) : pages.length;

    pages.push({ fileName, title, sources, description, order });
  }

  // Sort by order
  pages.sort((a, b) => a.order - b.order);
  return pages;
}

function buildPagePrompt(projectName, page, sourceContents, allPages, instructions, analysis) {
  const sourceList = Object.keys(sourceContents).map(name => `- ${name}`).join("\n");
  const fullSources = Object.entries(sourceContents).map(([name, content]) => {
    const truncated = content.length > 6000 ? content.slice(0, 6000) + "\n... [обрезано]" : content;
    return `### Файл: ${name}\n\n${truncated}`;
  }).join("\n\n---\n\n");

  const otherPages = allPages
    .filter(p => p.fileName !== page.fileName)
    .map(p => `- ${p.fileName}: ${p.title}`)
    .join("\n");

  return `Проект: ${projectName}\n\nПлан документации:\n${analysis.slice(0, 2000)}\n\n---\n\nСоздаётся страница:\n- **Имя файла:** ${page.fileName}\n- **Заголовок:** ${page.title}\n- **Описание:** ${page.description}\n\nИсходные файлы для этой страницы:\n${sourceList}\n\nПолное содержимое исходных файлов:\n${fullSources}\n\nДругие страницы документации (для ссылок):\n${otherPages}\n\nИнструкции: ${instructions || "Создай качественную структурированную документацию"}\n\nЗадача:\n1. Создай MDX файл с frontmatter: title, description, sidebar (label, order ${page.order})\n2. Используй компоненты BeDocs: <Card>, <CardGroup>, <Steps>, <Step>, :::tip, :::note\n3. Пиши на русском языке\n4. Сохраняй ВСЮ техническую информацию: примеры кода, API, конфигурации\n5. Не выдумывай факты — только данные из исходных файлов\n6. Добавляй ссылки на другие страницы: [Текст](/projects/${projectName}/page-name)\n7. Структурируй контент с заголовками ##, ###\n\nВерни результат в формате:\n\`\`\`file:${page.fileName}\n---\ntitle: "${page.title}"\ndescription: "${page.description}"\nsidebar:\n  label: "${page.title}"\n  order: ${page.order}\n---\n\n[содержимое страницы]\n\`\`\``;
}

// ─── Models list from crea-ai ──────────────────────────────────

app.get("/api/models", async (req, res) => {
  try {
    const settings = await readSettings();
    if (!settings.creaAiKey) return res.json({ models: [] });
    const response = await fetch(`${CREA_AI_BASE}/models`, { headers: { Authorization: `Bearer ${settings.creaAiKey}` } });
    if (!response.ok) return res.status(502).json({ error: "Не удалось получить список моделей" });
    const data = await response.json();
    const models = (data.data || []).map((m) => ({ id: m.id, name: m.id }));
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helpers ───────────────────────────────────────────────────

async function updateConfigNavigation() {
  try {
    if (!existsSync(PROJECTS_DIR)) return;
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    const projectNames = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    let config = await readFile(CONFIG_FILE, "utf-8");
    const tabs = [];
    for (const name of projectNames) {
      const title = name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      tabs.push(`      { label: "${title}", path: "/projects/${name}" },`);
    }
    tabs.push(`      {
        label: {
          de: "Änderungen",
          en: "Changelog",
          hi: "चेंजलॉग",
          ja: "変更履歴",
          pt: "Alterações",
          ru: "Изменения",
        },
        path: "/changelog",
      },`);
    const tabsBlock = `    tabs: [\n${tabs.join("\n")}\n    ],`;
    config = config.replace(/    tabs: \[[\s\S]*?\],/, tabsBlock);
    await writeFile(CONFIG_FILE, config);
  } catch (err) {
    console.error("Failed to update config navigation:", err.message);
  }
}

async function listMdxFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.match(/\.(md|mdx)$/)).map((e) => e.name).sort();
}

function buildGenerationPrompt(projectName, files, instructions, analysis) {
  const fileList = Object.entries(files).map(([name, content]) => `### Файл: ${name}\n\n${content}`).join("\n\n---\n\n");
  return `Проект: ${projectName}\n\nАнализ структуры:\n${analysis}\n\nФайлы для обработки:\n${fileList}\n\nИнструкции: ${instructions || "Преобразуй сырой Markdown в структурированную документацию"}\n\nЗадача:\n1. Создай MDX файлы с frontmatter (title, description, sidebar label, order)\n2. Используй компоненты: <Card>, <CardGroup>, <Steps>, <Step>, :::tip, :::note\n3. Пиши на русском языке\n4. Не выдумывай факты — только информация из исходных файлов\n5. Сохрани технические детали, примеры кода, API\n\nВерни результат в формате:\n\`\`\`file:filename.mdx\nсодержимое файла\n\`\`\`\n\nДля каждого файла используй этот формат.`;
}

function parseGeneratedFiles(text) {
  const files = {};
  const regex = /```file:(\S+\.mdx?)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) files[match[1]] = match[2].trim();
  if (Object.keys(files).length === 0) {
    const altRegex = /```(\S+\.mdx?)\n([\s\S]*?)```/g;
    while ((match = altRegex.exec(text)) !== null) {
      if (match[1].endsWith(".md") || match[1].endsWith(".mdx")) files[match[1]] = match[2].trim();
    }
  }
  return files;
}

// ─── Start ─────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BeDocs Admin Panel: http://0.0.0.0:${PORT}`);
  console.log(`Docs root: ${DOCS_ROOT}`);
  console.log(`Projects: ${PROJECTS_DIR}`);
});
