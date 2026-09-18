// Shared UI components: toasts, promise-based confirm dialog, status badges.

import { el } from "./dom.js";
import { icon, refreshIcons } from "./icons.js";

// ─── Toasts ──────────────────────────────────────────────────

const TOAST_ICONS = {
  error: "alert-circle",
  info: "info",
  success: "check-circle-2",
};

export function toast(message, type = "success", ms = 4200) {
  const root = document.querySelector("#toast-root");
  const node = el(
    "div",
    { attrs: { role: "status" }, class: `toast toast-${type}` },
    [icon(TOAST_ICONS[type] || "info"), el("span", { text: message })]
  );
  root.append(node);
  refreshIcons(node);
  setTimeout(() => {
    node.classList.add("is-leaving");
    node.addEventListener("animationend", () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 500);
  }, ms);
}

// ─── Confirm dialog (replaces confirm()/alert()) ────────────

export function confirmDialog({
  title,
  message,
  confirmLabel = "Подтвердить",
  danger = false,
}) {
  return new Promise((resolve) => {
    const root = document.querySelector("#dialog-root");
    const close = (result) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        close(false);
      }
    };
    const confirmBtn = el(
      "button",
      {
        class: danger ? "btn btn-danger" : "btn btn-primary",
        onclick: () => close(true),
        type: "button",
      },
      confirmLabel
    );
    const overlay = el(
      "div",
      {
        class: "dialog-overlay",
        onclick: (e) => {
          if (e.target === overlay) {
            close(false);
          }
        },
      },
      el(
        "div",
        {
          attrs: { "aria-modal": "true", role: "alertdialog" },
          class: "dialog",
        },
        [
          el("h2", { text: title }),
          el("p", { class: "dialog-msg", text: message }),
          el("div", { class: "dialog-actions" }, [
            el(
              "button",
              {
                class: "btn btn-ghost",
                onclick: () => close(false),
                type: "button",
              },
              "Отмена"
            ),
            confirmBtn,
          ]),
        ]
      )
    );
    root.append(overlay);
    document.addEventListener("keydown", onKey);
    confirmBtn.focus();
  });
}

// ─── Status badges ───────────────────────────────────────────

export const JOB_STATUS = {
  canceled: { cls: "badge-neutral", icon: "x-circle", label: "Отменено" },
  done: { cls: "badge-success", icon: "check-circle-2", label: "Завершено" },
  needs_attention: {
    cls: "badge-danger",
    icon: "alert-triangle",
    label: "Требует внимания",
  },
  paused: {
    cls: "badge-warning",
    icon: "pause-circle",
    label: "Пауза (авто-возобновление)",
  },
  queued: { cls: "badge-neutral", icon: "clock", label: "В очереди" },
  running: { cls: "badge-info", icon: "loader-2", label: "Выполняется" },
};

export function statusBadge(status) {
  const meta = JOB_STATUS[status] || {
    cls: "badge-neutral",
    icon: "circle",
    label: status,
  };
  return el("span", { class: `badge ${meta.cls}` }, [
    icon(meta.icon),
    meta.label,
  ]);
}

export function statusDot(status) {
  const cls =
    {
      canceled: "dot-queued",
      done: "dot-done",
      needs_attention: "dot-error",
      paused: "dot-paused",
      queued: "dot-queued",
      running: "dot-running",
    }[status] || "dot-queued";
  return el("span", { attrs: { "aria-hidden": "true" }, class: `dot ${cls}` });
}

export function pageChip(page) {
  const st = page.status || "pending";
  const cls =
    { error: "is-error", generating: "is-generating", saved: "is-saved" }[st] ||
    "";
  const ic =
    { error: "alert-triangle", generating: "loader-2", saved: "check" }[st] ||
    "file-text";
  return el(
    "span",
    {
      attrs: { title: page.title || page.fileName },
      class: `page-chip ${cls}`,
    },
    [icon(ic), page.fileName]
  );
}

export function fmtTime(iso) {
  if (!iso) {
    return "";
  }
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      month: "2-digit",
    });
  } catch {
    return iso;
  }
}
