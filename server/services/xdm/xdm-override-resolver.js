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
const XG37_OVERRIDE_KEYS_BY_GROUP = {
  itinerary: "Itinerario",
  targets: "Alvos",
  entry: "Entrada",
};
const GROUP_OVERRIDE_CONFIG = {
  itinerary: { index: 1, envKey: "ITINERARY" },
  targets: { index: 2, envKey: "TARGETS" },
  entry: { index: 3, envKey: "ENTRY" },
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

function normalizeConfigName(value) {
  return String(value || "").trim().toLowerCase();
}

function isXg37EuroConfigName(value) {
  const normalized = normalizeConfigName(value);
  if (!normalized) return false;
  return normalized.includes("xg37") && normalized.includes("euro");
}

function resolveFallbackKeyForRole(roleKey) {
  const configName = process.env.XDM_CONFIG_NAME || "";
  const xg37Fallback = isXg37EuroConfigName(configName)
    ? XG37_OVERRIDE_KEYS_BY_GROUP[roleKey]
    : null;
  return xg37Fallback || DEFAULT_OVERRIDE_KEYS_BY_GROUP[roleKey] || DEFAULT_OVERRIDE_KEY;
}

function resolveFallbackKeyCandidates(roleKey) {
  const fallback = DEFAULT_OVERRIDE_KEYS_BY_GROUP[roleKey] || DEFAULT_OVERRIDE_KEY;
  const xg37 = XG37_OVERRIDE_KEYS_BY_GROUP[roleKey];
  const configName = process.env.XDM_CONFIG_NAME || "";
  const preferXg37 = isXg37EuroConfigName(configName);
  const ordered = preferXg37 ? [xg37, fallback] : [fallback, xg37];
  return ordered.filter(Boolean);
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
  allowLegacyFallback = true,
} = {}) {
  const legacyOverrideId = allowLegacyFallback ? process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID : null;
  const legacyOverrideKey = allowLegacyFallback ? process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY : null;
  const overrideIdEnv = overrideId ?? legacyOverrideId;
  const overrideKeyEnv = overrideKey ?? legacyOverrideKey;
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
    allowLegacyFallback,
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
      fallbackKey: resolveFallbackKeyForRole("itinerary"),
      allowLegacyFallback: true,
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
    fallbackKey: resolveFallbackKeyForRole(roleConfig.envKey.toLowerCase()),
    allowLegacyFallback: false,
    overrideIdSource,
    overrideKeySource,
  };
}

export function getGeozoneGroupOverrideConfigByRole(role) {
  const roleConfig = GROUP_OVERRIDE_CONFIG[role];
  if (!roleConfig) {
    throw new Error(`Grupo de override inválido: ${role}`);
  }
  const { overrideId, overrideKey, fallbackKey, overrideIdSource, overrideKeySource, allowLegacyFallback } =
    resolveGroupOverrideEnv(roleConfig);
  return getGeozoneGroupOverrideConfig({
    overrideId,
    overrideKey,
    fallbackKey,
    source: overrideIdSource || overrideKeySource || null,
    overrideIdSource,
    overrideKeySource,
    allowLegacyFallback,
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

function normalizeDiscoveryText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function collectLabelCandidates(entry) {
  if (!entry || typeof entry !== "object") return [];
  return [entry.name, entry.caption, entry.label, entry.title, entry.description]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function matchesGeozoneGroupLabel(value) {
  const normalized = normalizeDiscoveryText(value);
  if (!normalized) return false;
  if (normalized.includes("geozonegroup") || normalized.includes("geozonesgroup")) return true;
  return normalized.includes("geozone") && normalized.includes("group");
}

function isGeofencingCategory(category) {
  const labels = collectLabelCandidates(category);
  return labels.some((label) => {
    const normalized = normalizeDiscoveryText(label);
    return normalized.includes("geofencing") || normalized.includes("geofence") || normalized.includes("geozone");
  });
}

function resolveElementLabel(element) {
  const labels = collectLabelCandidates(element);
  return labels[0] || "";
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

async function collectGeozoneGroupCandidatesInCategory({
  templateId,
  categoryId,
  correlationId,
  xdmClient,
  visited,
  inGeofencing,
  candidates,
  seenIds,
}) {
  if (!categoryId || visited.has(categoryId)) return;
  visited.add(categoryId);

  const category = await xdmClient.request(
    "GET",
    `/api/external/v1/userTemplates/${templateId}/categories/${categoryId}`,
    null,
    { correlationId },
  );

  const isGeofencing = inGeofencing || isGeofencingCategory(category);
  const categoryLabel = resolveElementLabel(category);

  if (isGeofencing) {
    const template = category?.elementGroupTemplate;
    const templateElements = Array.isArray(template?.elements) ? template.elements : [];
    for (const element of templateElements) {
      const labels = collectLabelCandidates(element);
      if (!labels.some(matchesGeozoneGroupLabel)) continue;
      const elementId = element?.id;
      if (elementId == null || seenIds.has(elementId)) continue;
      seenIds.add(elementId);
      candidates.push({
        id: elementId,
        label: resolveElementLabel(element),
        name: element?.name || null,
        category: categoryLabel || null,
      });
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
      for (const element of elements) {
        const labels = collectLabelCandidates(element);
        if (!labels.some(matchesGeozoneGroupLabel)) continue;
        const elementId = element?.id;
        if (elementId == null || seenIds.has(elementId)) continue;
        seenIds.add(elementId);
        candidates.push({
          id: elementId,
          label: resolveElementLabel(element),
          name: element?.name || null,
          category: categoryLabel || null,
        });
      }
    }
  }

  const subCategories = Array.isArray(category?.subCategories) ? category.subCategories : [];
  for (const subCategory of subCategories) {
    const subId = subCategory?.id || subCategory;
    await collectGeozoneGroupCandidatesInCategory({
      templateId,
      categoryId: subId,
      correlationId,
      xdmClient,
      visited,
      inGeofencing: isGeofencing,
      candidates,
      seenIds,
    });
  }
}

async function discoverOverrideElementIdByIndex({
  templateId,
  categories,
  index,
  correlationId,
  xdmClient,
  roleKey,
  configName,
  dealerId,
}) {
  const visited = new Set();
  const candidates = [];
  const seenIds = new Set();
  for (const category of categories) {
    const categoryId = category?.id || category;
    if (!categoryId) continue;
    await collectGeozoneGroupCandidatesInCategory({
      templateId,
      categoryId,
      correlationId,
      xdmClient,
      visited,
      inGeofencing: false,
      candidates,
      seenIds,
    });
  }

  console.info("[xdm] override discovery fallback", {
    correlationId,
    configName,
    dealerId,
    role: roleKey || null,
    discoveryMode: "by_index",
    candidates: candidates.map((candidate, candidateIndex) => ({
      index: candidateIndex + 1,
      id: candidate.id,
      name: candidate.name,
      label: candidate.label,
      category: candidate.category,
    })),
  });

  const selected = candidates[index - 1] || null;
  return {
    overrideElementId: selected?.id ?? null,
    candidates,
  };
}

async function discoverOverrideElementId({ configName, dealerId, overrideKey, correlationId, roleKey }) {
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
    if (found != null) {
      return { overrideElementId: found, discoveryMode: "by_key" };
    }
  }

  if (roleKey && GROUP_OVERRIDE_CONFIG[roleKey]) {
    const { index } = GROUP_OVERRIDE_CONFIG[roleKey];
    const fallback = await discoverOverrideElementIdByIndex({
      templateId,
      categories,
      index,
      correlationId,
      xdmClient,
      roleKey,
      configName,
      dealerId,
    });
    if (fallback?.overrideElementId != null) {
      return { overrideElementId: fallback.overrideElementId, discoveryMode: "by_index" };
    }
    throw new Error(
      `Override "${overrideKey}" não encontrado na configuração "${configName}" (fallback por índice ${index} sem candidatos).`,
    );
  }

  throw new Error(
    `Override "${overrideKey}" não encontrado na configuração "${configName}". Execute o script de discovery ou revise o nome.`,
  );
}

async function discoverOverrideElementIdWithRetry({ configName, dealerId, overrideKey, correlationId, roleKey }) {
  const attempts = 2;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await discoverOverrideElementId({ configName, dealerId, overrideKey, correlationId, roleKey });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }
  throw lastError;
}

async function resolveOverrideElementIdFromDiscovery({
  configName,
  dealerId,
  overrideKeyResolved,
  correlationId,
  roleKey,
} = {}) {
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
      roleKey,
    });

    const discoveredId = discovered?.overrideElementId ?? discovered;
    const persisted = upsertOverrideElement({
      dealerId,
      configName,
      overrideKey: overrideKeyResolved,
      overrideElementId: discoveredId,
      source: "discovery",
    });

    return {
      overrideId: String(persisted.overrideElementId ?? discoveredId),
      overrideNumber: Number(persisted.overrideElementId ?? discoveredId),
      overrideKey: overrideKeyResolved,
      source: "discovery",
      configName,
      dealerId,
      discoveryMode: discovered?.discoveryMode ?? null,
    };
  })();

  const guarded = pending.catch((error) => {
    discoveryCache.delete(cacheKey);
    throw error;
  });

  discoveryCache.set(cacheKey, guarded);
  return guarded;
}

export async function resolveGeozoneGroupOverrideElementId({
  correlationId,
  overrideId,
  overrideKey,
  allowLegacyFallback = true,
  roleKey,
} = {}) {
  const config = getGeozoneGroupOverrideConfig({ overrideId, overrideKey, allowLegacyFallback });
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
      discoveryMode: null,
    };
  }

  const dealerId = resolveDealerId();
  const configName = resolveConfigName();
  const overrideKeyResolved = resolveOverrideKey(config.overrideKey);
  const fallbackCandidates = resolveFallbackKeyCandidates(roleKey);
  const orderedCandidates = [];
  if (roleKey && fallbackCandidates.length) {
    orderedCandidates.push(...fallbackCandidates);
    if (overrideKeyResolved && !fallbackCandidates.includes(overrideKeyResolved)) {
      orderedCandidates.push(overrideKeyResolved);
    }
  } else {
    orderedCandidates.push(overrideKeyResolved);
    orderedCandidates.push(...fallbackCandidates);
  }
  const attempts = Array.from(new Set(orderedCandidates)).filter(Boolean);
  const errors = [];

  for (const candidate of attempts) {
    try {
      return await resolveOverrideElementIdFromDiscovery({
        configName,
        dealerId,
        overrideKeyResolved: candidate,
        correlationId,
        roleKey,
      });
    } catch (error) {
      errors.push({ overrideKey: candidate, message: error?.message || String(error) });
    }
  }

  const attempted = attempts.join(", ");
  const last = errors[errors.length - 1];
  const message = [
    `Override "${overrideKeyResolved}" não encontrado na configuração "${configName}".`,
    roleKey ? `role=${roleKey}` : null,
    config.overrideId != null ? `overrideId=${config.overrideId}` : null,
    `tentou [${attempted}]`,
    `último erro: ${last?.message || "desconhecido"}`,
  ]
    .filter(Boolean)
    .join(" ");
  const resolvedError = new Error(message);
  resolvedError.attemptedOverrideKeys = attempts;
  resolvedError.overrideKeyResolved = overrideKeyResolved;
  resolvedError.overrideId = config.overrideId ?? null;
  resolvedError.roleKey = roleKey || null;
  resolvedError.configName = configName;
  resolvedError.errors = errors;
  throw resolvedError;
}

export async function discoverGeozoneGroupOverrideElementId({ correlationId, overrideKey, roleKey } = {}) {
  const dealerId = resolveDealerId();
  const configName = resolveConfigName();
  const overrideKeyResolved = resolveOverrideKey(overrideKey);
  const discovered = await discoverOverrideElementIdWithRetry({
    configName,
    dealerId,
    overrideKey: overrideKeyResolved,
    correlationId,
    roleKey,
  });
  const overrideElementId = discovered?.overrideElementId ?? discovered;

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
    discoveryMode: discovered?.discoveryMode ?? null,
  };
}

export async function ensureGeozoneGroupOverrideId({
  correlationId,
  overrideId,
  overrideKey,
  allowLegacyFallback = true,
  roleKey,
} = {}) {
  const resolved = await resolveGeozoneGroupOverrideElementId({
    correlationId,
    overrideId,
    overrideKey,
    allowLegacyFallback,
    roleKey,
  });
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
    let resolved;
    try {
      resolved = await ensureGeozoneGroupOverrideId({
        correlationId,
        overrideId: baseConfig.overrideId,
        overrideKey: baseConfig.overrideKey,
        allowLegacyFallback: baseConfig.allowLegacyFallback ?? false,
        roleKey: role.key,
      });
    } catch (error) {
      const configName = process.env.XDM_CONFIG_NAME || process.env.XDM_CONFIG_ID || null;
      const roles = GEOZONE_GROUP_ROLE_LIST.map((entry) => {
        const roleConfig = getGeozoneGroupOverrideConfigByRole(entry.key);
        return {
          role: entry.key,
          overrideKey: roleConfig.overrideKey ?? null,
          overrideId: roleConfig.overrideId ?? null,
        };
      });
      const attempted = Array.isArray(error?.attemptedOverrideKeys)
        ? error.attemptedOverrideKeys.filter(Boolean).join(", ")
        : "";
      const resolvedOverrideKey = baseConfig.overrideKey || error?.overrideKeyResolved || null;
      throw buildOverrideValidationError({
        message: [
          `Override do XDM não encontrado para role "${role.key}".`,
          resolvedOverrideKey ? `overrideKey=${resolvedOverrideKey}` : null,
          baseConfig.overrideId != null || error?.overrideId != null
            ? `overrideId=${baseConfig.overrideId ?? error?.overrideId}`
            : null,
          attempted ? `tentou [${attempted}]` : null,
        ]
          .filter(Boolean)
          .join(" "),
        details: {
          correlationId,
          configName,
          role: role.key,
          overrideKey: resolvedOverrideKey,
          overrideId: baseConfig.overrideId ?? error?.overrideId ?? null,
          attemptedOverrideKeys: error?.attemptedOverrideKeys || [],
          errors: error?.errors || null,
          roles,
        },
      });
    }
    configs[role.key] = {
      ...resolved,
      overrideIdSource: baseConfig.overrideIdSource || resolved.overrideIdSource || resolved.source || null,
      overrideKeySource: baseConfig.overrideKeySource || resolved.overrideKeySource || null,
    };
    console.info("[xdm] geozone group override resolved", {
      correlationId,
      configName: resolved.configName,
      dealerId: resolved.dealerId,
      role: role.key,
      overrideKey: resolved.overrideKey,
      overrideId: resolved.overrideId,
      source: resolved.source || null,
      overrideIdSource: configs[role.key].overrideIdSource || null,
      overrideKeySource: configs[role.key].overrideKeySource || null,
      discoveryMode: resolved.discoveryMode || null,
    });
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
        message: `Overrides do XDM devem ser únicos por role (IDs repetidos). Duplicado: ${key} (${existing} x ${entry.role}).`,
        details: {
          correlationId,
          duplicate: {
            overrideId: key,
            roleA: existing,
            roleB: entry.role,
          },
          roles: resolvedEntries,
        },
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
