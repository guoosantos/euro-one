import assert from "node:assert/strict";
import express from "express";
import { afterEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { config } from "../config.js";
import { signSession } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { MIRROR_FALLBACK_PERMISSIONS } from "../middleware/permissions.js";
import { createGroup, deleteGroup } from "../models/group.js";
import { getAccessibleVehicles } from "../services/accessible-vehicles.js";
import { createVehicle, deleteVehicle } from "../models/vehicle.js";
import { createDevice, deleteDevice, updateDevice } from "../models/device.js";
import { createMirror, deleteMirror } from "../models/mirror.js";
import alertRoutes from "../routes/alerts.js";
import coreRoutes, { __resetCoreRouteMocks, __setCoreRouteMocks } from "../routes/core.js";
import { filterAlertsByVehicleAccess } from "../routes/alerts.js";
import { upsertAlertFromEvent } from "../services/alerts.js";
import { __resetTraccarDbForTests, __setTraccarDbTestOverrides } from "../services/traccar-db.js";
import { saveCollection } from "../services/storage.js";

const createdVehicles = [];
const createdDevices = [];
const createdMirrors = [];
const createdGroups = [];
const originalMirrorMode = config.features.mirrorMode;

function buildVehicle({ clientId, plate, model, type = "Carro" }) {
  const vehicle = createVehicle({
    clientId,
    plate,
    model,
    name: model,
    type,
  });
  createdVehicles.push(vehicle.id);
  return vehicle;
}

function buildDevice({ clientId, uniqueId, vehicleId = null, traccarId = null }) {
  const device = createDevice({ clientId, uniqueId, traccarId });
  createdDevices.push(device.id);
  if (vehicleId) {
    updateDevice(device.id, { vehicleId });
  }
  return device;
}

function buildMirror({ ownerClientId, targetClientId, vehicleIds = [] }) {
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

async function callAlertsConjugated({ clientId }) {
  const app = express();
  app.use(express.json());
  app.use("/api", alertRoutes);
  app.use(errorHandler);

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = signSession({ id: "user-1", role: "user", clientId });
  const response = await fetch(`${baseUrl}/api/alerts/conjugated?clientId=${clientId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const payload = await response.json();
  server.close();
  return { status: response.status, payload };
}

async function callAlerts({ clientId, token }) {
  const app = express();
  app.use(express.json());
  app.use("/api", alertRoutes);
  app.use(errorHandler);

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/alerts?clientId=${clientId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  server.close();
  return { status: response.status, payload };
}

afterEach(() => {
  createdVehicles.splice(0).forEach((id) => {
    try {
      deleteVehicle(id);
    } catch (_error) {
      // ignora limpeza
    }
  });
  createdDevices.splice(0).forEach((id) => {
    try {
      deleteDevice(id);
    } catch (_error) {
      // ignora limpeza
    }
  });
  createdMirrors.splice(0).forEach((id) => {
    try {
      deleteMirror(id);
    } catch (_error) {
      // ignora limpeza
    }
  });
  createdGroups.splice(0).forEach((id) => {
    try {
      deleteGroup(id);
    } catch (_error) {
      // ignora limpeza
    }
  });
  __resetCoreRouteMocks();
  __resetTraccarDbForTests();
  saveCollection("vehicle-alerts", {});
  config.features.mirrorMode = originalMirrorMode;
});

describe("getAccessibleVehicles (mirror)", () => {
  it("retorna apenas veículos permitidos do owner quando mirrorContext ativo", async () => {
    config.features.mirrorMode = true;
    const ownerId = "owner-1";
    const receiverId = "receiver-1";
    const allowed = buildVehicle({ clientId: ownerId, plate: "AAA-0001", model: "Modelo A" });
    buildVehicle({ clientId: ownerId, plate: "AAA-0002", model: "Modelo B" });

    const access = await getAccessibleVehicles({
      user: { id: "user-1", clientId: receiverId },
      clientId: ownerId,
      mirrorContext: {
        ownerClientId: ownerId,
        vehicleIds: [allowed.id],
      },
    });

    assert.equal(access.isReceiver, true);
    assert.equal(access.clientId, ownerId);
    assert.deepEqual(access.mirrorOwnerIds, [ownerId]);
    assert.deepEqual(access.vehicles.map((vehicle) => vehicle.id), [allowed.id]);
  });

  it("mantém comportamento padrão quando mirrorContext ausente", async () => {
    config.features.mirrorMode = true;
    const receiverId = "receiver-2";
    const receiverVehicle = buildVehicle({ clientId: receiverId, plate: "BBB-0001", model: "Modelo C" });

    const access = await getAccessibleVehicles({ clientId: receiverId });

    assert.deepEqual(access.vehicles.map((vehicle) => vehicle.id), [receiverVehicle.id]);
    assert.equal(access.isReceiver, false);
  });
});

describe("/api/alerts/conjugated", () => {
  it("retorna lista vazia com 200 quando não há devices", async () => {
    const clientId = "empty-client";
    const { status, payload } = await callAlertsConjugated({ clientId });

    assert.equal(status, 200);
    assert.deepEqual(payload.data, []);
    assert.equal(payload.total, 0);
  });
});

describe("/api/alerts", () => {
  it("retorna 200 com payload vazio quando mirror não tem veículos", async () => {
    config.features.mirrorMode = true;
    const ownerId = "owner-alerts";
    const receiverId = "receiver-alerts";
    buildMirror({ ownerClientId: ownerId, targetClientId: receiverId, vehicleIds: ["veh-x"] });

    const token = signSession({ id: "user-alerts", role: "user", clientId: receiverId });
    const { status, payload } = await callAlerts({ clientId: ownerId, token });

    assert.equal(status, 200);
    assert.deepEqual(payload.data, []);
    assert.equal(payload.total, 0);
  });

  it("retorna apenas alertas dos veículos permitidos no espelhamento", async () => {
    config.features.mirrorMode = true;
    const ownerId = "owner-alerts-filter";
    const receiverId = "receiver-alerts-filter";
    const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "ALT-1001", model: "Modelo A" });
    const blockedVehicle = buildVehicle({ clientId: ownerId, plate: "ALT-1002", model: "Modelo B" });
    buildMirror({ ownerClientId: ownerId, targetClientId: receiverId, vehicleIds: [allowedVehicle.id] });

    upsertAlertFromEvent({
      clientId: ownerId,
      event: { id: "evt-allowed", eventTime: new Date().toISOString() },
      configuredEvent: { requiresHandling: true, active: true },
      vehicleId: allowedVehicle.id,
    });
    upsertAlertFromEvent({
      clientId: ownerId,
      event: { id: "evt-blocked", eventTime: new Date().toISOString() },
      configuredEvent: { requiresHandling: true, active: true },
      vehicleId: blockedVehicle.id,
    });

    const token = signSession({ id: "user-alerts-filter", role: "user", clientId: receiverId });
    const { status, payload } = await callAlerts({ clientId: ownerId, token });

    assert.equal(status, 200);
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0]?.vehicleId, allowedVehicle.id);
  });
});

describe("/api/alerts/conjugated (mirror)", () => {
  it("consulta apenas devices do espelhamento", async () => {
    config.features.mirrorMode = true;
    const ownerId = "owner-alerts-conjugated";
    const receiverId = "receiver-alerts-conjugated";
    const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "CON-1001", model: "Modelo C" });
    const blockedVehicle = buildVehicle({ clientId: ownerId, plate: "CON-1002", model: "Modelo D" });
    const allowedTraccarId = String(Date.now());
    const blockedTraccarId = String(Number(allowedTraccarId) + 1);
    buildDevice({
      clientId: ownerId,
      uniqueId: `DEV-CON-1-${randomUUID()}`,
      vehicleId: allowedVehicle.id,
      traccarId: allowedTraccarId,
    });
    buildDevice({
      clientId: ownerId,
      uniqueId: `DEV-CON-2-${randomUUID()}`,
      vehicleId: blockedVehicle.id,
      traccarId: blockedTraccarId,
    });
    buildMirror({ ownerClientId: ownerId, targetClientId: receiverId, vehicleIds: [allowedVehicle.id] });

    let requestedDeviceIds = [];
    __setTraccarDbTestOverrides({
      fetchEventsWithFallback: async (deviceIds) => {
        requestedDeviceIds = [...deviceIds];
        return deviceIds.map((deviceId) => ({
          id: `evt-${deviceId}`,
          deviceId: Number(deviceId),
          eventTime: new Date().toISOString(),
          attributes: {},
        }));
      },
    });

    const token = signSession({ id: "user-alerts-conjugated", role: "user", clientId: receiverId });
    const app = express();
    app.use(express.json());
    app.use("/api", alertRoutes);
    app.use(errorHandler);

    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/alerts/conjugated?clientId=${ownerId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    server.close();

    assert.equal(response.status, 200);
    assert.deepEqual(requestedDeviceIds, [allowedTraccarId]);
    assert.ok(Array.isArray(payload.data));
  });
});

describe("mirror access (core routes)", () => {
  it("lista apenas veículos permitidos no mirror", async () => {
    config.features.mirrorMode = true;
    const ownerId = "owner-vehicles";
    const receiverId = "receiver-vehicles";
    const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "MMM-1001", model: "Modelo M" });
    const blockedVehicle = buildVehicle({ clientId: ownerId, plate: "MMM-1002", model: "Modelo N" });
    buildDevice({ clientId: ownerId, uniqueId: "DEV-1", vehicleId: allowedVehicle.id });
    buildDevice({ clientId: ownerId, uniqueId: "DEV-2", vehicleId: blockedVehicle.id });
    const permissionGroup = createGroup({
      name: `Mirror permissions ${randomUUID()}`,
      description: "Grupo de permissões para teste de mirror",
      clientId: ownerId,
      attributes: {
        kind: "PERMISSION_GROUP",
        permissions: MIRROR_FALLBACK_PERMISSIONS,
      },
    });
    createdGroups.push(permissionGroup.id);

    __setCoreRouteMocks({
      authenticate: (req, _res, next) => {
        req.user = { id: "user-vehicles", role: "user", clientId: receiverId };
        const ownerHeader = req.headers["x-owner-client-id"];
        if (ownerHeader) {
          req.mirrorContext = {
            mode: "target",
            ownerClientId: String(ownerHeader),
            vehicleIds: [allowedVehicle.id],
            permissionGroupId: permissionGroup.id,
          };
          req.clientId = String(ownerHeader);
        }
        next();
      },
      fetchLatestPositionsWithFallback: async () => [],
      fetchDevicesMetadata: async () => [],
      getCachedTraccarResources: () => [],
      isTraccarDbConfigured: () => false,
    });

    const app = express();
    app.use(express.json());
    app.use("/api", coreRoutes);
    app.use(errorHandler);

    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(
      `${baseUrl}/api/vehicles?clientId=${ownerId}&accessible=true`,
      { headers: { "X-Owner-Client-Id": ownerId } },
    );
    const payload = await response.json();
    server.close();

    assert.equal(response.status, 200);
    assert.equal(payload.vehicles.length, 1);
    assert.equal(payload.vehicles[0].id, allowedVehicle.id);
  });

  it("retorna 404 ao acessar veículo fora do espelhamento", async () => {
    config.features.mirrorMode = true;
    const ownerId = "owner-detail";
    const receiverId = "receiver-detail";
    const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "DDD-2001", model: "Modelo D" });
    const blockedVehicle = buildVehicle({ clientId: ownerId, plate: "DDD-2002", model: "Modelo E" });
    buildDevice({ clientId: ownerId, uniqueId: "DEV-3", vehicleId: allowedVehicle.id, traccarId: "101" });
    const permissionGroup = createGroup({
      name: `Mirror permissions ${randomUUID()}`,
      description: "Grupo de permissões para teste de mirror",
      clientId: ownerId,
      attributes: {
        kind: "PERMISSION_GROUP",
        permissions: MIRROR_FALLBACK_PERMISSIONS,
      },
    });
    createdGroups.push(permissionGroup.id);

    __setCoreRouteMocks({
      authenticate: (req, _res, next) => {
        req.user = { id: "user-detail", role: "user", clientId: receiverId };
        const ownerHeader = req.headers["x-owner-client-id"];
        if (ownerHeader) {
          req.mirrorContext = {
            mode: "target",
            ownerClientId: String(ownerHeader),
            vehicleIds: [allowedVehicle.id],
            permissionGroupId: permissionGroup.id,
          };
          req.clientId = String(ownerHeader);
        }
        next();
      },
      fetchLatestPositionsWithFallback: async () => [],
      fetchDevicesMetadata: async () => [],
      isTraccarDbConfigured: () => false,
      traccarProxy: async () => ({ id: 101, name: "Device", uniqueId: "DEV-3" }),
      getCachedTraccarResources: () => [],
    });

    const app = express();
    app.use(express.json());
    app.use("/api", coreRoutes);
    app.use(errorHandler);

    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(
      `${baseUrl}/api/vehicles/${blockedVehicle.id}/traccar-device?clientId=${ownerId}`,
      { headers: { "X-Owner-Client-Id": ownerId } },
    );
    const payload = await response.json();
    server.close();

    assert.equal(response.status, 404);
    assert.equal(payload.message, "Veículo não encontrado para este espelhamento");
  });

  it("telemetria retorna apenas dispositivos permitidos no mirror", async () => {
    config.features.mirrorMode = true;
    const ownerId = "owner-telemetry";
    const receiverId = "receiver-telemetry";
    const allowedVehicle = buildVehicle({ clientId: ownerId, plate: "TEL-3001", model: "Modelo T" });
    const blockedVehicle = buildVehicle({ clientId: ownerId, plate: "TEL-3002", model: "Modelo U" });
    const allowedTraccarId = String(Math.floor(Math.random() * 900000) + 100000);
    const blockedTraccarId = String(Number(allowedTraccarId) + 1);
    buildDevice({
      clientId: ownerId,
      uniqueId: `DEV-4-${randomUUID()}`,
      vehicleId: allowedVehicle.id,
      traccarId: allowedTraccarId,
    });
    buildDevice({
      clientId: ownerId,
      uniqueId: `DEV-5-${randomUUID()}`,
      vehicleId: blockedVehicle.id,
      traccarId: blockedTraccarId,
    });
    const permissionGroup = createGroup({
      name: `Mirror permissions ${randomUUID()}`,
      description: "Grupo de permissões para teste de mirror",
      clientId: ownerId,
      attributes: {
        kind: "PERMISSION_GROUP",
        permissions: MIRROR_FALLBACK_PERMISSIONS,
      },
    });
    createdGroups.push(permissionGroup.id);

    __setCoreRouteMocks({
      authenticate: (req, _res, next) => {
        req.user = { id: "user-telemetry", role: "user", clientId: receiverId };
        const ownerHeader = req.headers["x-owner-client-id"];
        if (ownerHeader) {
          req.mirrorContext = {
            mode: "target",
            ownerClientId: String(ownerHeader),
            vehicleIds: [allowedVehicle.id],
            permissionGroupId: permissionGroup.id,
          };
          req.clientId = String(ownerHeader);
        }
        next();
      },
      fetchLatestPositionsWithFallback: async (deviceIds) =>
        deviceIds.map((deviceId) => ({
          deviceId: Number(deviceId),
          latitude: 0,
          longitude: 0,
          deviceTime: new Date().toISOString(),
        })),
      fetchDevicesMetadata: async () => [],
      getCachedTraccarResources: () => [],
      isTraccarDbConfigured: () => false,
    });

    const app = express();
    app.use(express.json());
    app.use("/api", coreRoutes);
    app.use(errorHandler);

    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/telemetry?clientId=${ownerId}`, {
      headers: { "X-Owner-Client-Id": ownerId },
    });
    const payload = await response.json();
    server.close();

    assert.equal(response.status, 200);
    const telemetry = payload.telemetry || [];
    assert.equal(telemetry.length, 1);
    assert.equal(String(telemetry[0]?.deviceId || telemetry[0]?.device?.id), allowedTraccarId);
  });
});

describe("mirror alerts filter", () => {
  it("filtra alertas por veículos permitidos", () => {
    const allowedVehicleIds = new Set(["veh-1"]);
    const alerts = [
      { id: "a-1", vehicleId: "veh-1" },
      { id: "a-2", vehicleId: "veh-2" },
    ];
    const filtered = filterAlertsByVehicleAccess(alerts, allowedVehicleIds);
    assert.deepEqual(filtered.map((alert) => alert.id), ["a-1"]);
  });
});
