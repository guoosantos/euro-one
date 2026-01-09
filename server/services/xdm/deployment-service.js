import crypto from "node:crypto";

import { getVehicleById, updateVehicle } from "../../models/vehicle.js";
import { getItineraryById } from "../../models/itinerary.js";
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

const DEFAULT_ROLLOUT_TYPE = 0; // XT_CONFIG

function buildRequestHash({ itineraryId, vehicleId, groupHash, configId }) {
  const payload = `${itineraryId}|${vehicleId}|${groupHash}|${configId}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function getOverrideKey() {
  return process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY || null;
}

function resolveDeviceUid(vehicle) {
  return vehicle?.xdmDeviceUid || vehicle?.deviceImei || vehicle?.device_imei || vehicle?.imei || null;
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

  throw new Error("Não foi possível determinar a configuração do XDM para o dispositivo");
}

async function applyOverrides({ deviceUid, xdmGeozoneGroupId, correlationId }) {
  const overrideKey = getOverrideKey();
  if (!overrideKey) {
    throw new Error("XDM_GEOZONE_GROUP_OVERRIDE_KEY não configurado para aplicar o grupo de geozone");
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

  const deviceUid = resolveDeviceUid(vehicle);
  if (!deviceUid) {
    updateDeployment(deploymentId, {
      status: "FAILED",
      finishedAt: new Date().toISOString(),
      errorMessage: "Veículo sem IMEI cadastrado",
    });
    return;
  }

  if (!vehicle.xdmDeviceUid && deviceUid) {
    updateVehicle(vehicle.id, { xdmDeviceUid: deviceUid, deviceImei: vehicle.deviceImei || deviceUid });
  }

  try {
    const syncStart = Date.now();
    logStep(deploymentId, "SYNC_GEOFENCES", { status: "started" });
    const { xdmGeozoneGroupId, groupHash } = await syncGeozoneGroup(itinerary.id, {
      clientId: deployment.clientId,
      correlationId,
    });
    logStep(deploymentId, "SYNC_GEOFENCES", {
      status: "ok",
      xdmGeozoneGroupId,
      durationMs: Date.now() - syncStart,
    });

    const configId = await resolveConfigId({ deviceUid, correlationId });
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

    if (lastDeployment?.id !== deploymentId && lastDeployment?.status === "DEPLOYED" && lastDeployment?.requestHash === requestHash) {
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
}) {
  const active = findActiveDeploymentByPair({ itineraryId, vehicleId, clientId });
  if (active) {
    return { deployment: active, status: "ACTIVE" };
  }

  const latest = findLatestDeploymentByPair({ itineraryId, vehicleId, clientId });
  const configuredId = process.env.XDM_CONFIG_ID ? Number(process.env.XDM_CONFIG_ID) : null;
  if (latest?.status === "DEPLOYED" && latest?.requestHash && Number.isFinite(configuredId)) {
    const mapping = getGeozoneGroupMapping({ itineraryId, clientId });
    if (mapping?.groupHash) {
      const expectedHash = buildRequestHash({
        itineraryId,
        vehicleId,
        groupHash: mapping.groupHash,
        configId: configuredId,
      });
      if (expectedHash === latest.requestHash) {
        return { deployment: latest, status: "ALREADY_DEPLOYED" };
      }
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
  });

  setImmediate(() => {
    void processDeployment(deployment.id);
  });

  return { deployment, status: "QUEUED" };
}

export default {
  queueDeployment,
};
