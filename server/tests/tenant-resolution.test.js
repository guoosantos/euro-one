import assert from "node:assert/strict";
import express from "express";
import { afterEach, describe, it } from "node:test";

import { config } from "../config.js";
import { signSession } from "../middleware/auth.js";
import { resolveTenant } from "../middleware/tenant.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createDevice, deleteDevice, updateDevice } from "../models/device.js";
import { createMirror, deleteMirror } from "../models/mirror.js";
import { createVehicle, deleteVehicle, updateVehicle } from "../models/vehicle.js";
import contextRoutes from "../routes/context.js";
import coreRoutes, { __resetCoreRouteMocks, __setCoreRouteMocks } from "../routes/core.js";

const createdVehicles = [];
const createdDevices = [];
const createdMirrors = [];
const originalMirrorMode = config.features.mirrorMode;
const originalTenantFallback = config.features.tenantFallbackToSelf;

function buildVehicle({ clientId, plate, model }) {
  const vehicle = createVehicle({ clientId, plate, model, name: model, type: "Carro" });
  createdVehicles.push(vehicle.id);
  return vehicle;
}

function buildDevice({ clientId, uniqueId, vehicleId }) {
  const device = createDevice({ clientId, uniqueId, traccarId: null });
  createdDevices.push(device.id);
  if (vehicleId) {
    updateDevice(device.id, { vehicleId });
    updateVehicle(vehicleId, { deviceId: device.id });
  }
  return device;
}

function setupApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", contextRoutes);
  app.use("/api/core", coreRoutes);
  app.use(errorHandler);
  return app;
}

async function callEndpoint(app, { path, token }) {
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }
  server.close();
  return { status: response.status, payload };
}

afterEach(() => {
  createdVehicles.splice(0).forEach((id) => {
    try {
      deleteVehicle(id);
    } catch (_error) {
      // ignore cleanup
    }
  });
  createdDevices.splice(0).forEach((id) => {
    try {
      deleteDevice(id);
    } catch (_error) {
      // ignore cleanup
    }
  });
  createdMirrors.splice(0).forEach((id) => {
    try {
      deleteMirror(id);
    } catch (_error) {
      // ignore cleanup
    }
  });
  __resetCoreRouteMocks();
  config.features.mirrorMode = originalMirrorMode;
  config.features.tenantFallbackToSelf = originalTenantFallback;
});

describe("tenant resolution", () => {
  it("permite usuário acessar somente seu clientId", async () => {
    const clientId = "client-own";
    const otherClientId = "client-other";
    buildVehicle({ clientId, plate: "AAA-0001", model: "Modelo A" });
    buildDevice({ clientId, uniqueId: "DEV-OWN", vehicleId: createdVehicles[0] });
    buildVehicle({ clientId: otherClientId, plate: "BBB-0001", model: "Modelo B" });
    buildDevice({ clientId: otherClientId, uniqueId: "DEV-OTHER", vehicleId: createdVehicles[1] });

    __setCoreRouteMocks({
      fetchLatestPositionsWithFallback: async () => [],
      fetchDevicesMetadata: async () => [],
      getCachedTraccarResources: () => [],
      isTraccarDbConfigured: () => false,
    });

    const app = setupApp();
    const token = signSession({ id: "user-own", role: "user", clientId });

    const allowedResponse = await callEndpoint(app, {
      path: `/api/core/vehicles?clientId=${clientId}`,
      token,
    });

    assert.equal(allowedResponse.status, 200);
    assert.equal(allowedResponse.payload?.vehicles?.length, 1);
    assert.equal(allowedResponse.payload.vehicles[0].clientId, clientId);

    const blockedResponse = await callEndpoint(app, {
      path: `/api/core/vehicles?clientId=${otherClientId}`,
      token,
    });

    assert.equal(blockedResponse.status, 403);
  });

  it("gerenciadora com mirror acessa clientId do dono com dados filtrados", async () => {
    config.features.mirrorMode = true;
    const ownerClientId = "owner-client";
    const receiverClientId = "receiver-client";
    const allowedVehicle = buildVehicle({ clientId: ownerClientId, plate: "CCC-1001", model: "Modelo C" });
    buildDevice({ clientId: ownerClientId, uniqueId: "DEV-ALLOW", vehicleId: allowedVehicle.id });
    buildVehicle({ clientId: ownerClientId, plate: "CCC-1002", model: "Modelo D" });
    buildDevice({ clientId: ownerClientId, uniqueId: "DEV-BLOCK", vehicleId: createdVehicles[1] });

    const mirror = createMirror({
      ownerClientId,
      targetClientId: receiverClientId,
      vehicleIds: [allowedVehicle.id],
      targetType: "GERENCIADORA",
    });
    createdMirrors.push(mirror.id);

    __setCoreRouteMocks({
      fetchLatestPositionsWithFallback: async () => [],
      fetchDevicesMetadata: async () => [],
      getCachedTraccarResources: () => [],
      isTraccarDbConfigured: () => false,
    });

    const app = setupApp();
    const token = signSession({ id: "user-mirror", role: "user", clientId: receiverClientId });

    const response = await callEndpoint(app, {
      path: `/api/core/vehicles?clientId=${ownerClientId}`,
      token,
    });

    assert.equal(response.status, 200);
    assert.equal(response.payload?.vehicles?.length, 1);
    assert.equal(response.payload.vehicles[0].id, allowedVehicle.id);
  });

  it("bloqueia acesso a veículo fora do espelhamento", async () => {
    config.features.mirrorMode = true;
    const ownerClientId = "owner-detail";
    const receiverClientId = "receiver-detail";
    const allowedVehicle = buildVehicle({ clientId: ownerClientId, plate: "DDD-2001", model: "Modelo D" });
    buildDevice({ clientId: ownerClientId, uniqueId: "DEV-OK", vehicleId: allowedVehicle.id });
    const blockedVehicle = buildVehicle({ clientId: ownerClientId, plate: "DDD-2002", model: "Modelo E" });
    buildDevice({ clientId: ownerClientId, uniqueId: "DEV-NO", vehicleId: blockedVehicle.id });

    const mirror = createMirror({
      ownerClientId,
      targetClientId: receiverClientId,
      vehicleIds: [allowedVehicle.id],
      targetType: "GERENCIADORA",
    });
    createdMirrors.push(mirror.id);

    __setCoreRouteMocks({
      fetchLatestPositionsWithFallback: async () => [],
      fetchDevicesMetadata: async () => [],
      getCachedTraccarResources: () => [],
      isTraccarDbConfigured: () => false,
    });

    const app = setupApp();
    const token = signSession({ id: "user-blocked", role: "user", clientId: receiverClientId });

    const response = await callEndpoint(app, {
      path: `/api/core/vehicles/${blockedVehicle.id}/traccar-device?clientId=${ownerClientId}`,
      token,
    });

    assert.ok([403, 404].includes(response.status));
  });

  it("faz fallback para o próprio tenant quando explicitClientIds só contém o cliente atual", () => {
    config.features.tenantFallbackToSelf = true;
    const userClientId = "client-self";
    const req = {
      user: {
        id: "user-self",
        role: "user",
        clientId: userClientId,
        attributes: { clientIds: [userClientId] },
      },
      query: { clientId: "client-invalid" },
      headers: {},
    };

    const tenant = resolveTenant(req, { requestedClientId: req.query.clientId, required: false });

    assert.equal(tenant.clientIdResolved, userClientId);
    assert.equal(tenant.accessType, "self-fallback");
    assert.equal(req.clientId, userClientId);
  });
});
