import crypto from "node:crypto";

import { getVehicleById, updateVehicle } from "../../models/vehicle.js";
import { getItineraryById } from "../../models/itinerary.js";
import { listGeofences } from "../../models/geofence.js";
import { getRouteById, updateRoute } from "../../models/route.js";
import { getClientById } from "../../models/client.js";
import {
  appendDeploymentLog,
  createDeployment,
  findActiveDeploymentByPair,
  findLatestDeploymentByPair,
  getDeploymentById,
  listLatestDeploymentsByItinerary,
  updateDeployment,
} from "../../models/xdm-deployment.js";
import { getGeozoneGroupMapping } from "../../models/xdm-geozone-group.js";
import XdmClient from "./xdm-client.js";
import { syncGeozoneGroup, ensureGeozoneGroups } from "./geozone-group-sync-service.js";
import { buildOverridesDto, normalizeXdmDeviceUid, normalizeXdmId } from "./xdm-utils.js";
import {
  resolveGeozoneGroupOverrideConfigs,
  validateGeozoneGroupOverrideConfigs,
} from "./xdm-override-resolver.js";
import { resolveVehicleDeviceUid } from "./resolve-vehicle-device-uid.js";
import { wrapXdmError, isDeviceNotFoundError } from "./xdm-error.js";
import { fallbackClientDisplayName } from "./xdm-name-utils.js";
import { GEOZONE_GROUP_ROLE_LIST, ITINERARY_GEOZONE_GROUPS } from "./xdm-geozone-group-roles.js";

function buildRequestHash({ itineraryId, vehicleId, groupHash, action }) {
  const payload = `${itineraryId}|${vehicleId}|${action || "EMBARK"}|${groupHash || ""}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function buildGroupHashSummary(groupHashes = {}) {
  if (!groupHashes || typeof groupHashes !== "object") return null;
  return [
    `itinerary=${groupHashes.itinerary || ""}`,
    `targets=${groupHashes.targets || ""}`,
    `entry=${groupHashes.entry || ""}`,
  ].join("|");
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

function persistVehicleDeviceUid(vehicle, deviceUid) {
  if (!vehicle || !deviceUid) return;
  const updates = {};
  if (!vehicle.deviceImei) {
    updates.deviceImei = deviceUid;
  }
  if (!vehicle.xdmDeviceUid) {
    updates.xdmDeviceUid = deviceUid;
  }
  if (Object.keys(updates).length) {
    updateVehicle(vehicle.id, updates);
  }
}

function buildVehicleStatus({ status, message, deviceUid, rolloutId }) {
  return {
    status,
    message,
    deviceUid,
    rolloutId: rolloutId || null,
  };
}

async function loadGeofencesById({ clientId, geofenceIds }) {
  const geofences = await listGeofences({ clientId });
  const geofencesById = new Map();
  geofences.forEach((geofence) => {
    geofencesById.set(String(geofence.id), geofence);
  });

  geofenceIds.forEach((geofenceId) => {
    if (!geofencesById.has(String(geofenceId))) {
      throw new Error("Geofence não encontrada para o itinerário");
    }
  });

  return geofencesById;
}

async function updateRoutesBufferMeters({ routeIds = [], bufferMeters }) {
  if (!Number.isFinite(bufferMeters) || bufferMeters <= 0) return;
  const ids = Array.isArray(routeIds) ? routeIds : [];
  for (const routeId of ids) {
    const route = await getRouteById(routeId);
    if (!route) continue;
    const metadata = route.metadata && typeof route.metadata === "object" ? { ...route.metadata } : {};
    if (metadata.xdmBufferMeters === bufferMeters) continue;
    await updateRoute(routeId, { metadata: { ...metadata, xdmBufferMeters: bufferMeters } });
  }
}

async function applyOverrides({ deviceUid, groupIds, correlationId }) {
  const overrideConfigs = await resolveGeozoneGroupOverrideConfigs({ correlationId });
  validateGeozoneGroupOverrideConfigs({ configs: overrideConfigs, correlationId, groupIds });
  const normalizedDeviceUid = normalizeXdmDeviceUid(deviceUid, { context: "applyOverrides" });
  const overrides = {};
  for (const role of GEOZONE_GROUP_ROLE_LIST) {
    const overrideConfig = overrideConfigs[role.key];
    if (!overrideConfig?.overrideId) {
      throw new Error(`Override do geozone group não encontrado para ${role.key}`);
    }
    const groupId = groupIds?.[role.key] ?? null;
    overrides[overrideConfig.overrideId] =
      groupId == null ? null : normalizeXdmId(groupId, { context: "apply overrides geozone group" });
    console.info("[xdm] apply geozone group override", {
      correlationId,
      deviceId: normalizedDeviceUid,
      role: role.key,
      xdmGeozoneGroupId: groupId ?? null,
      overrideId: overrideConfig.overrideId,
      overrideKey: overrideConfig.overrideKey,
      overrideSource: overrideConfig.source || null,
      overrideIdSource: overrideConfig.overrideIdSource || null,
      overrideKeySource: overrideConfig.overrideKeySource || null,
    });
  }
  const xdmClient = new XdmClient();
  try {
    await xdmClient.request(
      "PUT",
      `/api/external/v3/settingsOverrides/${normalizedDeviceUid}`,
      {
        overrides: buildOverridesDto(overrides),
      },
      { correlationId },
    );
    for (const role of GEOZONE_GROUP_ROLE_LIST) {
      const overrideConfig = overrideConfigs[role.key];
      const groupId = groupIds?.[role.key] ?? null;
      console.info("[xdm] apply geozone group override", {
        correlationId,
        deviceId: normalizedDeviceUid,
        role: role.key,
        xdmGeozoneGroupId: groupId ?? null,
        overrideId: overrideConfig?.overrideId ?? null,
        overrideKey: overrideConfig?.overrideKey ?? null,
        overrideSource: overrideConfig?.source ?? null,
        overrideIdSource: overrideConfig?.overrideIdSource ?? null,
        overrideKeySource: overrideConfig?.overrideKeySource ?? null,
        status: "ok",
      });
    }
  } catch (error) {
    console.error("[xdm] falha ao aplicar overrides do geozone group", {
      correlationId,
      deviceId: normalizedDeviceUid,
      roles: GEOZONE_GROUP_ROLE_LIST.map((role) => ({
        role: role.key,
        overrideId: overrideConfigs?.[role.key]?.overrideId ?? null,
        overrideKey: overrideConfigs?.[role.key]?.overrideKey ?? null,
        groupId: groupIds?.[role.key] ?? null,
      })),
      message: error?.message || error,
    });
    if (isDeviceNotFoundError(error)) {
      const deviceError = new Error("Device UID not found");
      deviceError.status = 424;
      deviceError.expose = true;
      deviceError.code = "XDM_DEVICE_NOT_FOUND";
      deviceError.details = {
        correlationId,
        deviceUid: normalizedDeviceUid,
      };
      throw deviceError;
    }
    throw wrapXdmError(error, {
      step: "updateDeviceSdk",
      correlationId,
      payloadSample: {
        deviceUid: normalizedDeviceUid,
        overrides,
        roles: GEOZONE_GROUP_ROLE_LIST.map((role) => ({
          role: role.key,
          overrideId: overrideConfigs?.[role.key]?.overrideId ?? null,
          overrideKey: overrideConfigs?.[role.key]?.overrideKey ?? null,
          groupId: groupIds?.[role.key] ?? null,
        })),
      },
    });
  }
}

function logStep(deploymentId, step, meta = {}) {
  appendDeploymentLog(deploymentId, { step, ...meta });
  console.info("[xdm] deployment step", {
    correlationId: deploymentId,
    step,
    ...meta,
  });
}

async function processDeployment(deploymentId) {
  const deployment = getDeploymentById(deploymentId);
  if (!deployment) return;

  const correlationId = deployment.id;
  updateDeployment(deploymentId, { correlationId });

  const vehicle = getVehicleById(deployment.vehicleId);
  const itinerary = getItineraryById(deployment.itineraryId);
  const clientDisplayName = await resolveClientDisplayName(deployment.clientId);

  if (!vehicle || !itinerary) {
    updateDeployment(deploymentId, {
      status: "FAILED",
      finishedAt: new Date().toISOString(),
      errorMessage: "Veículo ou itinerário não encontrado",
    });
    return;
  }

  const resolvedDeviceUid = resolveVehicleDeviceUid(vehicle);
  if (!resolvedDeviceUid) {
    updateDeployment(deploymentId, {
      status: "FAILED",
      finishedAt: new Date().toISOString(),
      errorMessage: "Veículo sem IMEI cadastrado",
    });
    return;
  }
  const deviceUid = normalizeXdmDeviceUid(resolvedDeviceUid, { context: "deployment deviceUid" });

  if (deployment.deviceImei !== deviceUid) {
    updateDeployment(deploymentId, { deviceImei: deviceUid });
  }

  if ((!vehicle.xdmDeviceUid || !vehicle.deviceImei) && deviceUid) {
    persistVehicleDeviceUid(vehicle, deviceUid);
  }

  try {
    const action = deployment.action || "EMBARK";
    let xdmGeozoneGroupId = deployment.xdmGeozoneGroupId ?? null;
    let groupIds = deployment.xdmGeozoneGroupIds ?? null;
    let groupHashes = deployment.groupHashes ?? null;
    let groupHash = deployment.groupHash ?? null;

    if (action !== "DISEMBARK") {
      if (!xdmGeozoneGroupId || !groupHash || !groupIds || !groupHashes) {
        const syncStart = Date.now();
        logStep(deploymentId, "SYNC_GEOFENCES", { status: "started" });
        const synced = await syncGeozoneGroup(itinerary.id, {
          clientId: deployment.clientId,
          clientDisplayName,
          correlationId,
        });
        xdmGeozoneGroupId = synced.xdmGeozoneGroupId;
        groupIds = synced.groupIds || null;
        groupHashes = synced.groupHashes || null;
        groupHash = buildGroupHashSummary(groupHashes);
        updateDeployment(deploymentId, {
          xdmGeozoneGroupId,
          xdmGeozoneGroupIds: groupIds,
          groupHashes,
          groupHash,
        });
        logStep(deploymentId, "SYNC_GEOFENCES", {
          status: "ok",
          xdmGeozoneGroupId,
          durationMs: Date.now() - syncStart,
        });
      } else {
        logStep(deploymentId, "SYNC_GEOFENCES", { status: "skipped", xdmGeozoneGroupId });
      }
    } else {
      xdmGeozoneGroupId = null;
      groupIds = {
        itinerary: null,
        targets: null,
        entry: null,
      };
      groupHashes = null;
      groupHash = null;
      logStep(deploymentId, "SYNC_GEOFENCES", { status: "skipped", reason: "disembark" });
    }

    const requestHash = buildRequestHash({
      itineraryId: itinerary.id,
      vehicleId: vehicle.id,
      groupHash,
      action,
    });

    updateDeployment(deploymentId, { requestHash });

    const lastDeployment = findLatestDeploymentByPair({
      itineraryId: itinerary.id,
      vehicleId: vehicle.id,
      clientId: deployment.clientId,
    });

    if (
      lastDeployment?.id !== deploymentId &&
      lastDeployment?.status === "DEPLOYED" &&
      (lastDeployment?.action || "EMBARK") === action &&
      lastDeployment?.requestHash === requestHash
    ) {
      updateDeployment(deploymentId, {
        status: action === "DISEMBARK" ? "CLEARED" : "DEPLOYED",
        finishedAt: new Date().toISOString(),
        errorMessage: action === "DISEMBARK" ? "Já desembarcado" : "Já embarcado com o mesmo itinerário",
      });
      return;
    }

    const updateStart = Date.now();
    logStep(deploymentId, "APPLY_OVERRIDES", { status: "started" });
    await applyOverrides({ deviceUid, groupIds: groupIds || {}, correlationId });
    logStep(deploymentId, "APPLY_OVERRIDES", {
      status: "ok",
      durationMs: Date.now() - updateStart,
    });

    updateDeployment(deploymentId, {
      status: action === "DISEMBARK" ? "CLEARED" : "DEPLOYED",
      finishedAt: new Date().toISOString(),
    });
    logStep(deploymentId, "STATUS_UPDATE", {
      status: action === "DISEMBARK" ? "CLEARED" : "DEPLOYED",
    });
  } catch (error) {
    updateDeployment(deploymentId, {
      status: "FAILED",
      finishedAt: new Date().toISOString(),
      errorMessage: error?.message || "Falha no deploy",
      errorDetails: error?.stack || null,
    });
    logStep(deploymentId, "FAILED", { message: error?.message || error });
  }
}

export function queueDeployment({
  clientId,
  itineraryId,
  vehicleId,
  deviceImei,
  requestedByUserId,
  requestedByName,
  ipAddress,
  xdmGeozoneGroupId = null,
  xdmGeozoneGroupIds = null,
  groupHash = null,
  groupHashes = null,
  configId = null,
  action = "EMBARK",
}) {
  const active = findActiveDeploymentByPair({ itineraryId, vehicleId, clientId });
  if (active) {
    return { deployment: active, status: "ACTIVE" };
  }

  const latest = findLatestDeploymentByPair({ itineraryId, vehicleId, clientId });
  const knownGroupHash =
    groupHash ||
    buildGroupHashSummary(groupHashes) ||
    getGeozoneGroupMapping({ itineraryId, clientId })?.groupHash ||
    null;

  const normalizedAction = action || "EMBARK";
  if (latest?.status === "DEPLOYED" && latest?.requestHash && knownGroupHash && normalizedAction === "EMBARK") {
    const expectedHash = buildRequestHash({
      itineraryId,
      vehicleId,
      groupHash: knownGroupHash,
      action: normalizedAction,
    });
    if (expectedHash === latest.requestHash) {
      return { deployment: latest, status: "ALREADY_DEPLOYED" };
    }
  }
  if (latest?.status === "CLEARED" && latest?.requestHash && normalizedAction === "DISEMBARK") {
    const expectedHash = buildRequestHash({
      itineraryId,
      vehicleId,
      groupHash,
      action: normalizedAction,
    });
    if (expectedHash === latest.requestHash) {
      return { deployment: latest, status: "ALREADY_CLEARED" };
    }
  }

  const deployment = createDeployment({
    clientId,
    itineraryId,
    vehicleId,
    deviceImei,
    requestedByUserId,
    requestedByName,
    ipAddress,
    xdmGeozoneGroupId,
    xdmGeozoneGroupIds,
    groupHash,
    groupHashes,
    configId: Number.isFinite(Number(configId)) ? Number(configId) : null,
    action: normalizedAction,
  });

  setImmediate(() => {
    void processDeployment(deployment.id);
  });

  return { deployment, status: "QUEUED" };
}

export async function embarkItinerary({
  clientId,
  itineraryId,
  vehicleIds = [],
  configId = null,
  bufferMeters = null,
  dryRun = false,
  correlationId = null,
  requestedByUserId = null,
  requestedByName = null,
  ipAddress = null,
  geofencesById = null,
}) {
  const itinerary = getItineraryById(itineraryId);
  if (!itinerary) {
    throw new Error("Itinerário não encontrado");
  }
  if (clientId && String(itinerary.clientId) !== String(clientId)) {
    throw new Error("Itinerário não pertence ao cliente");
  }

  const resolvedClientId = clientId || itinerary.clientId;
  const clientDisplayName = await resolveClientDisplayName(resolvedClientId);

  const geofenceIds = (itinerary.items || [])
    .filter((item) => item.type === "geofence" || item.type === "target")
    .map((item) => item.id);
  const routeIds = (itinerary.items || []).filter((item) => item.type === "route").map((item) => item.id);
  if (!geofenceIds.length && !routeIds.length) {
    throw new Error("Itinerário não possui itens para sincronizar");
  }

  if (!dryRun) {
    const overrideConfigs = await resolveGeozoneGroupOverrideConfigs({ correlationId });
    validateGeozoneGroupOverrideConfigs({ configs: overrideConfigs, correlationId });
  }

  const resolvedGeofencesById =
    geofencesById instanceof Map
      ? geofencesById
      : geofenceIds.length
        ? await loadGeofencesById({ clientId: itinerary.clientId, geofenceIds })
        : new Map();
  if (Number.isFinite(bufferMeters) && bufferMeters > 0) {
    await updateRoutesBufferMeters({ routeIds, bufferMeters });
  }

  const { xdmGeozoneGroupId, groupHash, groupIds, groupHashes } = await ensureGeozoneGroups(itinerary.id, {
    clientId: itinerary.clientId,
    clientDisplayName,
    correlationId,
    geofencesById: resolvedGeofencesById,
    forceEmptyGroups: true,
  });
  const deploymentGroupHash = buildGroupHashSummary(groupHashes) || groupHash || null;

  const results = vehicleIds.map((vehicleId) => {
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle || String(vehicle.clientId) !== String(itinerary.clientId)) {
      return {
        vehicleId: String(vehicleId),
        ...buildVehicleStatus({ status: "failed", message: "Veículo não encontrado para o cliente" }),
      };
    }

    const resolvedDeviceUid = resolveVehicleDeviceUid(vehicle);
    if (!resolvedDeviceUid) {
      return {
        vehicleId: String(vehicleId),
        ...buildVehicleStatus({ status: "failed", message: "Veículo sem IMEI cadastrado" }),
      };
    }
    const deviceUid = normalizeXdmDeviceUid(resolvedDeviceUid, { context: "embark deviceUid" });

    if ((!vehicle.xdmDeviceUid || !vehicle.deviceImei) && deviceUid) {
      persistVehicleDeviceUid(vehicle, deviceUid);
    }

    if (dryRun) {
      return {
        vehicleId: String(vehicleId),
        ...buildVehicleStatus({ status: "ok", message: "Dry-run: deploy não executado", deviceUid }),
      };
    }

    const { deployment, status } = queueDeployment({
      clientId: itinerary.clientId,
      itineraryId: itinerary.id,
      vehicleId: vehicle.id,
      deviceImei: deviceUid,
      requestedByUserId,
      requestedByName,
      ipAddress,
      xdmGeozoneGroupId,
      xdmGeozoneGroupIds: groupIds,
      groupHash: deploymentGroupHash,
      groupHashes,
      configId,
    });

    const mappedStatus =
      status === "ALREADY_DEPLOYED" ? "ok" : status === "ACTIVE" || status === "QUEUED" ? "queued" : "failed";
    const message =
      status === "ALREADY_DEPLOYED"
        ? "Já embarcado"
        : status === "ACTIVE"
          ? "Deploy em andamento"
          : status === "QUEUED"
            ? "Deploy enfileirado"
            : "Falha ao enfileirar deploy";

    return {
      vehicleId: String(vehicle.id),
      deploymentId: deployment?.id || null,
      ...buildVehicleStatus({
        status: mappedStatus,
        message,
        deviceUid,
        rolloutId: deployment?.xdmDeploymentId || null,
      }),
    };
  });

  return {
    itineraryId: itinerary.id,
    xdmGeozoneGroupId,
    xdmGeozoneGroupIds: groupIds || null,
    vehicles: results,
  };
}

export async function disembarkItinerary({
  clientId,
  itineraryId,
  vehicleIds = [],
  dryRun = false,
  correlationId = null,
  requestedByUserId = null,
  requestedByName = null,
  ipAddress = null,
} = {}) {
  const itinerary = getItineraryById(itineraryId);
  if (!itinerary) {
    throw new Error("Itinerário não encontrado");
  }
  if (clientId && String(itinerary.clientId) !== String(clientId)) {
    throw new Error("Itinerário não pertence ao cliente");
  }

  const resolvedClientId = clientId || itinerary.clientId;
  const clientDisplayName = await resolveClientDisplayName(resolvedClientId);

  let targetVehicleIds = Array.isArray(vehicleIds) ? vehicleIds.map(String) : [];
  if (!targetVehicleIds.length) {
    const latestDeployments = listLatestDeploymentsByItinerary({
      clientId: itinerary.clientId,
      itineraryId: itinerary.id,
    });
    targetVehicleIds = latestDeployments
      .filter((deployment) => (deployment.action || "EMBARK") === "EMBARK" && deployment.status === "DEPLOYED")
      .map((deployment) => String(deployment.vehicleId));
  }

  if (!targetVehicleIds.length) {
    throw new Error("Nenhum veículo embarcado para desembarque");
  }

  if (!dryRun) {
    await resolveOverrideConfigs({ correlationId });
  }

  const results = targetVehicleIds.map((vehicleId) => {
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle || String(vehicle.clientId) !== String(itinerary.clientId)) {
      return {
        vehicleId: String(vehicleId),
        ...buildVehicleStatus({ status: "failed", message: "Veículo não encontrado para o cliente" }),
      };
    }

    const resolvedDeviceUid = resolveVehicleDeviceUid(vehicle);
    if (!resolvedDeviceUid) {
      return {
        vehicleId: String(vehicleId),
        ...buildVehicleStatus({ status: "failed", message: "Veículo sem IMEI cadastrado" }),
      };
    }
    const deviceUid = normalizeXdmDeviceUid(resolvedDeviceUid, { context: "disembark deviceUid" });

    if ((!vehicle.xdmDeviceUid || !vehicle.deviceImei) && deviceUid) {
      persistVehicleDeviceUid(vehicle, deviceUid);
    }

    if (dryRun) {
      return {
        vehicleId: String(vehicleId),
        ...buildVehicleStatus({ status: "ok", message: "Dry-run: desembarque não executado", deviceUid }),
      };
    }

    const lastDeployment = findLatestDeploymentByPair({
      clientId: itinerary.clientId,
      itineraryId: itinerary.id,
      vehicleId: vehicle.id,
    });

    const resolvedGroupHashes = lastDeployment?.groupHashes || null;
    const resolvedGroupHash = lastDeployment?.groupHash || buildGroupHashSummary(resolvedGroupHashes);

    const { deployment, status } = queueDeployment({
      clientId: itinerary.clientId,
      itineraryId: itinerary.id,
      vehicleId: vehicle.id,
      deviceImei: deviceUid,
      requestedByUserId,
      requestedByName,
      ipAddress,
      xdmGeozoneGroupId: null,
      xdmGeozoneGroupIds: lastDeployment?.xdmGeozoneGroupIds || null,
      groupHash: resolvedGroupHash || null,
      groupHashes: resolvedGroupHashes,
      action: "DISEMBARK",
    });

    const mappedStatus =
      status === "ALREADY_CLEARED" ? "ok" : status === "ACTIVE" || status === "QUEUED" ? "queued" : "failed";
    const message =
      status === "ALREADY_CLEARED"
        ? "Já desembarcado"
        : status === "ACTIVE"
          ? "Desembarque em andamento"
          : status === "QUEUED"
            ? "Desembarque enfileirado"
            : "Falha ao enfileirar desembarque";

    return {
      vehicleId: String(vehicle.id),
      deploymentId: deployment?.id || null,
      ...buildVehicleStatus({
        status: mappedStatus,
        message,
        deviceUid,
        rolloutId: deployment?.xdmDeploymentId || null,
      }),
    };
  });

  return {
    itineraryId: itinerary.id,
    clientDisplayName,
    vehicles: results,
  };
}

export default {
  queueDeployment,
  embarkItinerary,
  disembarkItinerary,
};
