import { config } from "../config.js";
import { isTraccarAvailable, isTraccarConfigured, traccarProxy } from "./traccar.js";

const caches = {
  devices: new Map(),
  groups: new Map(),
  drivers: new Map(),
  geofences: new Map(),
};
let warnedUnavailable = false;

const syncState = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  resources: {},
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
  const result = { key: cacheKey, success: true, error: null };

  try {
    const data = await traccarProxy("get", url, { asAdmin: true });
    const list = toList(data, cacheKey);
    store(cacheKey, list, idKey);
  } catch (error) {
    console.warn(`Falha ao sincronizar ${cacheKey} do Traccar`, error?.message || error);
    result.success = false;
    result.error = error?.message || String(error);
  }

  return result;
}

async function syncAllResources() {
  return Promise.all([
    syncResource("devices", "/devices"),
    syncResource("groups", "/groups"),
    syncResource("drivers", "/drivers"),
    syncResource("geofences", "/geofences"),
  ]);
}

export async function syncTraccarResources() {
  if (!isTraccarConfigured()) {
    console.warn("Traccar não configurado; sincronização ignorada.");
    return [];
  }
  if (!isTraccarAvailable()) {
    console.warn("Traccar indisponível; sincronização ignorada.");
    return [];
  }
  return syncAllResources();
}

export function startTraccarSyncJob() {
  if (!isTraccarConfigured()) {
    console.warn("Traccar não configurado; sincronização automática desativada.");
    return () => {};
  }

  if (!isTraccarAvailable()) {
    console.warn("Traccar indisponível; sincronização automática não será iniciada agora.");
    return () => {};
  }

  const intervalMs = Number(config.traccar.syncIntervalMs || 300_000);
  let timer = null;

  async function run() {
    syncState.lastRunAt = new Date().toISOString();
    if (!isTraccarAvailable()) {
      if (!warnedUnavailable) {
        console.warn("Traccar indisponível; aguardando para retomar a sincronização automática.");
        warnedUnavailable = true;
      }
      syncState.lastError = {
        at: syncState.lastRunAt,
        resources: [{ key: "traccar", error: "Serviço indisponível" }],
      };
      return;
    }

    warnedUnavailable = false;

    const results = await syncAllResources();

    syncState.resources = Object.fromEntries(
      results.map(({ key, success, error }) => [key, { success, error }]),
    );

    const failures = results.filter(({ success }) => !success);
    if (failures.length) {
      syncState.lastError = {
        at: syncState.lastRunAt,
        resources: failures.map(({ key, error }) => ({ key, error })),
      };
      return;
    }

    syncState.lastSuccessAt = syncState.lastRunAt;
    syncState.lastError = null;
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

export function getTraccarSyncState() {
  return { ...syncState };
}

export default startTraccarSyncJob;
