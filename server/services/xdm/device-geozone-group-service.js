import crypto from "node:crypto";
import createError from "http-errors";

import XdmClient from "./xdm-client.js";
import { syncGeozoneGroup, syncGeozoneGroupForGeofences } from "./geozone-group-sync-service.js";
import { buildOverridesDto, normalizeXdmDeviceUid, normalizeXdmId } from "./xdm-utils.js";
import {
  getGeozoneGroupOverrideConfigByRole,
  resolveGeozoneGroupOverrideConfigs,
  validateGeozoneGroupOverrideConfigs,
} from "./xdm-override-resolver.js";
import { wrapXdmError } from "./xdm-error.js";
import { getClientById } from "../../models/client.js";
import { fallbackClientDisplayName } from "./xdm-name-utils.js";
import { GEOZONE_GROUP_ROLE_LIST, ITINERARY_GEOZONE_GROUPS } from "./xdm-geozone-group-roles.js";

const DEFAULT_ROLLOUT_TYPE = 0; // XT_CONFIG

function buildCorrelationId({ deviceUid, groupHash }) {
  const payload = `${deviceUid || ""}|${groupHash || ""}|${Date.now()}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 20);
}

async function resolveClientDisplayName(clientId) {
  if (!clientId) return fallbackClientDisplayName(clientId);
  try {
    const client = await getClientById(clientId);
    return client?.name || fallbackClientDisplayName(clientId);
  } catch (error) {
    console.warn("[xdm] falha ao carregar cliente para nome amigável", {
      clientId,
      message: error?.message || error,
    });
    return fallbackClientDisplayName(clientId);
  }
}

async function resolveConfigId({ deviceUid, correlationId }) {
  const normalizedDeviceUid = normalizeXdmDeviceUid(deviceUid, { context: "resolveConfigId" });
  const xdmClient = new XdmClient();
  const configs = await xdmClient.request(
    "POST",
    "/api/external/v3/configs/forDevices",
    { uids: [normalizedDeviceUid] },
    { correlationId },
  );

  const configuredId = process.env.XDM_CONFIG_ID ? Number(process.env.XDM_CONFIG_ID) : null;
  if (Number.isFinite(configuredId)) {
    return configuredId;
  }

  const configuredName = process.env.XDM_CONFIG_NAME ? String(process.env.XDM_CONFIG_NAME).trim().toLowerCase() : null;
  if (configuredName) {
    const matched = (configs || []).find((item) => String(item.name || "").toLowerCase() === configuredName);
    if (matched?.id != null) {
      return Number(matched.id);
    }
  }

  if (Array.isArray(configs) && configs.length === 1 && configs[0]?.id != null) {
    return Number(configs[0].id);
  }

  throw new Error(
    "Não foi possível determinar a configuração do XDM para o dispositivo (configure XDM_CONFIG_ID ou XDM_CONFIG_NAME)",
  );
}

async function applyOverrides({ deviceUid, overrides, correlationId, roleDetails }) {
  if (!overrides || typeof overrides !== "object") {
    throw new Error("Overrides inválidos para aplicar no XDM");
  }
  const normalizedDeviceUid = normalizeXdmDeviceUid(deviceUid, { context: "applyOverrides" });
  const entries = Object.fromEntries(
    Object.entries(overrides).map(([overrideId, value]) => [
      overrideId,
      value == null ? null : normalizeXdmId(value, { context: "apply overrides geozone group" }),
    ]),
  );
  const xdmClient = new XdmClient();
  try {
    await xdmClient.request(
      "PUT",
      `/api/external/v3/settingsOverrides/${normalizedDeviceUid}`,
      {
        overrides: buildOverridesDto(entries),
      },
      { correlationId },
    );
    console.info("[xdm] apply geozone group overrides", {
      correlationId,
      deviceId: normalizedDeviceUid,
      overrideIds: Object.keys(entries),
      roles: roleDetails || null,
      status: "ok",
    });
  } catch (error) {
    console.error("[xdm] falha ao aplicar overrides do geozone group", {
      correlationId,
      deviceId: normalizedDeviceUid,
      status: error?.status || error?.statusCode || null,
      message: error?.message || error,
      payloadSample: { overrides: entries, roles: roleDetails || null },
    });
    throw wrapXdmError(error, {
      step: "updateDeviceSdk",
      correlationId,
      payloadSample: {
        deviceUid: normalizedDeviceUid,
        overrides: entries,
        roles: roleDetails || null,
      },
    });
  }
}

export async function fetchDeviceGeozoneGroupIds({ deviceUid, correlationId } = {}) {
  if (!deviceUid) {
    throw new Error("deviceUid é obrigatório");
  }
  const overrideConfigs = await resolveGeozoneGroupOverrideConfigs({ correlationId });
  const normalizedDeviceUid = normalizeXdmDeviceUid(deviceUid, { context: "fetchDeviceGeozoneGroupId" });
  const xdmClient = new XdmClient();
  let response;
  try {
    response = await xdmClient.request(
      "GET",
      `/api/external/v3/settingsOverrides/${normalizedDeviceUid}`,
      null,
      { correlationId },
    );
  } catch (error) {
    throw wrapXdmError(error, {
      step: "fetchDeviceOverrides",
      correlationId,
      payloadSample: { deviceUid: normalizedDeviceUid },
    });
  }

  const overrides =
    response?.overrides ||
    response?.data?.overrides ||
    response?.settingsOverrides ||
    response?.data?.settingsOverrides ||
    response ||
    null;
  if (!overrides) return null;
  const results = {};
  for (const role of GEOZONE_GROUP_ROLE_LIST) {
    const overrideConfig = overrideConfigs[role.key];
    if (!overrideConfig) {
      results[role.key] = null;
      continue;
    }
    const overrideEntry =
      overrides[overrideConfig.overrideId] ||
      overrides[String(overrideConfig.overrideId)] ||
      overrides[overrideConfig.overrideKey] ||
      null;
    if (!overrideEntry) {
      results[role.key] = null;
      continue;
    }
    const rawValue = typeof overrideEntry === "object" && overrideEntry !== null ? overrideEntry.value : overrideEntry;
    if (rawValue == null || rawValue === "") {
      results[role.key] = null;
      continue;
    }
    results[role.key] = normalizeXdmId(rawValue, { context: `device geozone group ${role.key}` });
  }

  return results;
}

export async function fetchDeviceGeozoneGroupId({ deviceUid, correlationId } = {}) {
  const ids = await fetchDeviceGeozoneGroupIds({ deviceUid, correlationId });
  return ids?.[ITINERARY_GEOZONE_GROUPS.itinerary.key] || null;
}

async function createRollout({ deviceUid, configId, correlationId }) {
  const normalizedDeviceUid = normalizeXdmDeviceUid(deviceUid, { context: "createRollout" });
  const xdmClient = new XdmClient();
  const title = `EuroOne deploy ${new Date().toISOString()}`;
  return xdmClient.request(
    "POST",
    "/api/external/v1/rollouts/create",
    {
      type: DEFAULT_ROLLOUT_TYPE,
      title,
      autoRelease: true,
      deviceUids: [normalizedDeviceUid],
      serializedConfigId: configId,
    },
    { correlationId },
  );
}

export async function applyGeozoneGroupToDevice({
  clientId,
  deviceUid,
  geofenceIds,
  itineraryId,
  groupName,
  correlationId,
  geofencesById,
} = {}) {
  if (!clientId) {
    throw new Error("clientId é obrigatório");
  }
  if (!deviceUid) {
    throw new Error("deviceUid é obrigatório");
  }

  const normalizedDeviceUid = normalizeXdmDeviceUid(deviceUid, { context: "applyGeozoneGroupToDevice" });
  const resolvedCorrelationId = correlationId || buildCorrelationId({ deviceUid: normalizedDeviceUid });
  const clientDisplayName = await resolveClientDisplayName(clientId);

  const groupScopeId = groupName || normalizedDeviceUid;
  const groupSyncResult = itineraryId
    ? await syncGeozoneGroup(itineraryId, {
        clientId,
        clientDisplayName,
        correlationId: resolvedCorrelationId,
        geofencesById,
      })
    : await syncGeozoneGroupForGeofences({
        clientId,
        clientDisplayName,
        geofenceIds,
        groupName,
        scopeKey: groupName || normalizedDeviceUid,
        scopeId: groupScopeId,
        correlationId: resolvedCorrelationId,
        geofencesById,
      });

  const groupIds = groupSyncResult?.groupIds || {};
  const xdmGeozoneGroupId = groupSyncResult?.xdmGeozoneGroupId || groupIds.itinerary || null;
  if (!xdmGeozoneGroupId) {
    throw new Error("Falha ao obter geozone group no XDM");
  }

  let overrideConfigs;
  try {
    overrideConfigs = await resolveGeozoneGroupOverrideConfigs({ correlationId: resolvedCorrelationId });
    validateGeozoneGroupOverrideConfigs({
      configs: overrideConfigs,
      correlationId: resolvedCorrelationId,
      groupIds,
    });
  } catch (error) {
    const configName = process.env.XDM_CONFIG_NAME || process.env.XDM_CONFIG_ID || null;
    const roleDetails = GEOZONE_GROUP_ROLE_LIST.map((role) => {
      const fallback = getGeozoneGroupOverrideConfigByRole(role.key);
      const resolved = overrideConfigs?.[role.key] || null;
      return {
        role: role.key,
        groupId: groupIds?.[role.key] ?? null,
        overrideKey: resolved?.overrideKey || fallback?.overrideKey || null,
        overrideId: resolved?.overrideId || fallback?.overrideId || null,
        configName,
      };
    });
    console.error("[xdm] falha ao resolver overrides do geozone group", {
      correlationId: resolvedCorrelationId,
      deviceId: normalizedDeviceUid,
      roles: roleDetails,
      message: error?.message || error,
    });
    if (error?.code === "XDM_OVERRIDE_VALIDATION_FAILED") {
      throw error;
    }
    const wrapped = createError(
      400,
      "Falha ao resolver overrides do geozone group no XDM. Verifique XDM_CONFIG_NAME e XDM_GEOZONE_GROUP_OVERRIDE_*.",
    );
    wrapped.code = "XDM_OVERRIDE_VALIDATION_FAILED";
    wrapped.details = {
      correlationId: resolvedCorrelationId,
      roles: roleDetails,
      configName,
    };
    throw wrapped;
  }
  const overrides = {};
  const roleDetails = [];
  for (const role of GEOZONE_GROUP_ROLE_LIST) {
    const config = overrideConfigs[role.key];
    if (!config?.overrideId) continue;
    const groupId =
      groupIds[role.key] ?? (role.key === ITINERARY_GEOZONE_GROUPS.itinerary.key ? xdmGeozoneGroupId : null);
    overrides[config.overrideId] = groupId;
    roleDetails.push({
      role: role.key,
      overrideId: config.overrideId,
      overrideKey: config.overrideKey,
      groupId,
    });
    console.info("[xdm] apply geozone group override", {
      correlationId: resolvedCorrelationId,
      deviceUid: normalizedDeviceUid,
      role: role.key,
      xdmGeozoneGroupId: groupId,
      overrideId: config.overrideId,
      overrideKey: config.overrideKey,
      source: config.source || null,
      overrideSource: config.source || null,
      overrideIdSource: config.overrideIdSource || null,
      overrideKeySource: config.overrideKeySource || null,
      discoveryMode: config.discoveryMode || null,
    });
  }

  const configId = await resolveConfigId({ deviceUid: normalizedDeviceUid, correlationId: resolvedCorrelationId });
  await applyOverrides({
    deviceUid: normalizedDeviceUid,
    overrides,
    correlationId: resolvedCorrelationId,
    roleDetails,
  });
  const rollout = await createRollout({
    deviceUid: normalizedDeviceUid,
    configId,
    correlationId: resolvedCorrelationId,
  });

  return {
    deviceUid: normalizedDeviceUid,
    configId,
    xdmGeozoneGroupId,
    xdmGeozoneGroupIds: groupIds,
    groupName: groupSyncResult?.groupName || groupName || null,
    rolloutId: rollout?.rolloutId || null,
  };
}

export default {
  applyGeozoneGroupToDevice,
  fetchDeviceGeozoneGroupId,
  fetchDeviceGeozoneGroupIds,
};
