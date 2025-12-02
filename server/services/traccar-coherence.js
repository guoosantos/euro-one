import { createTtlCache } from "../utils/ttl-cache.js";
import { fetchDevicesMetadata, isTraccarDbConfigured } from "./traccar-db.js";
import { getCachedTraccarResources, syncTraccarResources } from "./traccar-sync.js";

const cache = createTtlCache(60_000);
const CACHE_KEY = "traccar-db-devices";

function buildIndex(list) {
  const ids = new Set();
  const uniques = new Set();
  (list || []).forEach((item) => {
    if (!item) return;
    if (item.id !== undefined && item.id !== null) ids.add(String(item.id));
    if (item.uniqueId) uniques.add(String(item.uniqueId));
  });
  return { ids, uniques };
}

export async function ensureTraccarRegistryConsistency(overrides = {}) {
  const {
    dbConfigured = isTraccarDbConfigured,
    loadDbDevices = fetchDevicesMetadata,
    loadApiDevices = () => getCachedTraccarResources("devices"),
    refreshApiDevices = syncTraccarResources,
  } = overrides;

  if (!dbConfigured()) {
    return { checked: false, refreshed: false };
  }

  let dbDevices = cache.get(CACHE_KEY);
  if (!dbDevices) {
    dbDevices = await loadDbDevices();
    cache.set(CACHE_KEY, dbDevices);
  }

  const apiDevices = loadApiDevices();
  const dbIndex = buildIndex(dbDevices);
  const apiIndex = buildIndex(apiDevices);

  const missingInApi = Array.from(dbIndex.ids).filter((id) => !apiIndex.ids.has(id));
  const missingInDb = Array.from(apiIndex.ids).filter((id) => !dbIndex.ids.has(id));
  const uniqueMismatch = Array.from(dbIndex.uniques).filter((unique) => !apiIndex.uniques.has(unique));

  const hasMismatch = missingInApi.length > 0 || missingInDb.length > 0 || uniqueMismatch.length > 0;
  if (hasMismatch) {
    cache.delete(CACHE_KEY);
    await refreshApiDevices();
    return {
      checked: true,
      refreshed: true,
      missingInApi,
      missingInDb,
      uniqueMismatch,
    };
  }

  return { checked: true, refreshed: false };
}

export function __resetTraccarCoherenceCache() {
  cache.clear();
}
