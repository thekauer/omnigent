/**
 * A promise or other thenable. Checked by shape: a page can replace the global
 * `Promise` (zone.js does), and an async function still returns the native one,
 * so `instanceof Promise` misses one or the other.
 */
export function isThenable<T>(value: unknown): value is PromiseLike<T> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
