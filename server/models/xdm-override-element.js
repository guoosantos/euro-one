import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "xdm_override_elements";
let overrideElements = null;

function getStore() {
  if (!overrideElements) {
    overrideElements = loadCollection(STORAGE_KEY, []);
  }
  return overrideElements;
}

function clone(record) {
  if (!record) return null;
  return JSON.parse(JSON.stringify(record));
}

function persist() {
  if (!overrideElements) return;
  saveCollection(STORAGE_KEY, overrideElements);
}

function buildKey({ dealerId, configName, overrideKey }) {
  return `${dealerId}:${String(configName || "").trim().toLowerCase()}:${String(overrideKey || "")
    .trim()
    .toLowerCase()}`;
}

export function getOverrideElement({ dealerId, configName, overrideKey }) {
  if (dealerId == null || !configName || !overrideKey) return null;
  const store = getStore();
  const key = buildKey({ dealerId, configName, overrideKey });
  const record = store.find((item) => item?.cacheKey === key);
  return clone(record);
}

export function upsertOverrideElement({
  dealerId,
  configName,
  overrideKey,
  overrideElementId,
  source = "manual",
}) {
  if (dealerId == null || !configName || !overrideKey) {
    throw new Error("dealerId, configName e overrideKey são obrigatórios");
  }
  const store = getStore();
  const now = new Date().toISOString();
  const cacheKey = buildKey({ dealerId, configName, overrideKey });
  const index = store.findIndex((item) => item?.cacheKey === cacheKey);
  const payload = {
    cacheKey,
    dealerId: Number(dealerId),
    configName: String(configName),
    overrideKey: String(overrideKey),
    overrideElementId: overrideElementId != null ? Number(overrideElementId) : null,
    source,
    updatedAt: now,
  };

  if (index >= 0) {
    store[index] = { ...store[index], ...payload };
  } else {
    store.push({ ...payload, createdAt: now });
  }

  persist();
  return clone(payload);
}

export function listOverrideElements() {
  const store = getStore();
  return store.map(clone);
}

export default {
  getOverrideElement,
  upsertOverrideElement,
  listOverrideElements,
};
