import crypto from "node:crypto";

import XdmClient from "./xdm-client.js";
import { syncGeozoneGroup, syncGeozoneGroupForGeofences } from "./geozone-group-sync-service.js";
import { buildOverridesDto, normalizeXdmDeviceUid, normalizeXdmId } from "./xdm-utils.js";
import { ensureGeozoneGroupOverrideId, getGeozoneGroupOverrideConfigByRole } from "./xdm-override-resolver.js";
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

async function resolveOverrideConfigs({ correlationId } = {}) {
  const configs = {};
  for (const role of GEOZONE_GROUP_ROLE_LIST) {
    const baseConfig = getGeozoneGroupOverrideConfigByRole(role.key);
    const resolved = await ensureGeozoneGroupOverrideId({
      correlationId,
      overrideId: baseConfig.overrideId,
      overrideKey: baseConfig.overrideKey,
    });
    configs[role.key] = resolved;
  }
  return configs;
}

async function applyOverrides({ deviceUid, overrides, correlationId }) {
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
  } catch (error) {
    throw wrapXdmError(error, {
      step: "updateDeviceSdk",
      correlationId,
      payloadSample: {
        deviceUid: normalizedDeviceUid,
        overrides: entries,
      },
    });
  }
}

export async function fetchDeviceGeozoneGroupIds({ deviceUid, correlationId } = {}) {
  if (!deviceUid) {
    throw new Error("deviceUid é obrigatório");
  }
  const overrideConfigs = await resolveOverrideConfigs({ correlationId });
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

  const overrideConfigs = await resolveOverrideConfigs({ correlationId: resolvedCorrelationId });
  const overrides = {};
  for (const role of GEOZONE_GROUP_ROLE_LIST) {
    const config = overrideConfigs[role.key];
    if (!config?.overrideId) continue;
    overrides[config.overrideId] = groupIds[role.key] ?? (role.key === ITINERARY_GEOZONE_GROUPS.itinerary.key ? xdmGeozoneGroupId : null);
  }

  const configId = await resolveConfigId({ deviceUid: normalizedDeviceUid, correlationId: resolvedCorrelationId });
  await applyOverrides({
    deviceUid: normalizedDeviceUid,
    overrides,
    correlationId: resolvedCorrelationId,
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
