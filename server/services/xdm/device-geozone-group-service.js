import crypto from "node:crypto";

import XdmClient from "./xdm-client.js";
import { syncGeozoneGroup, syncGeozoneGroupForGeofences } from "./geozone-group-sync-service.js";
import { buildOverridesDto, normalizeXdmDeviceUid, normalizeXdmId } from "./xdm-utils.js";
import { ensureGeozoneGroupOverrideId } from "./xdm-override-resolver.js";
import { wrapXdmError } from "./xdm-error.js";
import { getClientById } from "../../models/client.js";
import { fallbackClientDisplayName } from "./xdm-name-utils.js";

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

async function applyOverrides({ deviceUid, xdmGeozoneGroupId, correlationId }) {
  const overrideConfig = await ensureGeozoneGroupOverrideId({ correlationId });
  const normalizedDeviceUid = normalizeXdmDeviceUid(deviceUid, { context: "applyOverrides" });
  const normalizedGeozoneGroupId = normalizeXdmId(xdmGeozoneGroupId, { context: "apply overrides geozone group" });
  const xdmClient = new XdmClient();
  try {
    await xdmClient.request(
      "PUT",
      `/api/external/v3/settingsOverrides/${normalizedDeviceUid}`,
      {
        overrides: buildOverridesDto({
          [overrideConfig.overrideId]: normalizedGeozoneGroupId,
        }),
      },
      { correlationId },
    );
  } catch (error) {
    throw wrapXdmError(error, {
      step: "updateDeviceSdk",
      correlationId,
      payloadSample: {
        deviceUid: normalizedDeviceUid,
        overrideId: overrideConfig.overrideId,
        groupId: normalizedGeozoneGroupId,
      },
    });
  }
}

export async function fetchDeviceGeozoneGroupId({ deviceUid, correlationId } = {}) {
  if (!deviceUid) {
    throw new Error("deviceUid é obrigatório");
  }
  const overrideConfig = await ensureGeozoneGroupOverrideId({ correlationId });
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
  const overrideEntry =
    overrides[overrideConfig.overrideId] ||
    overrides[String(overrideConfig.overrideId)] ||
    overrides[overrideConfig.overrideKey] ||
    null;
  if (!overrideEntry) return null;
  const rawValue = typeof overrideEntry === "object" && overrideEntry !== null ? overrideEntry.value : overrideEntry;
  if (rawValue == null || rawValue === "") return null;
  return normalizeXdmId(rawValue, { context: "device geozone group" });
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

  const xdmGeozoneGroupId = groupSyncResult?.xdmGeozoneGroupId;
  if (!xdmGeozoneGroupId) {
    throw new Error("Falha ao obter geozone group no XDM");
  }

  const configId = await resolveConfigId({ deviceUid: normalizedDeviceUid, correlationId: resolvedCorrelationId });
  await applyOverrides({
    deviceUid: normalizedDeviceUid,
    xdmGeozoneGroupId,
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
    groupName: groupSyncResult?.groupName || groupName || null,
    rolloutId: rollout?.rolloutId || null,
  };
}

export default {
  applyGeozoneGroupToDevice,
  fetchDeviceGeozoneGroupId,
};
