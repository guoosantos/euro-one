export function createTtlCache(defaultTtlMs = 5_000) {
  const store = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt > Date.now()) {
      return entry.value;
    }
    store.delete(key);
    return null;
  }

  function set(key, value, ttlMs = defaultTtlMs) {
    const ttl = Number.isFinite(ttlMs) ? ttlMs : defaultTtlMs;
    store.set(key, { value, expiresAt: Date.now() + Math.max(0, ttl) });
    return value;
  }

  function del(key) {
    store.delete(key);
  }

  return { get, set, delete: del };
}

export default createTtlCache;
