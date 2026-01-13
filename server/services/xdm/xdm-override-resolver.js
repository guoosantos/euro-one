import createError from "http-errors";

import XdmClient from "./xdm-client.js";
import { initStorage } from "../storage.js";
import { GEOZONE_GROUP_ROLE_LIST } from "./xdm-geozone-group-roles.js";

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

function parseOverrideIdList() {
  return parseCsvEnv(process.env.XDM_GEOZONE_GROUP_OVERRIDE_IDS);
}

function buildCacheKey({ dealerId, configName, overrideKey }) {
  return `${dealerId}:${String(configName || "").trim().toLowerCase()}:${String(overrideKey || "")
    .trim()
    .toLowerCase()}`;
}

export function getGeozoneGroupOverrideConfig({
  overrideId,
  overrideKey,
  fallbackKey = DEFAULT_OVERRIDE_KEY,
  source,
  overrideIdSource,
  overrideKeySource,
} = {}) {
  const overrideIdEnv = overrideId ?? process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID;
  const overrideKeyEnv = overrideKey ?? process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
  const overrideKeyNormalized = normalizeKey(overrideKeyEnv, fallbackKey || DEFAULT_OVERRIDE_KEY);
  const rawValue = overrideIdEnv ?? overrideKeyEnv ?? fallbackKey ?? DEFAULT_OVERRIDE_KEY;
  const resolvedSource =
    source ??
    (overrideIdEnv != null || overrideKeyEnv != null
      ? "env"
      : "default");
  const parsed = parseInt32(rawValue);
  return {
    rawValue,
    overrideId: parsed.ok ? parsed.normalized : null,
    overrideNumber: parsed.ok ? parsed.value : null,
    overrideKey: overrideKeyNormalized,
    source: resolvedSource,
    overrideIdSource: overrideIdSource ?? (overrideIdEnv != null ? "env" : null),
    overrideKeySource: overrideKeySource ?? (overrideKeyEnv != null ? "env" : null),
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
  const listIds = parseOverrideIdList();
  const roleOverrideId =
    process.env[`XDM_GEOZONE_GROUP_OVERRIDE_ID_${roleConfig.envKey}`] ??
    process.env[`XDM_GEOZONE_GROUP_OVERRIDE_ID_${roleIndex}`] ??
    null;
  const overrideId = roleOverrideId ?? listIds[roleIndex - 1] ?? null;
  const overrideIdSource = roleOverrideId != null ? "env" : listIds[roleIndex - 1] != null ? "list" : null;
  const roleOverrideKey =
    process.env[`XDM_GEOZONE_GROUP_OVERRIDE_KEY_${roleConfig.envKey}`] ??
    process.env[`XDM_GEOZONE_GROUP_OVERRIDE_KEY_${roleIndex}`] ??
    null;
  const overrideKey = roleOverrideKey ?? listKeys[roleIndex - 1] ?? null;
  const overrideKeySource = roleOverrideKey != null ? "env" : listKeys[roleIndex - 1] != null ? "list" : null;

  if (roleIndex === 1) {
    const legacyOverrideId = overrideId ?? process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID ?? null;
    const legacyOverrideKey = overrideKey ?? process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY ?? null;
    return {
      overrideId: legacyOverrideId,
      overrideKey: legacyOverrideKey,
      fallbackKey: roleConfig.fallbackKey || DEFAULT_OVERRIDE_KEY,
      overrideIdSource:
        legacyOverrideId == null
          ? null
          : overrideIdSource ?? (process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID != null ? "env" : null),
      overrideKeySource:
        legacyOverrideKey == null
          ? null
          : overrideKeySource ?? (process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY != null ? "env" : null),
    };
  }

  return {
    overrideId,
    overrideKey,
    fallbackKey: roleConfig.fallbackKey,
    overrideIdSource,
    overrideKeySource,
  };
}

export function getGeozoneGroupOverrideConfigByRole(role) {
  const roleConfig = GROUP_OVERRIDE_CONFIG[role];
  if (!roleConfig) {
    throw new Error(`Grupo de override inválido: ${role}`);
  }
  const { overrideId, overrideKey, fallbackKey, overrideIdSource, overrideKeySource } =
    resolveGroupOverrideEnv(roleConfig);
  return getGeozoneGroupOverrideConfig({
    overrideId,
    overrideKey,
    fallbackKey,
    source: overrideIdSource || overrideKeySource || null,
    overrideIdSource,
    overrideKeySource,
  });
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
      source: config.source || "env",
      overrideIdSource: config.overrideIdSource || config.source || "env",
      overrideKeySource: config.overrideKeySource || config.source || "env",
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

function buildOverrideValidationError({ message, status = 400, details }) {
  const error = createError(status, message);
  error.expose = true;
  error.code = "XDM_OVERRIDE_VALIDATION_FAILED";
  error.details = details || null;
  return error;
}

function formatOverrideRoleDetails({ roleKey, config, groupIds }) {
  return {
    role: roleKey,
    overrideId: config?.overrideId ?? null,
    overrideKey: config?.overrideKey ?? null,
    overrideSource: config?.source ?? null,
    overrideIdSource: config?.overrideIdSource ?? null,
    overrideKeySource: config?.overrideKeySource ?? null,
    groupId: groupIds?.[roleKey] ?? null,
  };
}

export async function resolveGeozoneGroupOverrideConfigs({ correlationId } = {}) {
  const configs = {};
  for (const role of GEOZONE_GROUP_ROLE_LIST) {
    const baseConfig = getGeozoneGroupOverrideConfigByRole(role.key);
    const resolved = await ensureGeozoneGroupOverrideId({
      correlationId,
      overrideId: baseConfig.overrideId,
      overrideKey: baseConfig.overrideKey,
    });
    configs[role.key] = {
      ...resolved,
      overrideIdSource: baseConfig.overrideIdSource || resolved.overrideIdSource || resolved.source || null,
      overrideKeySource: baseConfig.overrideKeySource || resolved.overrideKeySource || null,
    };
  }
  return configs;
}

export function validateGeozoneGroupOverrideConfigs({ configs, correlationId, groupIds } = {}) {
  const listIds = parseOverrideIdList();
  if (listIds.length) {
    console.info("[xdm] override list resolved", {
      correlationId,
      overrideIds: listIds,
    });
    if (listIds.length !== 3) {
      throw buildOverrideValidationError({
        message: "XDM_GEOZONE_GROUP_OVERRIDE_IDS deve conter 3 IDs na ordem itinerary, targets, entry.",
        details: { correlationId, overrideIds: listIds },
      });
    }
    const invalidList = listIds.filter((entry) => !parseInt32(entry).ok);
    if (invalidList.length) {
      throw buildOverrideValidationError({
        message: "XDM_GEOZONE_GROUP_OVERRIDE_IDS contém valores inválidos (int32).",
        details: { correlationId, overrideIds: listIds },
      });
    }
  }

  const roles = GEOZONE_GROUP_ROLE_LIST.map((role) => role.key);
  const resolvedEntries = roles.map((roleKey) =>
    formatOverrideRoleDetails({ roleKey, config: configs?.[roleKey], groupIds }),
  );

  const missing = resolvedEntries.filter((entry) => !entry.overrideId || !isInt32(Number(entry.overrideId)));
  if (missing.length) {
    throw buildOverrideValidationError({
      message: "Overrides do XDM inválidos para geozone group (IDs ausentes ou fora de int32).",
      details: { correlationId, roles: resolvedEntries },
    });
  }

  const seen = new Map();
  for (const entry of resolvedEntries) {
    const key = String(entry.overrideId);
    const existing = seen.get(key);
    if (existing) {
      throw buildOverrideValidationError({
        message: "Overrides do XDM devem ser únicos por role (IDs repetidos).",
        details: { correlationId, roles: resolvedEntries },
      });
    }
    seen.set(key, entry.role);
  }
}

export default {
  getGeozoneGroupOverrideConfig,
  getGeozoneGroupOverrideConfigByRole,
  resolveGeozoneGroupOverrideElementId,
  discoverGeozoneGroupOverrideElementId,
  ensureGeozoneGroupOverrideId,
  resolveGeozoneGroupOverrideConfigs,
  validateGeozoneGroupOverrideConfigs,
};
