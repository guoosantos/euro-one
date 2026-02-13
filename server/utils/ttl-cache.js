export function createTtlCache(defaultTtlMs = 5_000, options = {}) {
  let resolvedTtlMs = defaultTtlMs;
  let resolvedMaxSize = options?.maxSize ?? 0;
  if (defaultTtlMs && typeof defaultTtlMs === "object") {
    resolvedTtlMs = Number(defaultTtlMs.defaultTtlMs ?? 5_000);
    resolvedMaxSize = Number(defaultTtlMs.maxSize ?? 0);
  }
  const store = new Map();

  const maxSize = Number.isFinite(resolvedMaxSize) && resolvedMaxSize > 0 ? resolvedMaxSize : 0;

  function get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt > Date.now()) {
      // Refresh LRU order.
      store.delete(key);
      store.set(key, entry);
      return entry.value;
    }
    store.delete(key);
    return null;
  }

  function set(key, value, ttlMs = resolvedTtlMs) {
    const ttl = Number.isFinite(ttlMs) ? ttlMs : resolvedTtlMs;
    if (store.has(key)) {
      store.delete(key);
    }
    store.set(key, { value, expiresAt: Date.now() + Math.max(0, ttl) });
    if (maxSize && store.size > maxSize) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }
    return value;
  }

  function del(key) {
    store.delete(key);
  }

  function clear() {
    store.clear();
  }

  return { get, set, delete: del, clear };
}

export default createTtlCache;
