import { randomUUID } from "node:crypto";

import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "xdm_deployments";
const deployments = loadCollection(STORAGE_KEY, []);

const ACTIVE_STATUSES = new Set(["QUEUED", "SYNCING", "DEPLOYING"]);

function clone(record) {
  if (!record) return null;
  return JSON.parse(JSON.stringify(record));
}

function persist() {
  saveCollection(STORAGE_KEY, deployments);
}

export function createDeployment({
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
  status = "SYNCING",
  finishedAt = null,
  errorMessage = null,
  errorDetails = null,
  snapshot = null,
  action = "EMBARK",
}) {
  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    clientId: String(clientId),
    itineraryId: String(itineraryId),
    vehicleId: String(vehicleId),
    deviceImei: deviceImei || null,
    xdmGeozoneGroupId: xdmGeozoneGroupId || null,
    xdmGeozoneGroupIds: xdmGeozoneGroupIds || null,
    groupHash: groupHash || null,
    groupHashes: groupHashes || null,
    configId: Number.isFinite(Number(configId)) ? Number(configId) : null,
    action: action || "EMBARK",
    status: status || "SYNCING",
    xdmDeploymentId: null,
    requestHash: null,
    startedAt: now,
    finishedAt: finishedAt || null,
    confirmedAt: null,
    deviceConfirmedAt: null,
    errorMessage: errorMessage || null,
    errorDetails: errorDetails || null,
    correlationId: null,
    requestedByUserId: requestedByUserId || null,
    requestedByName: requestedByName || null,
    ipAddress: ipAddress || null,
    snapshot: snapshot || null,
    logs: [],
  };
  deployments.push(record);
  persist();
  return clone(record);
}

export function listDeployments({ clientId, status } = {}) {
  return deployments
    .filter((item) => (!clientId ? true : String(item.clientId) === String(clientId)))
    .filter((item) => (!status ? true : item.status === status))
    .map(clone);
}

export function clearDeployments() {
  deployments.length = 0;
  persist();
}

export function getDeploymentById(id) {
  const record = deployments.find((item) => String(item.id) === String(id));
  return clone(record);
}

export function updateDeployment(id, updates = {}) {
  const index = deployments.findIndex((item) => String(item.id) === String(id));
  if (index < 0) return null;
  deployments[index] = { ...deployments[index], ...updates };
  persist();
  return clone(deployments[index]);
}

export function appendDeploymentLog(id, entry) {
  const record = deployments.find((item) => String(item.id) === String(id));
  if (!record) return null;
  record.logs = Array.isArray(record.logs) ? record.logs : [];
  record.logs.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    ...entry,
  });
  persist();
  return clone(record);
}

export function findActiveDeploymentByPair({ itineraryId, vehicleId, clientId }) {
  return clone(
    deployments
      .filter((item) =>
        String(item.itineraryId) === String(itineraryId) &&
        String(item.vehicleId) === String(vehicleId) &&
        (!clientId || String(item.clientId) === String(clientId)) &&
        ACTIVE_STATUSES.has(item.status),
      )
      .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime())[0],
  );
}

export function findLatestDeploymentByPair({ itineraryId, vehicleId, clientId }) {
  return clone(
    deployments
      .filter((item) =>
        String(item.itineraryId) === String(itineraryId) &&
        String(item.vehicleId) === String(vehicleId) &&
        (!clientId || String(item.clientId) === String(clientId)),
      )
      .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime())[0],
  );
}

export function listLatestDeploymentsByItinerary({ itineraryId, clientId } = {}) {
  const latestByVehicle = new Map();
  deployments
    .filter((item) => (!clientId ? true : String(item.clientId) === String(clientId)))
    .filter((item) => (!itineraryId ? true : String(item.itineraryId) === String(itineraryId)))
    .forEach((deployment) => {
      const vehicleKey = String(deployment.vehicleId);
      const current = latestByVehicle.get(vehicleKey);
      const currentTime = current ? new Date(current.startedAt || 0).getTime() : 0;
      const nextTime = new Date(deployment.startedAt || 0).getTime();
      if (!current || nextTime > currentTime) {
        latestByVehicle.set(vehicleKey, deployment);
      }
    });
  return Array.from(latestByVehicle.values()).map(clone);
}

export function listDeploymentsByStatus(statuses = []) {
  const statusSet = new Set(statuses);
  return deployments.filter((item) => statusSet.has(item.status)).map(clone);
}

export function toHistoryEntries({ deploymentsList, vehiclesById = new Map(), itinerariesById = new Map() }) {
  return deploymentsList
    .map((deployment) => {
      const vehicle = vehiclesById.get(String(deployment.vehicleId));
      const itinerary = itinerariesById.get(String(deployment.itineraryId));
      const snapshotItinerary = deployment.snapshot?.itinerary || null;
      const deviceConfirmedAt = deployment.deviceConfirmedAt || deployment.confirmedAt || null;
      return {
        id: deployment.id,
        clientId: deployment.clientId,
        itineraryId: deployment.itineraryId,
        itineraryName: itinerary?.name || snapshotItinerary?.name || deployment.itineraryName || null,
        vehicleId: deployment.vehicleId,
        vehicleName: vehicle?.name || null,
        plate: vehicle?.plate || null,
        brand: vehicle?.brand || null,
        model: vehicle?.model || null,
        sentAt: deployment.startedAt,
        receivedAt: deviceConfirmedAt,
        receivedAtDevice: deviceConfirmedAt,
        deviceConfirmedAt,
        sentBy: deployment.requestedByUserId || null,
        sentByName: deployment.requestedByName || null,
        ipAddress: deployment.ipAddress || null,
        status: deployment.status,
        statusCode: deployment.status,
        action: deployment.action || "EMBARK",
        result: deployment.errorMessage || null,
        details: deployment.errorDetails || null,
        snapshot: deployment.snapshot || null,
      };
    })
    .sort((a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime());
}

export default {
  createDeployment,
  listDeployments,
  clearDeployments,
  getDeploymentById,
  updateDeployment,
  appendDeploymentLog,
  findActiveDeploymentByPair,
  findLatestDeploymentByPair,
  listLatestDeploymentsByItinerary,
  listDeploymentsByStatus,
  toHistoryEntries,
};
