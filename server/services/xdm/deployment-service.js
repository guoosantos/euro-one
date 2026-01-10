import crypto from "node:crypto";

import { getVehicleById, updateVehicle } from "../../models/vehicle.js";
import { getItineraryById } from "../../models/itinerary.js";
import { listGeofences } from "../../models/geofence.js";
import {
  appendDeploymentLog,
  createDeployment,
  findActiveDeploymentByPair,
  findLatestDeploymentByPair,
  getDeploymentById,
  updateDeployment,
} from "../../models/xdm-deployment.js";
import { getGeozoneGroupMapping } from "../../models/xdm-geozone-group.js";
import XdmClient from "./xdm-client.js";
import { syncGeozoneGroup } from "./geozone-group-sync-service.js";
import { resolveVehicleDeviceUid } from "./resolve-vehicle-device-uid.js";

const DEFAULT_ROLLOUT_TYPE = 0; // XT_CONFIG

function buildRequestHash({ itineraryId, vehicleId, groupHash, configId }) {
  const payload = `${itineraryId}|${vehicleId}|${groupHash}|${configId}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function getOverrideKey() {
  return process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY || null;
}

function ensureOverrideKeyConfigured() {
  const overrideKey = getOverrideKey();
  if (!overrideKey) {
    throw new Error("XDM_GEOZONE_GROUP_OVERRIDE_KEY não configurado para aplicar o grupo de GEOFENCES");
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

async function resolveConfigId({ deviceUid, correlationId }) {
  const xdmClient = new XdmClient();
  const configs = await xdmClient.request("POST", "/api/external/v3/configs/forDevices", { uids: [deviceUid] }, {
    correlationId,
  });

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
  const overrideKey = getOverrideKey();
  if (!overrideKey) {
    throw new Error("XDM_GEOZONE_GROUP_OVERRIDE_KEY não configurado para aplicar o grupo de GEOFENCES");
  }
  const xdmClient = new XdmClient();
  await xdmClient.request(
    "PUT",
    `/api/external/v3/settingsOverrides/${deviceUid}`,
    {
      overrides: {
        [overrideKey]: String(xdmGeozoneGroupId),
      },
    },
    { correlationId },
  );
}

async function createRollout({ deviceUid, configId, correlationId }) {
  const xdmClient = new XdmClient();
  const title = `EuroOne deploy ${new Date().toISOString()}`;
  return xdmClient.request(
    "POST",
    "/api/external/v1/rollouts/create",
    {
      type: DEFAULT_ROLLOUT_TYPE,
      title,
      autoRelease: true,
      deviceUids: [deviceUid],
      serializedConfigId: configId,
    },
    { correlationId },
  );
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

  if (!vehicle || !itinerary) {
    updateDeployment(deploymentId, {
      status: "FAILED",
      finishedAt: new Date().toISOString(),
      errorMessage: "Veículo ou itinerário não encontrado",
    });
    return;
  }

  const deviceUid = resolveVehicleDeviceUid(vehicle);
  if (!deviceUid) {
    updateDeployment(deploymentId, {
      status: "FAILED",
      finishedAt: new Date().toISOString(),
      errorMessage: "Veículo sem IMEI cadastrado",
    });
    return;
  }

  if (deployment.deviceImei !== deviceUid) {
    updateDeployment(deploymentId, { deviceImei: deviceUid });
  }

  if ((!vehicle.xdmDeviceUid || !vehicle.deviceImei) && deviceUid) {
    persistVehicleDeviceUid(vehicle, deviceUid);
  }

  try {
    let xdmGeozoneGroupId = deployment.xdmGeozoneGroupId || null;
    let groupHash = deployment.groupHash || null;

    if (!xdmGeozoneGroupId || !groupHash) {
      const syncStart = Date.now();
      logStep(deploymentId, "SYNC_GEOFENCES", { status: "started" });
      const synced = await syncGeozoneGroup(itinerary.id, {
        clientId: deployment.clientId,
        correlationId,
      });
      xdmGeozoneGroupId = synced.xdmGeozoneGroupId;
      groupHash = synced.groupHash;
      updateDeployment(deploymentId, { xdmGeozoneGroupId, groupHash });
      logStep(deploymentId, "SYNC_GEOFENCES", {
        status: "ok",
        xdmGeozoneGroupId,
        durationMs: Date.now() - syncStart,
      });
    } else {
      logStep(deploymentId, "SYNC_GEOFENCES", { status: "skipped", xdmGeozoneGroupId });
    }

    const configId = deployment.configId ? Number(deployment.configId) : await resolveConfigId({ deviceUid, correlationId });
    const requestHash = buildRequestHash({
      itineraryId: itinerary.id,
      vehicleId: vehicle.id,
      groupHash,
      configId,
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
      lastDeployment?.requestHash === requestHash
    ) {
      updateDeployment(deploymentId, {
        status: "DEPLOYED",
        finishedAt: new Date().toISOString(),
        errorMessage: "Já embarcado com o mesmo itinerário",
      });
      return;
    }

    const updateStart = Date.now();
    logStep(deploymentId, "UPDATE_CONFIG", { status: "started", configId });
    await applyOverrides({ deviceUid, xdmGeozoneGroupId, correlationId });
    logStep(deploymentId, "UPDATE_CONFIG", {
      status: "ok",
      configId,
      durationMs: Date.now() - updateStart,
    });

    const deployStart = Date.now();
    logStep(deploymentId, "DEPLOY", { status: "started" });
    const rollout = await createRollout({ deviceUid, configId, correlationId });

    updateDeployment(deploymentId, {
      status: "DEPLOYING",
      xdmDeploymentId: rollout?.rolloutId || null,
      configId,
    });
    logStep(deploymentId, "STATUS_UPDATE", {
      status: "DEPLOYING",
      rolloutId: rollout?.rolloutId || null,
    });
    logStep(deploymentId, "DEPLOY", {
      status: "ok",
      rolloutId: rollout?.rolloutId || null,
      durationMs: Date.now() - deployStart,
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
  groupHash = null,
  configId = null,
}) {
  const active = findActiveDeploymentByPair({ itineraryId, vehicleId, clientId });
  if (active) {
    return { deployment: active, status: "ACTIVE" };
  }

  const latest = findLatestDeploymentByPair({ itineraryId, vehicleId, clientId });
  const configuredId = Number.isFinite(Number(configId))
    ? Number(configId)
    : process.env.XDM_CONFIG_ID
      ? Number(process.env.XDM_CONFIG_ID)
      : null;
  const knownGroupHash = groupHash || getGeozoneGroupMapping({ itineraryId, clientId })?.groupHash || null;

  if (latest?.status === "DEPLOYED" && latest?.requestHash && Number.isFinite(configuredId) && knownGroupHash) {
    const expectedHash = buildRequestHash({
      itineraryId,
      vehicleId,
      groupHash: knownGroupHash,
      configId: configuredId,
    });
    if (expectedHash === latest.requestHash) {
      return { deployment: latest, status: "ALREADY_DEPLOYED" };
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
    groupHash,
    configId: Number.isFinite(Number(configId)) ? Number(configId) : null,
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

  const geofenceIds = (itinerary.items || []).filter((item) => item.type === "geofence").map((item) => item.id);
  if (!geofenceIds.length) {
    throw new Error("Itinerário não possui cercas para sincronizar");
  }

  if (!dryRun) {
    ensureOverrideKeyConfigured();
  }

  const resolvedGeofencesById =
    geofencesById instanceof Map
      ? geofencesById
      : await loadGeofencesById({ clientId: itinerary.clientId, geofenceIds });
  const { xdmGeozoneGroupId, groupHash } = await syncGeozoneGroup(itinerary.id, {
    clientId: itinerary.clientId,
    correlationId,
    geofencesById: resolvedGeofencesById,
  });

  const results = vehicleIds.map((vehicleId) => {
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle || String(vehicle.clientId) !== String(itinerary.clientId)) {
      return {
        vehicleId: String(vehicleId),
        ...buildVehicleStatus({ status: "failed", message: "Veículo não encontrado para o cliente" }),
      };
    }

    const deviceUid = resolveVehicleDeviceUid(vehicle);
    if (!deviceUid) {
      return {
        vehicleId: String(vehicleId),
        ...buildVehicleStatus({ status: "failed", message: "Veículo sem IMEI cadastrado" }),
      };
    }

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
      groupHash,
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
    vehicles: results,
  };
}

export default {
  queueDeployment,
  embarkItinerary,
};
