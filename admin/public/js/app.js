// BeDocs admin — application controller.

import { api } from "./api.js";
import {
  toast,
  confirmDialog,
  statusBadge,
  statusDot,
  pageChip,
  fmtTime,
} from "./components.js";
import { el, clear } from "./dom.js";
import { JobMonitor, stageOrder, STAGE_META } from "./generation.js";
import { icon, refreshIcons } from "./icons.js";
import { initTheme } from "./theme.js";

const $ = (id) => document.querySelector(`#${id}`);

const state = {
  config: { siteUrl: "" },
  fileContents: {},
  monitors: new Map(), // jobId -> JobMonitor
  project: null, // open project detail
  projectFiles: [],
  projects: [],
};

function siteLink(path) {
  const base = (state.config.siteUrl || "").replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
}

// ─── Navigation ──────────────────────────────────────────────

function switchView(name) {
  document
    .querySelectorAll(".nav-tab")
    .forEach((t) => t.classList.toggle("is-active", t.dataset.view === name));
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("is-active"));
  $(`view-${name}`).classList.add("is-active");
  if (name === "jobs") {
    loadJobs();
  }
  if (name === "settings") {
    loadSettings();
  }
}

// ─── Monitors ────────────────────────────────────────────────

function watchJob(jobId, hooks) {
  if (state.monitors.has(jobId)) {
    return state.monitors.get(jobId);
  }
  const monitor = new JobMonitor(jobId, hooks);
  state.monitors.set(jobId, monitor);
  monitor.start();
  return monitor;
}

function unwatchJob(jobId) {
  state.monitors.get(jobId)?.close();
  state.monitors.delete(jobId);
}

// ─── Projects view ───────────────────────────────────────────

async function loadProjects() {
  const list = $("projects-list");
  try {
    const data = await api.projects();
    state.projects = data.projects || [];
    renderProjects();
    updateJobsBadge();
  } catch (error) {
    toast(`Ошибка загрузки проектов: ${error.message}`, "error");
  }
}

function renderProjects() {
  const list = clear($("projects-list"));
  if (state.projects.length === 0) {
    list.append(
      el("div", { class: "empty-state" }, [
        icon("folder-plus"),
        el("h3", { text: "Нет проектов" }),
        el("p", {
          text: "Создайте первый проект документации — загрузите Markdown-файлы или сгенерируйте контент через AI",
        }),
      ])
    );
    refreshIcons(list);
    return;
  }
  for (const p of state.projects) {
    list.append(projectCard(p));
  }
  refreshIcons(list);
}

function projectCard(p) {
  const dropId = `drop-${p.name}`;
  const inputId = `fileinput-${p.name}`;

  const zone = el(
    "div",
    {
      attrs: {
        "aria-label": `Загрузить файлы в ${p.name}`,
        role: "button",
        tabindex: "0",
      },
      class: "upload-zone",
    },
    [
      icon("upload-cloud"),
      el("span", { text: "Перетащите .md / .mdx сюда" }),
      el("small", {
        text: "или нажмите для выбора — сайт пересоберётся автоматически",
      }),
      el("input", {
        accept: ".md,.mdx",
        id: inputId,
        multiple: true,
        style: "display:none",
        type: "file",
      }),
    ]
  );
  const fileInput = zone.querySelector("input");
  zone.addEventListener("click", () => fileInput.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () =>
    quickUpload(p.name, fileInput.files, zone)
  );
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("is-dragover");
  });
  zone.addEventListener("dragleave", () =>
    zone.classList.remove("is-dragover")
  );
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-dragover");
    quickUpload(p.name, e.dataTransfer.files, zone);
  });

  return el("article", { class: "project-card" }, [
    el("div", { class: "project-card-head" }, [
      el(
        "button",
        {
          class: "project-card-title",
          onclick: () => openProject(p.name),
          type: "button",
        },
        [icon("folder"), el("span", { text: p.name })]
      ),
      p.lastJob ? statusBadge(p.lastJob.status) : null,
    ]),
    el("div", { class: "project-card-meta" }, [
      el("span", {}, [icon("file-text"), `${p.files} файл(ов)`]),
      el("span", {}, [icon("link"), `/projects/${p.name}`]),
      p.lastJob
        ? el("span", {}, [
            icon("history"),
            `генерация: ${fmtTime(p.lastJob.updatedAt)}`,
          ])
        : null,
    ]),
    el("div", {
      class: "project-card-files",
      text: (p.fileNames || []).join(", "),
    }),
    zone,
    el("div", { class: "project-card-actions" }, [
      el(
        "button",
        {
          class: "btn btn-primary btn-sm",
          onclick: () => openProject(p.name),
          type: "button",
        },
        [icon("settings-2"), "Управление"]
      ),
      el(
        "a",
        {
          class: "btn btn-ghost btn-sm",
          href: siteLink(`/projects/${p.name}`),
          rel: "noopener",
          target: "_blank",
        },
        [icon("external-link"), "Сайт"]
      ),
      el(
        "button",
        {
          class: "btn btn-danger btn-sm",
          onclick: () => deleteProject(p.name),
          type: "button",
        },
        [icon("trash-2"), "Удалить"]
      ),
    ]),
  ]);
}

async function quickUpload(projectName, files, zone) {
  if (!files?.length) {
    return;
  }
  const formData = new FormData();
  let count = 0;
  for (const file of files) {
    if (/\.(md|mdx)$/i.test(file.name)) {
      formData.append("files", file);
      count++;
    }
  }
  if (count === 0) {
    toast("Выберите .md или .mdx файлы", "error");
    return;
  }
  try {
    toast(`Загрузка и обработка ${count} файл(ов)…`, "info");
    const data = await api.uploadAndProcess(projectName, formData);
    toast(`Готово: ${data.uploaded.join(", ")}. Сайт пересобран.`, "success");
  } catch (error) {
    toast(`Ошибка загрузки: ${error.message}`, "error");
  }
  loadProjects();
}

function showCreateProjectDialog() {
  const root = $("dialog-root");
  const nameInput = el("input", {
    attrs: { autocomplete: "off" },
    id: "dlg-project-name",
    placeholder: "my-project",
    type: "text",
  });
  nameInput.addEventListener("input", () => {
    nameInput.value = nameInput.value
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]/g, "");
  });
  const descInput = el("textarea", {
    id: "dlg-project-desc",
    placeholder: "Краткое описание проекта…",
    rows: 3,
  });

  const submit = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      toast("Введите имя проекта", "error");
      return;
    }
    try {
      await api.createProject(name, descInput.value.trim());
      toast(`Проект создан: ${name}`, "success");
      overlay.remove();
      loadProjects();
    } catch (error) {
      toast(error.message, "error");
    }
  };

  const overlay = el("div", { class: "dialog-overlay" }, [
    el(
      "div",
      {
        attrs: {
          "aria-labelledby": "dlg-title",
          "aria-modal": "true",
          role: "dialog",
        },
        class: "dialog",
      },
      [
        el("h2", { id: "dlg-title", text: "Новый проект документации" }),
        el("div", { class: "form-group", style: "margin-top:16px" }, [
          el("label", {
            attrs: { for: "dlg-project-name" },
            text: "Имя проекта (slug)",
          }),
          nameInput,
          el("p", {
            class: "field-hint",
            text: "Только строчные буквы, цифры и дефисы. URL: /projects/my-project",
          }),
        ]),
        el("div", { class: "form-group" }, [
          el("label", {
            attrs: { for: "dlg-project-desc" },
            text: "Описание (необязательно)",
          }),
          descInput,
        ]),
        el("div", { class: "dialog-actions" }, [
          el(
            "button",
            {
              class: "btn btn-ghost",
              onclick: () => overlay.remove(),
              type: "button",
            },
            "Отмена"
          ),
          el(
            "button",
            { class: "btn btn-primary", onclick: submit, type: "button" },
            [icon("plus"), "Создать"]
          ),
        ]),
      ]
    ),
  ]);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      overlay.remove();
    }
  });
  root.append(overlay);
  refreshIcons(overlay);
  nameInput.focus();
}

async function deleteProject(name) {
  const ok = await confirmDialog({
    confirmLabel: "Удалить",
    danger: true,
    message: `Проект «${name}» и все его файлы будут удалены без возможности восстановления.`,
    title: "Удалить проект?",
  });
  if (!ok) {
    return;
  }
  try {
    await api.deleteProject(name);
    toast("Проект удалён", "success");
    if (state.project === name) {
      switchView("projects");
    }
    loadProjects();
  } catch (error) {
    toast(`Ошибка: ${error.message}`, "error");
  }
}

// ─── Project detail view ─────────────────────────────────────

async function openProject(name) {
  state.project = name;
  $("project-heading").textContent = name;
  $("project-sub").textContent = `/projects/${name}`;
  renderProjectActions();
  document
    .querySelectorAll(".nav-tab")
    .forEach((t) => t.classList.remove("is-active"));
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("is-active"));
  $("view-project").classList.add("is-active");
  await loadProjectFiles();
  switchProjectSection("files");
}

function renderProjectActions() {
  const name = state.project;
  const box = clear($("project-actions"));
  box.append(
    el(
      "a",
      {
        class: "btn btn-ghost btn-sm",
        href: siteLink(`/projects/${name}`),
        rel: "noopener",
        target: "_blank",
      },
      [icon("external-link"), "Сайт"]
    ),
    el(
      "button",
      { class: "btn btn-ghost btn-sm", onclick: rebuildSite, type: "button" },
      [icon("hammer"), "Пересобрать"]
    ),
    el(
      "button",
      {
        class: "btn btn-danger btn-sm",
        onclick: () => deleteProject(name),
        type: "button",
      },
      [icon("trash-2"), "Удалить"]
    )
  );
  refreshIcons(box);
}

function switchProjectSection(name) {
  document
    .querySelectorAll(".subnav-tab")
    .forEach((t) =>
      t.classList.toggle("is-active", t.dataset.section === name)
    );
  document
    .querySelectorAll(".project-section")
    .forEach((s) => s.classList.remove("is-active"));
  $(`section-${name}`).classList.add("is-active");
  if (name === "editor") {
    renderEditor();
  }
  if (name === "generate") {
    renderGenerate();
  }
}

async function loadProjectFiles() {
  try {
    const data = await api.project(state.project);
    state.projectFiles = data.files || [];
    state.fileContents = data.fileContents || {};
    renderFilesSection();
  } catch (error) {
    toast(`Ошибка: ${error.message}`, "error");
  }
}

function renderFilesSection() {
  const box = clear($("section-files"));
  const input = el("input", {
    accept: ".md,.mdx",
    multiple: true,
    style: "display:none",
    type: "file",
  });
  const zone = el(
    "div",
    {
      attrs: { "aria-label": "Загрузить файлы", role: "button", tabindex: "0" },
      class: "upload-zone",
    },
    [
      icon("upload-cloud"),
      el("span", { text: "Перетащите .md / .mdx файлы сюда" }),
      el("small", {
        text: "Файлы сохраняются как есть — без конвертации и пересборки",
      }),
      input,
    ]
  );
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", () => uploadFiles(input.files, input));
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("is-dragover");
  });
  zone.addEventListener("dragleave", () =>
    zone.classList.remove("is-dragover")
  );
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-dragover");
    uploadFiles(e.dataTransfer.files, input);
  });

  const card = el("div", { class: "section-card" }, [
    el("div", { class: "section-card-head" }, [
      el("h3", { text: `Файлы проекта (${state.projectFiles.length})` }),
      el(
        "button",
        {
          class: "btn btn-ghost btn-sm",
          onclick: () => input.click(),
          type: "button",
        },
        [icon("upload"), "Загрузить"]
      ),
    ]),
    zone,
    el("div", { style: "height:14px" }),
    state.projectFiles.length === 0
      ? el("p", {
          class: "field-hint",
          text: "Нет файлов. Загрузите Markdown-файлы или используйте AI-генерацию.",
        })
      : el("ul", { class: "file-list" }, state.projectFiles.map(fileRow)),
  ]);
  box.append(card);
  refreshIcons(box);
}

function fileRow(f) {
  const name = state.project;
  return el("li", { class: "file-item" }, [
    icon("file-text"),
    el("span", { class: "file-item-name", text: f }),
    el("div", { class: "file-item-actions" }, [
      el(
        "a",
        {
          attrs: {
            "aria-label": `Открыть ${f} на сайте`,
            title: "Открыть на сайте",
          },
          class: "icon-btn",
          href: siteLink(`/projects/${name}/${f.replace(/\.(md|mdx)$/, "")}`),
          rel: "noopener",
          style: "width:32px;height:32px",
          target: "_blank",
        },
        icon("external-link")
      ),
      el(
        "button",
        {
          attrs: { "aria-label": `Удалить ${f}`, title: "Удалить" },
          class: "icon-btn danger",
          onclick: () => deleteFile(f),
          style: "width:32px;height:32px",
          type: "button",
        },
        icon("trash-2")
      ),
    ]),
  ]);
}

async function uploadFiles(files, input) {
  if (!files?.length) {
    return;
  }
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  try {
    const data = await api.upload(state.project, formData);
    toast(`Загружено: ${data.uploaded.join(", ")}`, "success");
    if (input) {
      input.value = "";
    }
    await loadProjectFiles();
  } catch (error) {
    toast(`Ошибка: ${error.message}`, "error");
  }
}

async function deleteFile(f) {
  const ok = await confirmDialog({
    confirmLabel: "Удалить",
    danger: true,
    message: `Файл ${f} будет удалён.`,
    title: "Удалить файл?",
  });
  if (!ok) {
    return;
  }
  try {
    await api.deleteFile(state.project, f);
    toast("Файл удалён", "success");
    await loadProjectFiles();
  } catch (error) {
    toast(`Ошибка: ${error.message}`, "error");
  }
}

// ─── Editor ──────────────────────────────────────────────────

function renderEditor() {
  const box = clear($("section-editor"));
  const select = el(
    "select",
    {
      id: "editor-file-select",
      onchange: () => {
        $("editor-content").value = state.fileContents[select.value] || "";
      },
    },
    state.projectFiles.map((f) => el("option", { text: f, value: f }))
  );
  const area = el("textarea", {
    attrs: { "aria-label": "Содержимое файла", spellcheck: "false" },
    class: "editor-area",
    id: "editor-content",
  });

  box.append(
    el("div", { class: "section-card" }, [
      el("div", { class: "editor-toolbar" }, [
        el("div", { class: "form-group" }, [
          el("label", { attrs: { for: "editor-file-select" }, text: "Файл" }),
          select,
        ]),
        el(
          "button",
          { class: "btn btn-primary", onclick: saveEditorFile, type: "button" },
          [icon("save"), "Сохранить"]
        ),
        el(
          "button",
          {
            class: "btn btn-danger",
            onclick: () => select.value && deleteFile(select.value),
            type: "button",
          },
          [icon("trash-2"), "Удалить файл"]
        ),
      ]),
      state.projectFiles.length === 0
        ? el("p", {
            class: "field-hint",
            text: "Нет файлов для редактирования.",
          })
        : area,
    ])
  );
  if (state.projectFiles.length) {
    area.value = state.fileContents[select.value] || "";
  }
  refreshIcons(box);
}

async function saveEditorFile() {
  const fileName = $("editor-file-select")?.value;
  if (!fileName) {
    return;
  }
  try {
    await api.saveFile(state.project, fileName, $("editor-content").value);
    state.fileContents[fileName] = $("editor-content").value;
    toast(`Файл сохранён: ${fileName}`, "success");
  } catch (error) {
    toast(`Ошибка: ${error.message}`, "error");
  }
}

// ─── Rebuild ─────────────────────────────────────────────────

async function rebuildSite() {
  const ok = await confirmDialog({
    confirmLabel: "Пересобрать",
    message:
      "Сборка займёт 1–2 минуты. Сайт будет недоступен на время пересборки.",
    title: "Пересобрать сайт?",
  });
  if (!ok) {
    return;
  }
  toast("Сборка запущена…", "info");
  try {
    await api.rebuild();
    toast("Сайт пересобран и перезапущен", "success");
  } catch (error) {
    toast(`Ошибка сборки: ${error.message}`, "error");
  }
}

// ─── AI generation section ───────────────────────────────────

async function renderGenerate() {
  const box = clear($("section-generate"));

  const checks = el(
    "div",
    { class: "check-list", id: "gen-file-checks" },
    state.projectFiles.map((f) =>
      el("label", { class: "check-item" }, [
        el("input", {
          checked: true,
          class: "gen-file-check",
          type: "checkbox",
          value: f,
        }),
        el("span", { text: f }),
      ])
    )
  );

  const instructions = el("textarea", {
    id: "gen-instructions",
    placeholder:
      "Например: создай документацию API с разделами: введение, установка, примеры…",
    rows: 3,
  });
  const model = el("input", {
    attrs: { list: "models-datalist" },
    id: "gen-model",
    placeholder: "модель из настроек",
    type: "text",
  });
  const startBtn = el(
    "button",
    { class: "btn btn-primary", id: "btn-generate", type: "button" },
    [icon("sparkles"), "Запустить генерацию"]
  );
  startBtn.addEventListener("click", () => startGeneration());

  box.append(
    el("div", { class: "section-card" }, [
      el("div", { class: "section-card-head" }, [
        el("h3", { text: "AI-генерация документации" }),
        el("span", { class: "badge badge-info" }, [
          icon("shield-check"),
          "фоновая, с автовосстановлением",
        ]),
      ]),
      el("p", {
        class: "card-sub",
        style: "margin-bottom:16px",
        text: "Генерация выполняется фоновым заданием: прогресс сохраняется после каждой страницы, при обрыве связи работа продолжается с контрольной точки. Вкладку можно закрыть.",
      }),
      el("div", { class: "form-group" }, [
        el("label", { text: "Файлы для обработки" }),
        state.projectFiles.length === 0
          ? el("p", {
              class: "field-hint",
              text: "Нет файлов. Сначала загрузите .md файлы.",
            })
          : checks,
        state.projectFiles.length > 0
          ? el("div", { style: "display:flex;gap:8px;margin-top:8px" }, [
              el(
                "button",
                {
                  class: "btn btn-ghost btn-xs",
                  onclick: () => toggleAllFiles(true),
                  type: "button",
                },
                "Выбрать все"
              ),
              el(
                "button",
                {
                  class: "btn btn-ghost btn-xs",
                  onclick: () => toggleAllFiles(false),
                  type: "button",
                },
                "Снять все"
              ),
            ])
          : null,
      ]),
      el("div", { class: "form-group" }, [
        el("label", {
          attrs: { for: "gen-instructions" },
          text: "Инструкции для AI (необязательно)",
        }),
        instructions,
      ]),
      el("div", { class: "form-group" }, [
        el("label", {
          attrs: { for: "gen-model" },
          text: "Модель (необязательно — берётся из настроек)",
        }),
        model,
      ]),
      el("div", { class: "form-actions" }, [startBtn]),
    ]),
    el("div", { id: "gen-active-job" }),
    el("div", { id: "gen-recent-jobs" })
  );
  refreshIcons(box);
  loadProjectJobs();
}

function toggleAllFiles(checked) {
  document
    .querySelectorAll(".gen-file-check")
    .forEach((cb) => (cb.checked = checked));
}

async function startGeneration() {
  const selectedFiles = [
    ...document.querySelectorAll(".gen-file-check:checked"),
  ].map((cb) => cb.value);
  if (state.projectFiles.length && selectedFiles.length === 0) {
    toast("Выберите хотя бы один файл", "error");
    return;
  }
  const btn = $("btn-generate");
  btn.disabled = true;
  try {
    const res = await api.startGeneration(state.project, {
      instructions: $("gen-instructions").value.trim(),
      model: $("gen-model").value.trim() || undefined,
      selectedFiles: selectedFiles.length ? selectedFiles : undefined,
    });
    toast(
      res.deduplicated
        ? "Такое задание уже выполняется — отслеживаем его"
        : "Задание запущено",
      res.deduplicated ? "info" : "success"
    );
    showLiveJob(res.jobId, $("gen-active-job"));
  } catch (error) {
    toast(`Ошибка запуска: ${error.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

async function loadProjectJobs() {
  const target = $("gen-recent-jobs");
  if (!target) {
    return;
  }
  try {
    const data = await api.jobs({ project: state.project });
    const jobs = (data.jobs || []).slice(0, 5);
    clear(target);
    if (!jobs.length) {
      return;
    }
    const active = jobs.find(
      (j) => ["queued", "running", "paused"].includes(j.status) || j.running
    );
    if (active && !state.monitors.has(active.jobId)) {
      showLiveJob(active.jobId, $("gen-active-job"));
    }
    target.append(
      el("div", { class: "section-card" }, [
        el("div", { class: "section-card-head" }, [
          el("h3", { text: "Последние задания" }),
        ]),
        el("div", {}, jobs.map(jobSummaryRow)),
      ])
    );
    refreshIcons(target);
  } catch {
    /* jobs list is optional */
  }
}

function jobSummaryRow(j) {
  return el("div", { class: "file-item", style: "margin-bottom:6px" }, [
    statusDot(j.status),
    el("span", {
      class: "file-item-name",
      text: `${j.jobId.slice(0, 8)}… · ${j.model || ""}`,
    }),
    statusBadge(j.status),
    el(
      "button",
      {
        class: "btn btn-ghost btn-xs",
        onclick: () => showLiveJob(j.jobId, $("gen-active-job"), true),
        type: "button",
      },
      "Открыть"
    ),
  ]);
}

// ─── Live job panel ──────────────────────────────────────────

function showLiveJob(jobId, container, scroll = false) {
  if (!container) {
    return;
  }
  clear(container);
  const logLines = [];
  const draftBox = el("div", { class: "draft-box", style: "display:none" });
  const logBox = el("div", { class: "log-box", style: "display:none" });
  const head = el("div", { class: "job-card-head" });
  const body = el("div", { class: "job-card-body" });
  const conn = el("span", { class: "job-conn" }, [
    icon("wifi"),
    "подключение…",
  ]);

  const card = el("div", { class: "job-card" }, [
    head,
    el("div", { class: "job-live-panel" }, [
      el("div", { class: "job-live-top" }, [
        conn,
        el(
          "div",
          { class: "progress" },
          el("div", { class: "progress-bar", style: "width:0%" })
        ),
        el("span", { class: "job-live-pct", text: "0%" }),
      ]),
      body,
      draftBox,
      logBox,
    ]),
  ]);
  container.append(
    el("div", { class: "section-card" }, [
      el("div", { class: "section-card-head" }, [
        el("h3", { text: "Задание генерации" }),
        el("span", { class: "badge badge-neutral", text: jobId.slice(0, 8) }),
      ]),
      card,
    ])
  );
  refreshIcons(container);
  if (scroll) {
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const bar = container.querySelector(".progress-bar");
  const pct = container.querySelector(".job-live-pct");

  const renderState = (job) => {
    clear(head).append(
      el("div", { class: "job-card-title" }, [
        statusDot(job.status),
        el("span", { text: `Модель: ${job.model || "—"}` }),
        statusBadge(job.status),
      ]),
      renderJobActions(job)
    );
    const progress = job.progress ?? 0;
    bar.style.width = `${progress}%`;
    pct.textContent = `${progress}%`;

    clear(body);
    // stages
    const stages = el(
      "div",
      { class: "stage-list" },
      stageOrder(job).map((s) => {
        const meta = STAGE_META[s.stage];
        const cls =
          { done: "is-done", error: "is-error", running: "is-running" }[
            s.status
          ] || "";
        const ic =
          {
            done: "check-circle-2",
            error: "alert-triangle",
            running: "loader-2",
          }[s.status] || meta.icon;
        return el("div", { class: `stage-item ${cls}` }, [
          icon(ic),
          el("span", { class: "stage-item-name", text: meta.name }),
          s.stage === "build" && job.build?.error
            ? el("span", {
                class: "stage-item-meta",
                text: job.build.error.slice(0, 80),
              })
            : null,
        ]);
      })
    );
    body.append(stages);

    // page chips
    if (job.pages?.length) {
      body.append(el("div", { class: "page-list" }, job.pages.map(pageChip)));
    }
    // error / attention
    if (job.error) {
      body.append(
        el("p", {
          class: "field-hint",
          style: "color:var(--danger)",
          text: `Ошибка: ${job.error.message || job.error}`,
        })
      );
    }
    if (job.draft) {
      draftBox.style.display = "block";
      draftBox.textContent = job.draft;
      draftBox.scrollTop = draftBox.scrollHeight;
    }
    refreshIcons(body);
    refreshIcons(head);
  };

  unwatchJob(jobId); // rebind fresh handlers to this container
  watchJob(jobId, {
    onConn: (state2) => {
      conn.className = `job-conn${state2 === "live" ? " is-live" : state2 === "reconnecting" || state2 === "lost" ? " is-lost" : ""}`;
      clear(conn).append(
        icon(
          state2 === "live" ? "wifi" : state2 === "done" ? "check" : "wifi-off"
        ),
        {
          live: "live",
          reconnecting: "переподключение…",
          lost: "соединение потеряно",
          done: "завершено",
          closed: "",
        }[state2] || state2
      );
      refreshIcons(conn);
      if (state2 === "done") loadProjectJobs();
    },
    onEvent: (type, payload) => {
      if (type === "page.delta" && payload.text !== undefined) {
        draftBox.style.display = "block";
        draftBox.textContent = payload.text;
        draftBox.scrollTop = draftBox.scrollHeight;
      }
      if (type === "page.snapshot" && payload.text) {
        draftBox.style.display = "block";
        draftBox.textContent = payload.text;
      }
      if (["retry", "log", "stage", "page.status"].includes(type)) {
        const text =
          payload.message ||
          payload.error ||
          (payload.fileName
            ? `${payload.fileName}: ${payload.status}`
            : JSON.stringify(payload).slice(0, 120));
        logLines.push(
          `${type === "retry" ? `retry #${payload.attempt} (${Math.round((payload.waitMs || 0) / 1000)}s)` : text}`
        );
        if (logLines.length > 200) logLines.shift();
        logBox.style.display = "block";
        logBox.textContent = logLines.join("\n");
        logBox.scrollTop = logBox.scrollHeight;
      }
      if (
        type === "job.status" &&
        ["done", "canceled"].includes(payload.status)
      ) {
        loadProjects();
      }
    },
    onState: renderState,
  });
}

function renderJobActions(job) {
  const wrap = el("div", { class: "job-card-actions" });
  const add = (label, ic, cls, fn, title) =>
    wrap.append(
      el(
        "button",
        {
          attrs: title ? { title } : {},
          class: `btn ${cls} btn-sm`,
          onclick: fn,
          type: "button",
        },
        [icon(ic), label]
      )
    );

  if (["paused", "needs_attention", "canceled"].includes(job.status)) {
    add(
      "Продолжить",
      "play",
      "btn-primary",
      async () => {
        try {
          await api.resumeJob(job.jobId);
          toast("Задание продолжается", "success");
        } catch (error) {
          toast(error.message, "error");
        }
      },
      "Продолжить с контрольной точки"
    );
  }
  if (["queued", "running", "paused"].includes(job.status) || job.running) {
    add("Отменить", "x-circle", "btn-danger", async () => {
      const ok = await confirmDialog({
        confirmLabel: "Отменить задание",
        danger: true,
        message:
          "Уже созданные страницы сохранятся. Задание можно будет продолжить позже.",
        title: "Отменить задание?",
      });
      if (!ok) {
        return;
      }
      try {
        await api.cancelJob(job.jobId);
        toast("Задание отменено", "info");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }
  if (job.status === "done" && job.build?.status === "error") {
    add("Повторить сборку", "hammer", "btn-ghost", async () => {
      try {
        await api.retryJob(job.jobId, "build");
        toast("Сборка перезапущена", "info");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }
  return wrap;
}

// ─── Jobs view ───────────────────────────────────────────────

async function loadJobs() {
  const box = $("jobs-list");
  try {
    const data = await api.jobs();
    const jobs = data.jobs || [];
    clear(box);
    if (!jobs.length) {
      box.append(
        el("div", { class: "empty-state" }, [
          icon("list-checks"),
          el("h3", { text: "Нет заданий" }),
          el("p", {
            text: "Задания AI-генерации появятся здесь после запуска из раздела проекта",
          }),
        ])
      );
      refreshIcons(box);
      return;
    }
    for (const j of jobs) {
      box.append(jobCard(j));
    }
    refreshIcons(box);
    // attach monitors to active jobs for live updates
    for (const j of jobs) {
      if (["queued", "running", "paused"].includes(j.status) || j.running) {
        const cardEl = box.querySelector(`[data-job-card="${j.jobId}"]`);
        if (cardEl) {
          attachCardMonitor(j.jobId, cardEl);
        }
      }
    }
  } catch (error) {
    toast(`Ошибка: ${error.message}`, "error");
  }
}

function jobCard(j) {
  const card = el("div", { class: "job-card", dataset: { jobCard: j.jobId } }, [
    el("div", { class: "job-card-head" }, [
      el("div", { class: "job-card-title" }, [
        statusDot(j.status),
        el("span", { text: j.project }),
        statusBadge(j.status),
      ]),
      el("div", { class: "job-card-actions" }, [
        el(
          "button",
          {
            class: "btn btn-ghost btn-sm",
            onclick: () => openProject(j.project),
            type: "button",
          },
          [icon("folder"), "Проект"]
        ),
        el(
          "button",
          {
            class: "btn btn-ghost btn-sm",
            dataset: { expand: j.jobId },
            type: "button",
          },
          [icon("activity"), "Монитор"]
        ),
      ]),
    ]),
    el("div", { class: "job-card-meta" }, [
      el("span", { text: `модель: ${j.model || "—"}` }),
      el("span", { text: `создано: ${fmtTime(j.createdAt)}` }),
      el("span", { text: `обновлено: ${fmtTime(j.updatedAt)}` }),
      el("span", {
        text: `страниц: ${(j.pages || []).filter((p) => p.status === "saved").length}/${(j.pages || []).length}`,
      }),
    ]),
    el(
      "div",
      { class: "progress", style: "margin-top:12px" },
      el("div", { class: "progress-bar", style: `width:${j.progress || 0}%` })
    ),
    el("div", {
      class: "job-card-body",
      dataset: { jobBody: j.jobId },
      style: "display:none",
    }),
  ]);
  card.querySelector("[data-expand]").addEventListener("click", () => {
    const body = card.querySelector(`[data-job-body]`);
    const visible = body.style.display !== "none";
    body.style.display = visible ? "none" : "flex";
    if (!visible) {
      attachCardMonitor(j.jobId, card);
    }
  });
  return card;
}

function attachCardMonitor(jobId, cardEl) {
  const body = cardEl.querySelector(`[data-job-body]`);
  body.style.display = "flex";
  unwatchJob(jobId);
  watchJob(jobId, {
    onState: (job) => {
      clear(body);
      body.append(
        el(
          "div",
          { class: "stage-list" },
          stageOrder(job).map((s) => {
            const meta = STAGE_META[s.stage];
            const cls =
              { done: "is-done", error: "is-error", running: "is-running" }[
                s.status
              ] || "";
            const ic =
              {
                done: "check-circle-2",
                error: "alert-triangle",
                running: "loader-2",
              }[s.status] || meta.icon;
            return el("div", { class: `stage-item ${cls}` }, [
              icon(ic),
              el("span", { class: "stage-item-name", text: meta.name }),
            ]);
          })
        ),
        job.pages?.length
          ? el("div", { class: "page-list" }, job.pages.map(pageChip))
          : null,
        renderJobActions(job)
      );
      // sync head badge + progress
      const head = cardEl.querySelector(".job-card-head .job-card-title");
      if (head) {
        clear(head).append(
          statusDot(job.status),
          el("span", { text: job.project }),
          statusBadge(job.status)
        );
      }
      const bar = cardEl.querySelector(".progress-bar");
      if (bar) {
        bar.style.width = `${job.progress ?? 0}%`;
      }
      refreshIcons(body);
      refreshIcons(cardEl);
    },
  });
}

async function updateJobsBadge() {
  try {
    const data = await api.jobs({ active: "1" });
    const n = (data.jobs || []).length;
    const badge = $("nav-jobs-count");
    badge.hidden = n === 0;
    badge.textContent = String(n);
  } catch {
    /* badge is cosmetic */
  }
}

// ─── Settings ────────────────────────────────────────────────

async function loadSettings() {
  try {
    const data = await api.settings();
    $("set-key").value = data.creaAiKey || "";
    $("set-model").value = data.defaultModel || "";
    $("set-fallback-models").value = data.fallbackModels || "";
    $("set-site-url").value = data.siteUrl || state.config.siteUrl || "";
    $("set-key-status").textContent = data.hasKey
      ? "API-ключ настроен и хранится на сервере"
      : "API-ключ не задан — генерация недоступна";
  } catch (error) {
    toast(`Ошибка: ${error.message}`, "error");
  }
  try {
    const { models } = await api.models();
    const dl = clear($("models-datalist"));
    for (const m of models || []) {
      dl.append(el("option", { value: m.id }));
    }
  } catch {
    /* models list optional */
  }
}

async function saveSettings() {
  try {
    await api.saveSettings({
      creaAiKey: $("set-key").value.trim(),
      defaultModel: $("set-model").value.trim(),
      fallbackModels: $("set-fallback-models").value.trim(),
      siteUrl: $("set-site-url").value.trim(),
    });
    toast("Настройки сохранены", "success");
    const cfg = await api.config().catch(() => null);
    if (cfg) {
      state.config = cfg;
    }
    loadSettings();
  } catch (error) {
    toast(`Ошибка: ${error.message}`, "error");
  }
}

// ─── Init ────────────────────────────────────────────────────

async function init() {
  initTheme();
  document
    .querySelectorAll(".nav-tab")
    .forEach((t) =>
      t.addEventListener("click", () => switchView(t.dataset.view))
    );
  document
    .querySelectorAll(".subnav-tab")
    .forEach((t) =>
      t.addEventListener("click", () => switchProjectSection(t.dataset.section))
    );
  $("btn-new-project").addEventListener("click", showCreateProjectDialog);
  $("btn-back-projects").addEventListener("click", () =>
    switchView("projects")
  );
  $("btn-jobs-refresh").addEventListener("click", loadJobs);
  $("btn-save-settings").addEventListener("click", saveSettings);
  try {
    state.config = await api.config();
  } catch {
    /* relative links */
  }
  if (state.config.siteUrl) {
    $("link-site").href = state.config.siteUrl;
  }
  await loadProjects();
  setInterval(updateJobsBadge, 15_000);
  refreshIcons();
}

document.addEventListener("DOMContentLoaded", init);
