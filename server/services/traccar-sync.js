import { config } from "../config.js";
import { traccarProxy } from "./traccar.js";

const caches = {
  devices: new Map(),
  groups: new Map(),
  drivers: new Map(),
  geofences: new Map(),
};

function toList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function store(cacheKey, list, idKey = "id") {
  const target = caches[cacheKey];
  if (!target) return;
  target.clear();
  list.forEach((item) => {
    if (!item) return;
    const rawId = item[idKey] ?? item.id ?? item.deviceId ?? item.uniqueId;
    if (rawId === undefined || rawId === null) return;
    target.set(String(rawId), item);
  });
}

async function syncResource(cacheKey, url, idKey) {
  try {
    const data = await traccarProxy("get", url, { asAdmin: true });
    const list = toList(data, cacheKey);
    store(cacheKey, list, idKey);
  } catch (error) {
    console.warn(`Falha ao sincronizar ${cacheKey} do Traccar`, error?.message || error);
  }
}

export async function syncTraccarResources() {
  await Promise.all([
    syncResource("devices", "/devices"),
    syncResource("groups", "/groups"),
    syncResource("drivers", "/drivers"),
    syncResource("geofences", "/geofences"),
  ]);
}

export function startTraccarSyncJob() {
  const intervalMs = Number(config.traccar.syncIntervalMs || 300_000);
  let timer = null;

  async function run() {
    await syncTraccarResources();
  }

  run().catch((error) => {
    console.warn("Falha inicial ao sincronizar recursos do Traccar", error?.message || error);
  });

  timer = setInterval(() => {
    run().catch((error) => {
      console.warn("Falha na sincronização periódica do Traccar", error?.message || error);
    });
  }, intervalMs);

  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function getCachedTraccarResources(cacheKey) {
  const cache = caches[cacheKey];
  if (!cache) return [];
  return Array.from(cache.values());
}

export default startTraccarSyncJob;
