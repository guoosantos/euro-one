import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import express from "express";

import { config } from "../config.js";
import { signSession } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { MIRROR_FALLBACK_PERMISSIONS } from "../middleware/permissions.js";
import { createDevice, deleteDevice, listDevices, updateDevice } from "../models/device.js";
import { createGroup, deleteGroup } from "../models/group.js";
import { createMirror, deleteMirror } from "../models/mirror.js";
import { createVehicle, deleteVehicle } from "../models/vehicle.js";
import { __resetTraccarDbForTests, __setTraccarDbTestOverrides } from "../services/traccar-db.js";
import { randomUUID } from "node:crypto";
import proxyRoutes from "../routes/proxy.js";

let positionsDeviceIds = [];
let eventsDeviceIds = [];

const createdVehicles = [];
const createdDevices = [];
const createdMirrors = [];
const createdGroups = [];
const originalMirrorMode = config.features.mirrorMode;

function buildVehicle({ clientId, plate }) {
  const vehicle = createVehicle({ clientId, plate, model: "Modelo", name: plate, type: "Carro" });
  createdVehicles.push(vehicle.id);
  return vehicle;
}

function buildDevice({ clientId, uniqueId, traccarId, vehicleId }) {
  const device = createDevice({ clientId, uniqueId, traccarId });
  createdDevices.push(device.id);
  if (vehicleId) {
    updateDevice(device.id, { vehicleId });
  }
  return device;
}

function buildMirror({ ownerClientId, targetClientId, vehicleIds }) {
  const permissionGroup = createGroup({
    name: `Mirror permissions ${randomUUID()}`,
    description: "Grupo de permissões para teste de mirror",
    clientId: ownerClientId,
    attributes: {
      kind: "PERMISSION_GROUP",
      permissions: MIRROR_FALLBACK_PERMISSIONS,
    },
  });
  createdGroups.push(permissionGroup.id);
  const mirror = createMirror({
    ownerClientId,
    targetClientId,
    vehicleIds,
    targetType: "GERENCIADORA",
    permissionGroupId: permissionGroup.id,
  });
  createdMirrors.push(mirror.id);
  return mirror;
}

async function callProxy({ path, token }) {
  const app = express();
  app.use(express.json());
  app.use("/api", proxyRoutes);
  app.use(errorHandler);

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  server.close();
  return { status: response.status, payload };
}

beforeEach(() => {
  config.features.mirrorMode = true;
  positionsDeviceIds = [];
  eventsDeviceIds = [];
  __setTraccarDbTestOverrides({
    fetchLatestPositionsWithFallback: async (deviceIds) => {
      positionsDeviceIds = [...deviceIds];
      return deviceIds.map((deviceId) => ({
        id: `pos-${deviceId}`,
        deviceId: Number(deviceId),
        latitude: 0,
        longitude: 0,
        deviceTime: new Date().toISOString(),
      }));
    },
    fetchEventsWithFallback: async (deviceIds) => {
      eventsDeviceIds = [...deviceIds];
      return deviceIds.map((deviceId) => ({
        id: `evt-${deviceId}`,
        deviceId: Number(deviceId),
        eventTime: new Date().toISOString(),
        attributes: {},
      }));
    },
    fetchDevicesMetadata: async () => [],
    fetchPositionsByIds: async () => [],
  });
});

afterEach(() => {
  createdDevices.splice(0).forEach((id) => {
    try {
      deleteDevice(id);
    } catch (_error) {
      // ignore
    }
  });
  createdVehicles.splice(0).forEach((id) => {
    try {
      deleteVehicle(id);
    } catch (_error) {
      // ignore
    }
  });
  createdMirrors.splice(0).forEach((id) => {
    try {
      deleteMirror(id);
    } catch (_error) {
      // ignore
    }
  });
  createdGroups.splice(0).forEach((id) => {
    try {
      deleteGroup(id);
    } catch (_error) {
      // ignore
    }
  });
  __resetTraccarDbForTests();
  config.features.mirrorMode = originalMirrorMode;
});

test("GET /api/positions/last retorna apenas posições dos veículos do espelho", async () => {
  const ownerId = `owner-proxy-pos-${randomUUID()}`;
  const receiverId = `receiver-proxy-pos-${randomUUID()}`;
  const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "MIR-1001" });
  const blockedVehicle = buildVehicle({ clientId: ownerId, plate: "MIR-1002" });
  const allowedTraccarId = String(Date.now());
  const blockedTraccarId = String(Number(allowedTraccarId) + 1);
  buildDevice({
    clientId: ownerId,
    uniqueId: `DEV-901-${randomUUID()}`,
    traccarId: allowedTraccarId,
    vehicleId: allowedVehicle.id,
  });
  buildDevice({
    clientId: ownerId,
    uniqueId: `DEV-902-${randomUUID()}`,
    traccarId: blockedTraccarId,
    vehicleId: blockedVehicle.id,
  });
  buildMirror({ ownerClientId: ownerId, targetClientId: receiverId, vehicleIds: [allowedVehicle.id] });

  const devices = listDevices({ clientId: ownerId });
  const allowedDevice = devices.find((device) => String(device.vehicleId) === String(allowedVehicle.id));
  assert.equal(String(allowedDevice?.traccarId), allowedTraccarId);

  const token = signSession({ id: "user-pos", role: "user", clientId: receiverId });
  const { status, payload } = await callProxy({ path: `/api/positions/last?clientId=${ownerId}`, token });

  assert.equal(status, 200);
  assert.deepEqual(positionsDeviceIds, [allowedTraccarId]);
  assert.equal(payload.data.length, 1);
  assert.equal(String(payload.data[0]?.deviceId), allowedTraccarId);
});

test("GET /api/events retorna apenas eventos dos veículos do espelho", async () => {
  const ownerId = `owner-proxy-events-${randomUUID()}`;
  const receiverId = `receiver-proxy-events-${randomUUID()}`;
  const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "MIR-2001" });
  const blockedVehicle = buildVehicle({ clientId: ownerId, plate: "MIR-2002" });
  const allowedTraccarId = String(Date.now());
  const blockedTraccarId = String(Number(allowedTraccarId) + 1);
  buildDevice({
    clientId: ownerId,
    uniqueId: `DEV-903-${randomUUID()}`,
    traccarId: allowedTraccarId,
    vehicleId: allowedVehicle.id,
  });
  buildDevice({
    clientId: ownerId,
    uniqueId: `DEV-904-${randomUUID()}`,
    traccarId: blockedTraccarId,
    vehicleId: blockedVehicle.id,
  });
  buildMirror({ ownerClientId: ownerId, targetClientId: receiverId, vehicleIds: [allowedVehicle.id] });

  const devices = listDevices({ clientId: ownerId });
  const allowedDevice = devices.find((device) => String(device.vehicleId) === String(allowedVehicle.id));
  assert.equal(String(allowedDevice?.traccarId), allowedTraccarId);

  const token = signSession({ id: "user-events", role: "user", clientId: receiverId });
  const { status, payload } = await callProxy({ path: `/api/events?clientId=${ownerId}`, token });

  assert.equal(status, 200);
  assert.deepEqual(eventsDeviceIds, [allowedTraccarId]);
  assert.equal(payload.events.length, 1);
  assert.equal(String(payload.events[0]?.deviceId), allowedTraccarId);
});
