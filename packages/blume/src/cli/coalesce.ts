/**
 * Wrap an async task so it never runs concurrently with itself. Triggering the
 * returned function while a run is in flight coalesces into a single trailing
 * run after the current one settles.
 *
 * Dev regeneration (`scanProject` + `generateRuntime`) is expensive on a large
 * project — a full content re-scan that allocates big strings. A plain debounce
 * still lets a fast burst of watch events (or, before it was fixed, a `.bedocs/`
 * watch storm) start a new scan before the previous finished, piling up
 * overlapping scans until the heap is exhausted (observed as an OOM after
 * minutes of looping). Single-flighting bounds it to one scan at a time while
 * still guaranteeing a final run reflects the latest change.
 *
 * The task must not reject: a rejection would surface as an unhandled promise
 * rejection, so callers handle their own errors and always resolve.
 */
export const coalescedRunner = (task: () => Promise<void>): (() => void) => {
  let inFlight: Promise<void> | null = null;
  let pending = false;

  // Drain any run requested during the current run, then release the lock. The
  // `inFlight` promise is assigned synchronously by the caller below, so a
  // re-entrant trigger sees the lock immediately and only sets `pending`.
  const cycle = async (): Promise<void> => {
    try {
      do {
        pending = false;
        // oxlint-disable-next-line no-await-in-loop -- serialized by design
        await task();
      } while (pending);
    } finally {
      inFlight = null;
    }
  };

  return () => {
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = cycle();
  };
};
