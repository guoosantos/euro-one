import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "xdm_override_elements";
const overrideElements = loadCollection(STORAGE_KEY, []);

function clone(value) {
  if (!value) return null;
  return JSON.parse(JSON.stringify(value));
}

function persist() {
  saveCollection(STORAGE_KEY, overrideElements);
}

function normalizeKey(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

export function getOverrideElement({ dealerId, configName, overrideKey } = {}) {
  const normalizedDealer = normalizeKey(dealerId);
  const normalizedConfig = normalizeKey(configName);
  const normalizedKey = normalizeKey(overrideKey);
  if (!normalizedKey) return null;
  const entry = overrideElements.find(
    (item) =>
      normalizeKey(item.overrideKey) === normalizedKey &&
      (!normalizedDealer || normalizeKey(item.dealerId) === normalizedDealer) &&
      (!normalizedConfig || normalizeKey(item.configName) === normalizedConfig),
  );
  return clone(entry);
}

export function upsertOverrideElement({
  dealerId,
  configName,
  overrideKey,
  userElementId,
  discoveredAt = new Date().toISOString(),
} = {}) {
  const normalizedDealer = normalizeKey(dealerId);
  const normalizedConfig = normalizeKey(configName);
  const normalizedKey = normalizeKey(overrideKey);
  if (!normalizedKey || userElementId == null) return null;

  const index = overrideElements.findIndex(
    (item) =>
      normalizeKey(item.overrideKey) === normalizedKey &&
      normalizeKey(item.dealerId) === normalizedDealer &&
      normalizeKey(item.configName) === normalizedConfig,
  );

  const record = {
    dealerId: normalizedDealer,
    configName: normalizedConfig,
    overrideKey: normalizedKey,
    userElementId,
    discoveredAt,
  };

  if (index >= 0) {
    overrideElements[index] = record;
  } else {
    overrideElements.push(record);
  }

  persist();
  return clone(record);
}

export function clearOverrideElements() {
  overrideElements.length = 0;
  persist();
}

export default {
  getOverrideElement,
  upsertOverrideElement,
  clearOverrideElements,
};
