import assert from "node:assert/strict";
import express from "express";
import { afterEach, describe, it } from "node:test";

import { config } from "../config.js";
import { signSession } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { getAccessibleVehicles } from "../services/accessible-vehicles.js";
import { createVehicle, deleteVehicle } from "../models/vehicle.js";
import alertRoutes from "../routes/alerts.js";

const createdVehicles = [];
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

afterEach(() => {
  createdVehicles.splice(0).forEach((id) => {
    try {
      deleteVehicle(id);
    } catch (_error) {
      // ignora limpeza
    }
  });
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
