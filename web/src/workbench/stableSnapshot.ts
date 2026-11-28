// A snapshot reader for `useSyncExternalStore`: it returns the same object while the value's JSON
// text is unchanged. The cache is kept per store and policy, so two mounts with different layouts
// never overwrite each other's snapshot (which would make every read a new object).

/** Returns `read()`'s value, or the one returned last while its JSON text is the same. */
export function createStableSnapshot<T>(): (store: object, policy: object, read: () => T) => T {
  const byStore = new WeakMap<object, WeakMap<object, { text: string; value: T }>>();
  return (store, policy, read) => {
    let byPolicy = byStore.get(store);
    if (byPolicy === undefined) {
      byPolicy = new WeakMap();
      byStore.set(store, byPolicy);
    }
    const value = read();
    const text = JSON.stringify(value);
    const cached = byPolicy.get(policy);
    if (cached !== undefined && cached.text === text) return cached.value;
    byPolicy.set(policy, { text, value });
    return value;
  };
}
