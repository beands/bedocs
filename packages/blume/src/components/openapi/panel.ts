/**
 * Client behavior for the OpenAPI request/response panels. `<blume-panel-tabs>`
 * switches the visible `[data-panel="key"]` region when a `[data-panel-tab="key"]`
 * button is clicked, and an optional `[data-panel-copy]` button copies the active
 * panel's text. Vanilla custom element — no framework, in keeping with the core
 * theme.
 */

import { copyText, createCopyFlash } from "../copy-feedback.ts";

class BlumePanelTabs extends HTMLElement {
  connectedCallback() {
    const tabs = [
      ...this.querySelectorAll<HTMLButtonElement>("[data-panel-tab]"),
    ];
    const panels = [...this.querySelectorAll<HTMLElement>("[data-panel]")];
    const copy = this.querySelector<HTMLButtonElement>("[data-panel-copy]");

    const activate = (key: string): void => {
      for (const tab of tabs) {
        tab.setAttribute(
          "aria-selected",
          tab.dataset.panelTab === key ? "true" : "false"
        );
      }
      for (const panel of panels) {
        panel.classList.toggle("hidden", panel.dataset.panel !== key);
      }
    };

    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        const key = tab.dataset.panelTab;
        if (key) {
          activate(key);
        }
      });
    }

    if (copy) {
      const flash = createCopyFlash((copied) => {
        if (copied) {
          copy.dataset.copied = "true";
        } else {
          delete copy.dataset.copied;
        }
      }, "Copied");
      copy.addEventListener("click", async () => {
        const active = panels.find(
          (panel) => !panel.classList.contains("hidden")
        );
        if (await copyText(active?.textContent ?? "")) {
          flash();
        }
      });
    }
  }
}

if (!customElements.get("blume-panel-tabs")) {
  customElements.define("blume-panel-tabs", BlumePanelTabs);
}
