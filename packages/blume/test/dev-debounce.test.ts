import { describe, expect, it } from "bun:test";
import { setTimeout as sleep } from "node:timers/promises";

import { debounce } from "perfect-debounce";

/**
 * Pins the perfect-debounce contract `bedocs dev`'s regeneration relies on
 * (see `cli/commands/dev.ts`). Dev regeneration is expensive — a full content
 * re-scan allocating big strings — and a debounce that let a fast burst of
 * watch events start a new scan before the previous finished piled up
 * overlapping scans until the heap was exhausted (observed as an OOM after
 * minutes of looping). These tests fail if a perfect-debounce upgrade ever
 * loses the single-flight or trailing-rerun behavior that fix depends on.
 */

/** A task whose settlement each call is controlled by the test. */
const controllable = () => {
  const resolvers: (() => void)[] = [];
  let starts = 0;
  const task = (): Promise<void> => {
    starts += 1;
    // oxlint-disable-next-line promise/avoid-new -- deferred settled by the test
    return new Promise<void>((resolve) => {
      resolvers.push(resolve);
    });
  };
  return {
    /** Settle the oldest in-flight run. */
    finishNext: () => resolvers.shift()?.(),
    starts: () => starts,
    task,
  };
};

const WAIT_MS = 5;

describe("dev regeneration debounce (perfect-debounce contract)", () => {
  it("collapses a burst before the first run into one run", async () => {
    const c = controllable();
    const run = debounce(c.task, WAIT_MS);

    void run();
    void run();
    void run();
    expect(c.starts()).toBe(0);
    await sleep(WAIT_MS * 4);
    expect(c.starts()).toBe(1);
    c.finishNext();
    await sleep(WAIT_MS * 4);
    expect(c.starts()).toBe(1);
  });

  it("never runs concurrently and reruns once after triggers mid-run", async () => {
    const c = controllable();
    const run = debounce(c.task, WAIT_MS);

    void run();
    await sleep(WAIT_MS * 4);
    expect(c.starts()).toBe(1);

    // Three triggers while #1 is in flight must not start overlapping runs —
    // this is the heap-exhaustion guarantee.
    void run();
    void run();
    void run();
    await sleep(WAIT_MS * 4);
    expect(c.starts()).toBe(1);

    // #1 settles -> exactly one trailing rerun, so the final state is fresh.
    c.finishNext();
    await sleep(WAIT_MS * 4);
    expect(c.starts()).toBe(2);

    c.finishNext();
    await sleep(WAIT_MS * 4);
    expect(c.starts()).toBe(2);
  });

  it("debounces a fresh run after everything settled", async () => {
    const c = controllable();
    const run = debounce(c.task, WAIT_MS);

    void run();
    await sleep(WAIT_MS * 4);
    c.finishNext();
    await sleep(WAIT_MS * 4);
    expect(c.starts()).toBe(1);

    void run();
    expect(c.starts()).toBe(1);
    await sleep(WAIT_MS * 4);
    expect(c.starts()).toBe(2);
    c.finishNext();
  });
});
