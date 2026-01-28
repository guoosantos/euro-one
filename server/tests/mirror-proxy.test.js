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

function buildPermissionGroup({ clientId, permissions }) {
  const group = createGroup({
    name: `Mirror permissions ${randomUUID()}`,
    description: "Grupo de permissões personalizado para teste de mirror",
    clientId,
    attributes: {
      kind: "PERMISSION_GROUP",
      permissions,
    },
  });
  createdGroups.push(group.id);
  return group;
}

async function callProxy({ path, token, headers = {}, method = "GET", body }) {
  const app = express();
  app.use(express.json());
  app.use("/api", proxyRoutes);
  app.use(errorHandler);

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
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

test("GET /api/positions/last com X-Owner-Client-Id retorna 200 para usuário mirror", async () => {
  const ownerId = `owner-proxy-pos-header-${randomUUID()}`;
  const receiverId = `receiver-proxy-pos-header-${randomUUID()}`;
  const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "HDR-1001" });
  const allowedTraccarId = String(Date.now());
  buildDevice({
    clientId: ownerId,
    uniqueId: `DEV-905-${randomUUID()}`,
    traccarId: allowedTraccarId,
    vehicleId: allowedVehicle.id,
  });
  buildMirror({ ownerClientId: ownerId, targetClientId: receiverId, vehicleIds: [allowedVehicle.id] });

  const token = signSession({ id: "user-pos-header", role: "user", clientId: receiverId });
  const { status, payload } = await callProxy({
    path: `/api/positions/last?clientId=${ownerId}`,
    token,
    headers: { "X-Owner-Client-Id": ownerId },
  });

  assert.equal(status, 200);
  assert.deepEqual(positionsDeviceIds, [allowedTraccarId]);
  assert.equal(payload.data.length, 1);
  assert.equal(String(payload.data[0]?.deviceId), allowedTraccarId);
});

test("GET /api/positions/last retorna dados para tenant_admin em modo mirror", async () => {
  const ownerId = `owner-proxy-pos-tenant-${randomUUID()}`;
  const receiverId = `receiver-proxy-pos-tenant-${randomUUID()}`;
  const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "TEN-1001" });
  const allowedTraccarId = String(Date.now());
  buildDevice({
    clientId: ownerId,
    uniqueId: `DEV-tenant-${randomUUID()}`,
    traccarId: allowedTraccarId,
    vehicleId: allowedVehicle.id,
  });
  buildMirror({ ownerClientId: ownerId, targetClientId: receiverId, vehicleIds: [allowedVehicle.id] });

  const token = signSession({ id: "tenant-admin-pos", role: "tenant_admin", clientId: receiverId });
  const { status, payload } = await callProxy({
    path: `/api/positions/last?clientId=${ownerId}`,
    token,
    headers: { "X-Owner-Client-Id": ownerId },
  });

  assert.equal(status, 200);
  assert.deepEqual(positionsDeviceIds, [allowedTraccarId]);
  assert.equal(payload.data.length, 1);
  assert.equal(String(payload.data[0]?.deviceId), allowedTraccarId);
});

test("GET /api/positions/last retorna 403 quando mirror não possui permissão de monitoramento", async () => {
  const ownerId = `owner-proxy-pos-deny-${randomUUID()}`;
  const receiverId = `receiver-proxy-pos-deny-${randomUUID()}`;
  const permissions = JSON.parse(JSON.stringify(MIRROR_FALLBACK_PERMISSIONS));
  permissions.primary.monitoring.access = "none";
  const permissionGroup = buildPermissionGroup({ clientId: ownerId, permissions });
  const mirror = createMirror({
    ownerClientId: ownerId,
    targetClientId: receiverId,
    vehicleIds: [],
    targetType: "GERENCIADORA",
    permissionGroupId: permissionGroup.id,
  });
  createdMirrors.push(mirror.id);

  const token = signSession({ id: "user-pos-deny", role: "user", clientId: receiverId });
  const { status } = await callProxy({ path: `/api/positions/last?clientId=${ownerId}`, token });

  assert.equal(status, 403);
});

test("GET /api/devices com X-Owner-Client-Id retorna 200 no mirror", async () => {
  const ownerId = `owner-proxy-devices-${randomUUID()}`;
  const receiverId = `receiver-proxy-devices-${randomUUID()}`;
  const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "DEV-1001" });
  const blockedVehicle = buildVehicle({ clientId: ownerId, plate: "DEV-1002" });
  const allowedTraccarId = String(Date.now());
  buildDevice({
    clientId: ownerId,
    uniqueId: `DEV-906-${randomUUID()}`,
    traccarId: allowedTraccarId,
    vehicleId: allowedVehicle.id,
  });
  buildDevice({
    clientId: ownerId,
    uniqueId: `DEV-907-${randomUUID()}`,
    traccarId: String(Number(allowedTraccarId) + 1),
    vehicleId: blockedVehicle.id,
  });
  buildMirror({ ownerClientId: ownerId, targetClientId: receiverId, vehicleIds: [allowedVehicle.id] });

  const token = signSession({ id: "user-devices-header", role: "user", clientId: receiverId });
  const { status, payload } = await callProxy({
    path: `/api/devices?all=true&clientId=${ownerId}`,
    token,
    headers: { "X-Owner-Client-Id": ownerId },
  });

  assert.equal(status, 200);
  assert.equal(payload.devices.length, 1);
  assert.equal(String(payload.devices[0]?.id), allowedTraccarId);
});

test("POST /api/devices mantém 403 para role user mesmo em mirror", async () => {
  const ownerId = `owner-proxy-post-${randomUUID()}`;
  const receiverId = `receiver-proxy-post-${randomUUID()}`;
  const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "POST-1001" });
  buildDevice({
    clientId: ownerId,
    uniqueId: `DEV-908-${randomUUID()}`,
    traccarId: String(Date.now()),
    vehicleId: allowedVehicle.id,
  });
  buildMirror({ ownerClientId: ownerId, targetClientId: receiverId, vehicleIds: [allowedVehicle.id] });

  const token = signSession({ id: "user-post", role: "user", clientId: receiverId });
  const { status, payload } = await callProxy({
    path: "/api/devices",
    token,
    method: "POST",
    headers: { "X-Owner-Client-Id": ownerId },
    body: { name: "Device", uniqueId: "NEW-DEVICE" },
  });

  assert.equal(status, 403);
  assert.equal(payload.message, "Permissão insuficiente");
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

test("GET /api/devices?all=true retorna apenas devices do espelhamento", async () => {
  const ownerId = `owner-proxy-dev-${randomUUID()}`;
  const receiverId = `receiver-proxy-dev-${randomUUID()}`;
  const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "MIR-3001" });
  const blockedVehicle = buildVehicle({ clientId: ownerId, plate: "MIR-3002" });
  const allowedDevice = buildDevice({
    clientId: ownerId,
    uniqueId: `DEV-905-${randomUUID()}`,
    traccarId: String(Date.now()),
    vehicleId: allowedVehicle.id,
  });
  buildDevice({
    clientId: ownerId,
    uniqueId: `DEV-906-${randomUUID()}`,
    traccarId: String(Date.now() + 1),
    vehicleId: blockedVehicle.id,
  });
  buildMirror({ ownerClientId: ownerId, targetClientId: receiverId, vehicleIds: [allowedVehicle.id] });

  const token = signSession({ id: "user-devices", role: "user", clientId: receiverId });
  const { status, payload } = await callProxy({ path: `/api/devices?all=true&clientId=${ownerId}`, token });

  assert.equal(status, 200);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0]?.uniqueId, allowedDevice.uniqueId);
});
