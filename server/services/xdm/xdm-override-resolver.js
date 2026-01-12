import XdmClient from "./xdm-client.js";
import { initStorage } from "../storage.js";

const DEFAULT_OVERRIDE_KEY = "geoGroup";
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const discoveryCache = new Map();

function isInt32(value) {
  return Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX;
}

function parseInt32(value) {
  if (value === null || value === undefined) {
    return { ok: false, value: null, normalized: null };
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return { ok: false, value: null, normalized: null };
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, value: null, normalized: null };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !isInt32(parsed)) {
    return { ok: false, value: null, normalized: null };
  }
  return { ok: true, value: parsed, normalized: String(parsed) };
}

function normalizeKey(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildCacheKey({ dealerId, configName, overrideKey }) {
  return `${dealerId}:${String(configName || "").trim().toLowerCase()}:${String(overrideKey || "")
    .trim()
    .toLowerCase()}`;
}

export function getGeozoneGroupOverrideConfig() {
  const overrideIdEnv = process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID;
  const overrideKeyEnv = process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
  const overrideKey = normalizeKey(overrideKeyEnv, DEFAULT_OVERRIDE_KEY);
  const rawValue = overrideIdEnv ?? overrideKeyEnv ?? DEFAULT_OVERRIDE_KEY;
  const source =
    overrideIdEnv != null
      ? "XDM_GEOZONE_GROUP_OVERRIDE_ID"
      : overrideKeyEnv != null
        ? "XDM_GEOZONE_GROUP_OVERRIDE_KEY"
        : "default";
  const parsed = parseInt32(rawValue);
  return {
    rawValue,
    overrideId: parsed.ok ? parsed.normalized : null,
    overrideNumber: parsed.ok ? parsed.value : null,
    overrideKey,
    source,
    isValid: parsed.ok,
  };
}

function resolveDealerId() {
  const raw = process.env.XDM_DEALER_ID;
  const dealerId = raw != null ? Number(raw) : null;
  if (!Number.isFinite(dealerId)) {
    throw new Error("XDM_DEALER_ID é obrigatório para descobrir overrides do XDM");
  }
  return dealerId;
}

function resolveConfigName() {
  const name = normalizeKey(process.env.XDM_CONFIG_NAME || process.env.XDM_CONFIG_ID, "");
  if (!name) {
    throw new Error(
      "XDM_CONFIG_NAME é obrigatório para descobrir overrides do XDM (ou defina XDM_GEOZONE_GROUP_OVERRIDE_ID).",
    );
  }
  return name;
}

function resolveOverrideKey() {
  return normalizeKey(process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY, DEFAULT_OVERRIDE_KEY);
}

function findMatchingTemplate(results, configName) {
  const normalizedName = String(configName || "").trim().toLowerCase();
  const list = Array.isArray(results) ? results : [];
  const exact = list.find((item) => String(item?.name || "").trim().toLowerCase() === normalizedName);
  if (exact) return exact;
  if (list.length === 1) return list[0];
  return null;
}

async function fetchTemplateByName({ configName, dealerId, correlationId, xdmClient }) {
  const response = await xdmClient.request(
    "POST",
    "/api/external/v1/userTemplates/filter",
    {
      paginator: { firstRecord: 0, itemsPerPage: 50 },
      filter: { name: configName, dealerId },
    },
    { correlationId },
  );

  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const match = findMatchingTemplate(results, configName);
  if (!match?.id) {
    throw new Error(
      `Template do XDM não encontrado para configName="${configName}". Verifique XDM_CONFIG_NAME e o dealerId.`,
    );
  }
  return match;
}

async function fetchTemplateTree({ templateId, correlationId, xdmClient }) {
  return xdmClient.request("GET", `/api/external/v1/userTemplates/${templateId}/GetTree`, null, { correlationId });
}

function matchesOverrideKey(name, overrideKey) {
  return String(name || "").trim().toLowerCase() === String(overrideKey || "").trim().toLowerCase();
}

async function findOverrideElementInCategory({
  templateId,
  categoryId,
  overrideKey,
  correlationId,
  xdmClient,
  visited,
}) {
  if (!categoryId || visited.has(categoryId)) return null;
  visited.add(categoryId);

  const category = await xdmClient.request(
    "GET",
    `/api/external/v1/userTemplates/${templateId}/categories/${categoryId}`,
    null,
    { correlationId },
  );

  const template = category?.elementGroupTemplate;
  const templateElements = Array.isArray(template?.elements) ? template.elements : [];
  const templateMatch = templateElements.find((element) => matchesOverrideKey(element?.name, overrideKey));
  if (templateMatch?.id != null) {
    return templateMatch.id;
  }

  const groupIds = Array.isArray(category?.userElementGroups) ? category.userElementGroups : [];
  for (const group of groupIds) {
    const groupId = group?.id || group;
    if (!groupId) continue;
    const groupInfo = await xdmClient.request(
      "GET",
      `/api/external/v1/userTemplates/${templateId}/categories/${categoryId}/elementGroups/${groupId}`,
      null,
      { correlationId },
    );
    const elements = Array.isArray(groupInfo?.userElements) ? groupInfo.userElements : [];
    const match = elements.find((element) => matchesOverrideKey(element?.name, overrideKey));
    if (match?.id != null) {
      return match.id;
    }
  }

  const subCategories = Array.isArray(category?.subCategories) ? category.subCategories : [];
  for (const subCategory of subCategories) {
    const subId = subCategory?.id || subCategory;
    const found = await findOverrideElementInCategory({
      templateId,
      categoryId: subId,
      overrideKey,
      correlationId,
      xdmClient,
      visited,
    });
    if (found != null) return found;
  }

  return null;
}

async function discoverOverrideElementId({ configName, dealerId, overrideKey, correlationId }) {
  const xdmClient = new XdmClient();
  const template = await fetchTemplateByName({ configName, dealerId, correlationId, xdmClient });
  const templateId = template?.id;
  if (!templateId) {
    throw new Error(`Template do XDM não possui id válido para configName="${configName}".`);
  }

  const tree = await fetchTemplateTree({ templateId, correlationId, xdmClient });
  const categories = Array.isArray(tree?.categories) ? tree.categories : [];
  const visited = new Set();

  for (const category of categories) {
    const categoryId = category?.id || category;
    if (!categoryId) continue;
    const found = await findOverrideElementInCategory({
      templateId,
      categoryId,
      overrideKey,
      correlationId,
      xdmClient,
      visited,
    });
    if (found != null) return found;
  }

  throw new Error(
    `Override "${overrideKey}" não encontrado na configuração "${configName}". Execute o script de discovery ou revise o nome.`,
  );
}

async function discoverOverrideElementIdWithRetry({ configName, dealerId, overrideKey, correlationId }) {
  const attempts = 2;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await discoverOverrideElementId({ configName, dealerId, overrideKey, correlationId });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }
  throw lastError;
}

export async function resolveGeozoneGroupOverrideElementId({ correlationId } = {}) {
  const config = getGeozoneGroupOverrideConfig();
  if (config.isValid) {
    return {
      overrideId: config.overrideId,
      overrideNumber: config.overrideNumber,
      overrideKey: config.overrideKey,
      source: "env",
      configName: process.env.XDM_CONFIG_NAME || process.env.XDM_CONFIG_ID || null,
      dealerId: process.env.XDM_DEALER_ID || null,
    };
  }

  const dealerId = resolveDealerId();
  const configName = resolveConfigName();
  const overrideKey = resolveOverrideKey();
  const cacheKey = buildCacheKey({ dealerId, configName, overrideKey });

  if (discoveryCache.has(cacheKey)) {
    return discoveryCache.get(cacheKey);
  }

  const pending = (async () => {
    await initStorage();
    const { getOverrideElement, upsertOverrideElement } = await import(
      "../../models/xdm-override-element.js"
    );

    const cached = getOverrideElement({ dealerId, configName, overrideKey });
    if (cached?.overrideElementId != null) {
      return {
        overrideId: String(cached.overrideElementId),
        overrideNumber: Number(cached.overrideElementId),
        overrideKey,
        source: "storage",
        configName,
        dealerId,
      };
    }

    const discovered = await discoverOverrideElementIdWithRetry({
      configName,
      dealerId,
      overrideKey,
      correlationId,
    });

    const persisted = upsertOverrideElement({
      dealerId,
      configName,
      overrideKey,
      overrideElementId: discovered,
      source: "discovery",
    });

    return {
      overrideId: String(persisted.overrideElementId ?? discovered),
      overrideNumber: Number(persisted.overrideElementId ?? discovered),
      overrideKey,
      source: "discovery",
      configName,
      dealerId,
    };
  })();

  const guarded = pending.catch((error) => {
    discoveryCache.delete(cacheKey);
    throw error;
  });

  discoveryCache.set(cacheKey, guarded);
  return guarded;
}

export async function discoverGeozoneGroupOverrideElementId({ correlationId } = {}) {
  const dealerId = resolveDealerId();
  const configName = resolveConfigName();
  const overrideKey = resolveOverrideKey();
  const overrideElementId = await discoverOverrideElementIdWithRetry({
    configName,
    dealerId,
    overrideKey,
    correlationId,
  });

  await initStorage();
  const { upsertOverrideElement } = await import("../../models/xdm-override-element.js");
  const persisted = upsertOverrideElement({
    dealerId,
    configName,
    overrideKey,
    overrideElementId,
    source: "discovery",
  });

  return {
    overrideId: String(persisted.overrideElementId ?? overrideElementId),
    overrideNumber: Number(persisted.overrideElementId ?? overrideElementId),
    overrideKey,
    configName,
    dealerId,
    source: "discovery",
  };
}

export async function ensureGeozoneGroupOverrideId({ correlationId } = {}) {
  const resolved = await resolveGeozoneGroupOverrideElementId({ correlationId });
  if (!resolved?.overrideId) {
    throw new Error(
      "Não foi possível determinar o override do geozone group. Rode: node server/scripts/xdm-discover-override-element.js",
    );
  }
  return resolved;
}

export default {
  getGeozoneGroupOverrideConfig,
  resolveGeozoneGroupOverrideElementId,
  discoverGeozoneGroupOverrideElementId,
  ensureGeozoneGroupOverrideId,
};
