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

const originalMirrorMode = config.features.mirrorMode;
const originalDemoFallback = process.env.ENABLE_DEMO_FALLBACK;
const fallbackClientId = process.env.FALLBACK_CLIENT_ID || "demo-client";
const createdGroups = [];
const createdMirrors = [];

async function createServer() {
  const routesModule = await import(`../routes/groups.js?ts=${Date.now()}`);
  const app = express();
  app.use(express.json());
  app.use("/api", routesModule.default);
  app.use(errorHandler);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl, server };
}

beforeEach(() => {
  config.features.mirrorMode = true;
  process.env.ENABLE_DEMO_FALLBACK = "true";
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
  config.features.mirrorMode = originalMirrorMode;
  if (originalDemoFallback === undefined) {
    delete process.env.ENABLE_DEMO_FALLBACK;
  } else {
    process.env.ENABLE_DEMO_FALLBACK = originalDemoFallback;
  }
});

test("GET /api/groups retorna vazio quando espelho não tem veículos", async () => {
  const ownerClientId = fallbackClientId;
  const targetClientId = `target-${randomUUID()}`;
  const permissionGroup = createGroup({
    name: `MIRROR_TARGET_READ_${randomUUID()}`,
    description: "Grupo padrão de leitura para espelho",
    clientId: ownerClientId,
    attributes: { kind: "PERMISSION_GROUP", permissions: MIRROR_FALLBACK_PERMISSIONS },
  });
  createdGroups.push(permissionGroup.id);
  const mirror = createMirror({
    ownerClientId,
    targetClientId,
    targetType: "GERENCIADORA",
    vehicleIds: [],
    permissionGroupId: permissionGroup.id,
  });
  createdMirrors.push(mirror.id);

  const { baseUrl, server } = await createServer();
  const token = signSession({ id: "user-mirror", role: "user", clientId: targetClientId });
  const response = await fetch(`${baseUrl}/api/groups`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Owner-Client-Id": ownerClientId,
    },
  });
  const payload = await response.json();
  server.close();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.groups, []);
});

test("POST /api/groups restringe veículos ao escopo do espelho", async () => {
  const ownerClientId = fallbackClientId;
  const targetClientId = `target-${randomUUID()}`;
  const allowedVehicleId = `veh-${randomUUID()}`;
  const blockedVehicleId = `veh-${randomUUID()}`;
  const permissionGroup = createGroup({
    name: `MIRROR_TARGET_READ_${randomUUID()}`,
    description: "Grupo padrão de leitura para espelho",
    clientId: ownerClientId,
    attributes: { kind: "PERMISSION_GROUP", permissions: MIRROR_FALLBACK_PERMISSIONS },
  });
  createdGroups.push(permissionGroup.id);
  const mirror = createMirror({
    ownerClientId,
    targetClientId,
    targetType: "GERENCIADORA",
    vehicleIds: [allowedVehicleId],
    permissionGroupId: permissionGroup.id,
  });
  createdMirrors.push(mirror.id);

  const { baseUrl, server } = await createServer();
  const token = signSession({ id: "user-mirror-2", role: "user", clientId: targetClientId });
  const response = await fetch(`${baseUrl}/api/groups`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Owner-Client-Id": ownerClientId,
    },
    body: JSON.stringify({
      name: "Grupo Mirror",
      description: "Grupo de veículos espelhados",
      attributes: { kind: "VEHICLE_GROUP", vehicleIds: [allowedVehicleId, blockedVehicleId] },
    }),
  });
  const payload = await response.json();
  server.close();

  assert.equal(response.status, 201);
  assert.equal(payload.group.clientId, ownerClientId);
  assert.deepEqual(payload.group.attributes.vehicleIds, [allowedVehicleId]);
});
