/**
 * Shared clipboard + "Copied" feedback used by every copy affordance (code
 * blocks, page actions, color swatches, prompts, API panels, Ask AI). One
 * implementation owns the invariants each site used to hand-roll:
 *
 * - the clipboard write is guarded, and nothing flashes on failure — a
 *   confirmation must never lie;
 * - repeat copies restart the hold instead of stacking timers, so the copied
 *   state never reverts early after a double-click;
 * - every successful copy is announced to a shared polite live region, so the
 *   confirmation is audible, not just visual (previously only the code-block
 *   button announced).
 */

/** How long the copied confirmation holds before reverting. */
const HOLD_MS = 1500;

/** The shared visually-hidden live region, created on first announcement. */
let region: HTMLElement | null = null;

/**
 * Announce `message` to screen readers. The region is re-created if a swap
 * (view transition, client router) disconnected it.
 */
export const announceCopied = (message: string): void => {
  if (!region?.isConnected) {
    region = document.createElement("div");
    region.setAttribute("role", "status");
    region.className = "sr-only";
    document.body.append(region);
  }
  // Clear first so repeating the same message is re-announced.
  region.textContent = "";
  region.textContent = message;
};

/**
 * Copy `text` to the clipboard. Returns whether the write succeeded; failures
 * (insecure context, permissions) are swallowed so callers can simply skip
 * their confirmation.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * A per-affordance flash: `apply(true)` paints the copied state, `apply(false)`
 * reverts it after the hold. Calling the returned function again restarts the
 * hold. `announce` (the localized "Copied" label) is spoken on each flash.
 */
export const createCopyFlash = (
  apply: (copied: boolean) => void,
  announce?: string,
  holdMs: number = HOLD_MS
): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    apply(true);
    if (announce) {
      announceCopied(announce);
    }
    timer = setTimeout(() => apply(false), holdMs);
  };
};

/** Flash timers for {@link flashLabel}, keyed per element. */
const labelTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * The text-swap flash: show `message` in `el`, then restore its own (possibly
 * localized) label after the hold. The original label is captured once, on the
 * first flash — capturing at click time would capture the flash message itself
 * on a double-click and stick until reload.
 */
export const flashLabel = (
  el: HTMLElement,
  message: string,
  holdMs: number = HOLD_MS
): void => {
  el.dataset.blumeLabel ??= el.textContent ?? "";
  el.textContent = message;
  announceCopied(message);
  clearTimeout(labelTimers.get(el));
  labelTimers.set(
    el,
    setTimeout(() => {
      el.textContent = el.dataset.blumeLabel ?? "";
    }, holdMs)
  );
};
