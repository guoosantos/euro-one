import XdmClient from "./xdm-client.js";
import { getOverrideElement, upsertOverrideElement } from "../../models/xdm-override-element.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();
const OVERRIDE_ID_ENV = "XDM_GEOZONE_GROUP_OVERRIDE_ID";
const OVERRIDE_KEY_ENV = "XDM_GEOZONE_GROUP_OVERRIDE_KEY";

const KEY_FIELDS = ["key", "elementKey", "settingKey", "configKey", "templateKey", "name"];
const ID_FIELDS = ["userElementId", "userElementID", "elementId", "overrideId", "id"];

function normalizeKey(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function toInt32(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed || !/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < -2147483648 || parsed > 2147483647) return null;
  return parsed;
}

function buildCacheKey({ dealerId, configName, overrideKey }) {
  return [normalizeKey(dealerId) || "-", normalizeKey(configName) || "-", normalizeKey(overrideKey) || "-"].join("|");
}

function getCachedEntry(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setCachedEntry(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function resolveOverrideKey() {
  return normalizeKey(process.env[OVERRIDE_KEY_ENV]) || "geoGroup";
}

function resolveOverrideIdFromEnv() {
  const raw = process.env[OVERRIDE_ID_ENV];
  if (raw == null) return null;
  const parsed = toInt32(raw);
  if (parsed == null) {
    throw new Error(`${OVERRIDE_ID_ENV} deve ser um int32 (ex: 1234).`);
  }
  return parsed;
}

export function getGeozoneGroupOverrideConfig() {
  const overrideKey = resolveOverrideKey();
  const rawOverrideId = process.env[OVERRIDE_ID_ENV];
  const parsed = rawOverrideId != null ? toInt32(rawOverrideId) : null;
  const source = rawOverrideId != null ? OVERRIDE_ID_ENV : overrideKey ? OVERRIDE_KEY_ENV : "default";

  return {
    overrideKey,
    overrideId: parsed,
    source,
    isValid: rawOverrideId == null ? true : parsed != null,
  };
}

function findOverrideElementId(payload, overrideKey) {
  const target = String(overrideKey).trim().toLowerCase();
  const queue = [{ node: payload, depth: 0 }];
  const maxDepth = 8;

  while (queue.length) {
    const { node, depth } = queue.shift();
    if (node === null || node === undefined || depth > maxDepth) continue;

    if (Array.isArray(node)) {
      node.forEach((item) => queue.push({ node: item, depth: depth + 1 }));
      continue;
    }

    if (typeof node !== "object") continue;

    const keys = Object.keys(node);
    const matchedKeyField = keys.find((field) => {
      if (!KEY_FIELDS.includes(field)) return false;
      const value = node[field];
      return typeof value === "string" && value.trim().toLowerCase() === target;
    });

    if (matchedKeyField) {
      for (const idField of ID_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(node, idField)) {
          const parsed = toInt32(node[idField]);
          if (parsed != null) return parsed;
        }
      }
    }

    keys.forEach((key) => {
      queue.push({ node: node[key], depth: depth + 1 });
    });
  }

  return null;
}

async function discoverOverrideId({ overrideKey, dealerId, configName, correlationId }) {
  const xdmClient = new XdmClient();
  const filter = {
    ...(dealerId != null ? { dealerId: Number(dealerId) } : {}),
    ...(configName ? { name: configName } : {}),
    settingsType: 0,
  };
  const payload = {
    paginator: { firstRecord: 0, itemsPerPage: 200 },
    filter,
  };

  const response = await xdmClient.request("POST", "/api/external/v1/AdminTemplates/filter", payload, {
    correlationId,
  });

  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const overrideId = findOverrideElementId(results, overrideKey);
  if (overrideId == null) {
    throw new Error(`Não foi possível encontrar userElementId para key "${overrideKey}" no XDM.`);
  }

  return overrideId;
}

export async function resolveGeozoneGroupOverrideElementId({ correlationId } = {}) {
  const overrideKey = resolveOverrideKey();
  const manualOverrideId = resolveOverrideIdFromEnv();
  if (manualOverrideId != null) {
    return {
      overrideId: manualOverrideId,
      overrideKey,
      source: OVERRIDE_ID_ENV,
    };
  }

  const dealerId = normalizeKey(process.env.XDM_DEALER_ID);
  const configName = normalizeKey(process.env.XDM_CONFIG_NAME || process.env.XDM_CONFIG_ID);
  if (!dealerId) {
    throw new Error("XDM_DEALER_ID é obrigatório para descobrir overrideId.");
  }

  const cacheKey = buildCacheKey({ dealerId, configName, overrideKey });
  const cached = getCachedEntry(cacheKey);
  if (cached) {
    return {
      overrideId: cached.value.overrideId,
      overrideKey,
      source: "cache",
    };
  }

  const stored = getOverrideElement({ dealerId, configName, overrideKey });
  if (stored?.userElementId) {
    const parsed = toInt32(stored.userElementId);
    if (parsed != null) {
      const discoveredAt = stored.discoveredAt ? new Date(stored.discoveredAt).getTime() : 0;
      if (Date.now() - discoveredAt < CACHE_TTL_MS) {
        setCachedEntry(cacheKey, { overrideId: parsed });
        return {
          overrideId: parsed,
          overrideKey,
          source: "storage",
        };
      }
    }
  }

  const discovered = await discoverOverrideId({ overrideKey, dealerId, configName, correlationId });
  upsertOverrideElement({
    dealerId,
    configName,
    overrideKey,
    userElementId: discovered,
  });
  setCachedEntry(cacheKey, { overrideId: discovered });

  return {
    overrideId: discovered,
    overrideKey,
    source: "xdm",
  };
}

export default {
  getGeozoneGroupOverrideConfig,
  resolveGeozoneGroupOverrideElementId,
};
