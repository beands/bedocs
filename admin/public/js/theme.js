// Theme: user choice persisted in localStorage, falls back to OS preference.

const KEY = "bedocs-admin-theme";

export function currentTheme() {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") {
    return saved;
  }
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

export function initTheme() {
  applyTheme(currentTheme());
  matchMedia("(prefers-color-scheme: light)").addEventListener(
    "change",
    (e) => {
      if (!localStorage.getItem(KEY)) {
        applyTheme(e.matches ? "light" : "dark");
      }
    }
  );
  document.querySelector("#btn-theme")?.addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(KEY, next);
    applyTheme(next);
  });
}
