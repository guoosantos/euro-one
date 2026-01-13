import XdmClient from "./xdm-client.js";
import { initStorage } from "../storage.js";

const DEFAULT_OVERRIDE_KEY = "geoGroup";
const DEFAULT_OVERRIDE_KEYS_BY_GROUP = {
  itinerary: "geoGroup1",
  targets: "geoGroup2",
  entry: "geoGroup3",
};
const GROUP_OVERRIDE_CONFIG = {
  itinerary: { index: 1, envKey: "ITINERARY", fallbackKey: DEFAULT_OVERRIDE_KEYS_BY_GROUP.itinerary },
  targets: { index: 2, envKey: "TARGETS", fallbackKey: DEFAULT_OVERRIDE_KEYS_BY_GROUP.targets },
  entry: { index: 3, envKey: "ENTRY", fallbackKey: DEFAULT_OVERRIDE_KEYS_BY_GROUP.entry },
};
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const discoveryCache = new Map();

export function getGeozoneGroupRoleConfig(role) {
  const roleConfig = GROUP_OVERRIDE_CONFIG[role];
  if (!roleConfig) {
    throw new Error(`Grupo de override inválido: ${role}`);
  }
  return roleConfig;
}

function uniqueValues(values) {
  const normalized = values.filter((value) => value != null);
  return new Set(normalized).size === normalized.length;
}

function validateGroupOverrideMappings() {
  const keysList = parseCsvEnv(process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEYS);
  const idsList = parseCsvEnv(process.env.XDM_GEOZONE_GROUP_OVERRIDE_IDS);
  if (keysList.length) {
    if (keysList.length !== Object.keys(GROUP_OVERRIDE_CONFIG).length) {
      throw new Error("XDM_GEOZONE_GROUP_OVERRIDE_KEYS deve ter exatamente 3 itens (itinerary,targets,entry)");
    }
    const expected = [
      GROUP_OVERRIDE_CONFIG.itinerary.fallbackKey,
      GROUP_OVERRIDE_CONFIG.targets.fallbackKey,
      GROUP_OVERRIDE_CONFIG.entry.fallbackKey,
    ];
    const normalized = keysList.map((entry) => String(entry || "").trim());
    const mismatch = normalized
      .slice(0, expected.length)
      .some((value, index) => value && value !== expected[index]);
    if (mismatch) {
      throw new Error(
        `XDM_GEOZONE_GROUP_OVERRIDE_KEYS deve seguir a ordem itinerary,targets,entry (${expected.join(
          ",",
        )}). Valor atual: ${normalized.join(",")}`,
      );
    }
  }

  if (idsList.length && idsList.length !== Object.keys(GROUP_OVERRIDE_CONFIG).length) {
    throw new Error("XDM_GEOZONE_GROUP_OVERRIDE_IDS deve ter exatamente 3 itens (itinerary,targets,entry)");
  }

  const byRoleIds = Object.values(GROUP_OVERRIDE_CONFIG)
    .map((roleConfig) => process.env[`XDM_GEOZONE_GROUP_OVERRIDE_ID_${roleConfig.envKey}`])
    .filter(Boolean);
  if (byRoleIds.length && !uniqueValues(byRoleIds)) {
    throw new Error("Overrides de geozone group duplicados entre roles (IDs por role)");
  }
  if (idsList.length && !uniqueValues(idsList)) {
    throw new Error("Overrides de geozone group duplicados em XDM_GEOZONE_GROUP_OVERRIDE_IDS");
  }
}

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

function parseCsvEnv(value) {
  if (value == null) return [];
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildCacheKey({ dealerId, configName, overrideKey }) {
  return `${dealerId}:${String(configName || "").trim().toLowerCase()}:${String(overrideKey || "")
    .trim()
    .toLowerCase()}`;
}

export function getGeozoneGroupOverrideConfig({ overrideId, overrideKey, fallbackKey = DEFAULT_OVERRIDE_KEY } = {}) {
  const overrideIdEnv = overrideId ?? process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID;
  const overrideKeyEnv = overrideKey ?? process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
  const overrideKeyNormalized = normalizeKey(overrideKeyEnv, fallbackKey || DEFAULT_OVERRIDE_KEY);
  const rawValue = overrideIdEnv ?? overrideKeyEnv ?? fallbackKey ?? DEFAULT_OVERRIDE_KEY;
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
    overrideKey: overrideKeyNormalized,
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

function resolveOverrideKey(value) {
  return normalizeKey(value ?? process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY, DEFAULT_OVERRIDE_KEY);
}

function resolveGroupOverrideEnv(roleConfig) {
  const roleIndex = roleConfig.index;
  const listKeys = parseCsvEnv(process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEYS);
  const listIds = parseCsvEnv(process.env.XDM_GEOZONE_GROUP_OVERRIDE_IDS);
  const overrideId =
    process.env[`XDM_GEOZONE_GROUP_OVERRIDE_ID_${roleConfig.envKey}`] ??
    process.env[`XDM_GEOZONE_GROUP_OVERRIDE_ID_${roleIndex}`] ??
    listIds[roleIndex - 1] ??
    null;
  const overrideKey =
    process.env[`XDM_GEOZONE_GROUP_OVERRIDE_KEY_${roleConfig.envKey}`] ??
    process.env[`XDM_GEOZONE_GROUP_OVERRIDE_KEY_${roleIndex}`] ??
    listKeys[roleIndex - 1] ??
    null;

  if (roleIndex === 1) {
    return {
      overrideId: overrideId ?? process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID ?? null,
      overrideKey: overrideKey ?? process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY ?? null,
      fallbackKey: roleConfig.fallbackKey || DEFAULT_OVERRIDE_KEY,
    };
  }

  return {
    overrideId,
    overrideKey,
    fallbackKey: roleConfig.fallbackKey,
  };
}

export function getGeozoneGroupOverrideConfigByRole(role) {
  const roleConfig = getGeozoneGroupRoleConfig(role);
  const { overrideId, overrideKey, fallbackKey } = resolveGroupOverrideEnv(roleConfig);
  return getGeozoneGroupOverrideConfig({ overrideId, overrideKey, fallbackKey });
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

export async function resolveGeozoneGroupOverrideElementId({ correlationId, overrideId, overrideKey } = {}) {
  const config = getGeozoneGroupOverrideConfig({ overrideId, overrideKey });
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
  const overrideKeyResolved = resolveOverrideKey(config.overrideKey);
  const cacheKey = buildCacheKey({ dealerId, configName, overrideKey: overrideKeyResolved });

  if (discoveryCache.has(cacheKey)) {
    return discoveryCache.get(cacheKey);
  }

  const pending = (async () => {
    await initStorage();
    const { getOverrideElement, upsertOverrideElement } = await import(
      "../../models/xdm-override-element.js"
    );

    const cached = getOverrideElement({ dealerId, configName, overrideKey: overrideKeyResolved });
    if (cached?.overrideElementId != null) {
      return {
        overrideId: String(cached.overrideElementId),
        overrideNumber: Number(cached.overrideElementId),
        overrideKey: overrideKeyResolved,
        source: "storage",
        configName,
        dealerId,
      };
    }

    const discovered = await discoverOverrideElementIdWithRetry({
      configName,
      dealerId,
      overrideKey: overrideKeyResolved,
      correlationId,
    });

    const persisted = upsertOverrideElement({
      dealerId,
      configName,
      overrideKey: overrideKeyResolved,
      overrideElementId: discovered,
      source: "discovery",
    });

    return {
      overrideId: String(persisted.overrideElementId ?? discovered),
      overrideNumber: Number(persisted.overrideElementId ?? discovered),
      overrideKey: overrideKeyResolved,
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

export async function discoverGeozoneGroupOverrideElementId({ correlationId, overrideKey } = {}) {
  const dealerId = resolveDealerId();
  const configName = resolveConfigName();
  const overrideKeyResolved = resolveOverrideKey(overrideKey);
  const overrideElementId = await discoverOverrideElementIdWithRetry({
    configName,
    dealerId,
    overrideKey: overrideKeyResolved,
    correlationId,
  });

  await initStorage();
  const { upsertOverrideElement } = await import("../../models/xdm-override-element.js");
  const persisted = upsertOverrideElement({
    dealerId,
    configName,
    overrideKey: overrideKeyResolved,
    overrideElementId,
    source: "discovery",
  });

  return {
    overrideId: String(persisted.overrideElementId ?? overrideElementId),
    overrideNumber: Number(persisted.overrideElementId ?? overrideElementId),
    overrideKey: overrideKeyResolved,
    configName,
    dealerId,
    source: "discovery",
  };
}

export async function ensureGeozoneGroupOverrideId({ correlationId, overrideId, overrideKey } = {}) {
  const resolved = await resolveGeozoneGroupOverrideElementId({ correlationId, overrideId, overrideKey });
  if (!resolved?.overrideId) {
    throw new Error(
      "Não foi possível determinar o override do geozone group. Rode: node server/scripts/xdm-discover-override-element.js",
    );
  }
  return resolved;
}

export default {
  getGeozoneGroupOverrideConfig,
  getGeozoneGroupOverrideConfigByRole,
  getGeozoneGroupRoleConfig,
  validateGroupOverrideMappings,
  resolveGeozoneGroupOverrideElementId,
  discoverGeozoneGroupOverrideElementId,
  ensureGeozoneGroupOverrideId,
};
