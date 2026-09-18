// Lucide icons — vendored UMD build (no CDN). lucide.createIcons() swaps
// <i data-lucide="name"> placeholders for inline SVG.

export function icon(name) {
  const i = document.createElement("i");
  i.dataset.lucide = name;
  return i;
}

export function refreshIcons(root = document) {
  if (window.lucide?.createIcons) {
    try {
      window.lucide.createIcons({ root });
    } catch {
      window.lucide.createIcons();
    }
  }
}
