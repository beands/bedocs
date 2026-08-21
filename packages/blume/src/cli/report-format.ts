/**
 * Number formatting shared by the translate and eval report renderers. The
 * `1.5s` / `4m 12s` shapes are asserted in both suites — change them in both
 * minds at once.
 */

/** Milliseconds as `1.5s`. */
export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** A dollar cost as `$1.23`, or nothing when the run reported none. */
export const money = (cost: number | undefined): string =>
  cost === undefined ? "" : `$${cost.toFixed(2)}`;

/** Milliseconds as `12.3s` under a minute, `4m 12s` from there up. */
export const duration = (ms: number): string => {
  if (ms < 60_000) {
    return seconds(ms);
  }
  const minutes = Math.floor(ms / 60_000);
  const rest = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${rest}s`;
};
