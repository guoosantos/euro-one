import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import express from "express";
import { randomUUID } from "node:crypto";

import { config } from "../config.js";
import { signSession } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { MIRROR_FALLBACK_PERMISSIONS } from "../middleware/permissions.js";
import { createGroup, deleteGroup } from "../models/group.js";
import { createMirror, deleteMirror } from "../models/mirror.js";
import serviceOrderRoutes, {
  __resetServiceOrderRouteMocks,
  __setServiceOrderRouteMocks,
} from "../routes/service-orders.js";

const createdMirrors = [];
const createdGroups = [];
const originalMirrorMode = config.features.mirrorMode;

function buildMirror({ ownerClientId, targetClientId, vehicleIds }) {
  const group = createGroup({
    name: `Mirror permissions ${randomUUID()}`,
    description: "Grupo de permissões para teste de mirror",
    clientId: ownerClientId,
    attributes: {
      kind: "PERMISSION_GROUP",
      permissions: MIRROR_FALLBACK_PERMISSIONS,
    },
  });
  createdGroups.push(group.id);
  const mirror = createMirror({
    ownerClientId,
    targetClientId,
    vehicleIds,
    targetType: "GERENCIADORA",
    permissionGroupId: group.id,
  });
  createdMirrors.push(mirror.id);
  return mirror;
}

async function callServiceOrders({ ownerClientId, token }) {
  const app = express();
  app.use(express.json());
  app.use("/api/core", serviceOrderRoutes);
  app.use(errorHandler);

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/core/service-orders?clientId=${ownerClientId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  server.close();
  return { status: response.status, payload };
}

beforeEach(() => {
  config.features.mirrorMode = true;
});

afterEach(() => {
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
  __resetServiceOrderRouteMocks();
  config.features.mirrorMode = originalMirrorMode;
});

test("GET /api/core/service-orders filtra por veículos do espelho", async () => {
  const ownerClientId = `owner-service-${randomUUID()}`;
  const receiverClientId = `receiver-service-${randomUUID()}`;
  const allowedVehicleId = `veh-${randomUUID()}`;
  const blockedVehicleId = `veh-${randomUUID()}`;
  buildMirror({ ownerClientId, targetClientId: receiverClientId, vehicleIds: [allowedVehicleId] });

  __setServiceOrderRouteMocks({
    listServiceOrders: async () => [
      { id: "os-allow", vehicleId: allowedVehicleId, clientId: ownerClientId },
      { id: "os-block", vehicleId: blockedVehicleId, clientId: ownerClientId },
    ],
  });

  const token = signSession({ id: "user-service", role: "user", clientId: receiverClientId });
  const { status, payload } = await callServiceOrders({ ownerClientId, token });

  assert.equal(status, 200);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, "os-allow");
});

test("GET /api/core/service-orders retorna vazio quando espelho não tem veículos", async () => {
  const ownerClientId = `owner-service-empty-${randomUUID()}`;
  const receiverClientId = `receiver-service-empty-${randomUUID()}`;
  buildMirror({ ownerClientId, targetClientId: receiverClientId, vehicleIds: [] });

  __setServiceOrderRouteMocks({
    listServiceOrders: async () => [
      { id: "os-1", vehicleId: `veh-${randomUUID()}`, clientId: ownerClientId },
    ],
  });

  const token = signSession({ id: "user-service-empty", role: "user", clientId: receiverClientId });
  const { status, payload } = await callServiceOrders({ ownerClientId, token });

  assert.equal(status, 200);
  assert.deepEqual(payload.items, []);
});
