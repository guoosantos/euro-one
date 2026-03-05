import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { initStorage } from "../services/storage.js";

let importCalls = 0;
let groupCreateCalls = 0;
let rolloutCalls = 0;
let overrideCalls = 0;
let lastGroupPayload = null;
let overridePayloads = [];

const originalFetch = global.fetch;
global.fetch = async (input, init = {}) => {
  const target =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input?.url || String(input);
  const url = new URL(target);
  const method = String(init.method || input?.method || "GET").toUpperCase();
  const json = (payload, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

  const readBody = () => {
    if (!init.body) return null;
    if (typeof init.body === "string") return JSON.parse(init.body);
    if (Buffer.isBuffer(init.body)) return JSON.parse(init.body.toString("utf8"));
    return null;
  };

  if (url.pathname === "/oauth/token" && method === "POST") {
    return json({ access_token: "token", expires_in: 3600 });
  }
  if (url.pathname === "/api/external/v1/geozones/import" && method === "POST") {
    importCalls += 1;
    return json([123]);
  }
  if (url.pathname.startsWith("/api/external/v1/geozones/") && method === "DELETE") {
    return json({});
  }
  if (url.pathname === "/api/external/v1/geozonegroups" && method === "POST") {
    lastGroupPayload = readBody();
    groupCreateCalls += 1;
    if (lastGroupPayload?.name?.includes("DATA_ID")) {
      return json({ data: { id: 555 } });
    }
    return json({ id: 555 });
  }
  if (/^\/api\/external\/v1\/geozonegroups\/\d+$/.test(url.pathname) && method === "PUT") {
    return json({});
  }
  if (/^\/api\/external\/v1\/geozonegroups\/\d+$/.test(url.pathname) && method === "GET") {
    return json({ id: 555, geozoneIds: [] });
  }
  if (url.pathname.endsWith("/geozones") && method === "POST") {
    return json(1);
  }
  if (url.pathname.endsWith("/geozones") && method === "DELETE") {
    return json(1);
  }
  if (/^\/api\/external\/v3\/settingsOverrides\//.test(url.pathname) && method === "PUT") {
    overrideCalls += 1;
    overridePayloads.push(readBody());
    return json({});
  }
  if (url.pathname === "/api/external/v1/rollouts/create" && method === "POST") {
    rolloutCalls += 1;
    return json({ rolloutId: `rollout-${rolloutCalls}` });
  }
  return json({ message: "Not Found" }, 404);
};

async function waitFor(predicate, { timeoutMs = 200, intervalMs = 5 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const baseUrl = "http://xdm.local";

process.env.NODE_ENV = "test";
process.env.XDM_AUTH_URL = `${baseUrl}/oauth/token`;
process.env.XDM_BASE_URL = baseUrl;
process.env.XDM_CLIENT_ID = "client";
process.env.XDM_CLIENT_SECRET = "secret";
process.env.XDM_DEALER_ID = "10";
Object.keys(process.env)
  .filter(
    (key) =>
      key === "XDM_GEOZONE_GROUP_OVERRIDE_ID" ||
      key === "XDM_GEOZONE_GROUP_OVERRIDE_KEY" ||
      key === "XDM_GEOZONE_GROUP_OVERRIDE_KEYS" ||
      key.startsWith("XDM_GEOZONE_GROUP_OVERRIDE_ID_") ||
      key.startsWith("XDM_GEOZONE_GROUP_OVERRIDE_KEY_"),
  )
  .forEach((key) => {
    delete process.env[key];
  });
process.env.XDM_GEOZONE_GROUP_OVERRIDE_IDS = "1234,2345,3456";
process.env.ENABLE_DEMO_FALLBACK = "true";

await initStorage();

const { normalizePolygon, buildGeometryHash, syncGeofence } = await import(
  "../services/xdm/geofence-sync-service.js"
);
const { syncGeozoneGroup, syncGeozoneGroupForGeofences, ensureGeozoneGroup } = await import(
  "../services/xdm/geozone-group-sync-service.js",
);
const { __setGeofenceTestOverrides } = await import("../models/geofence.js");
const { createItinerary } = await import("../models/itinerary.js");
const { queueDeployment, embarkItinerary, disembarkItinerary } = await import("../services/xdm/deployment-service.js");
const { getDeploymentById } = await import("../models/xdm-deployment.js");
const { clearGeofenceMappings } = await import("../models/xdm-geofence.js");
const { clearGeozoneGroupMappings } = await import("../models/xdm-geozone-group.js");
const { createDevice } = await import("../models/device.js");
const { createVehicle, buildVehicleRecordFromPrisma } = await import("../models/vehicle.js");
const { resolveVehicleDeviceUid } = await import("../services/xdm/resolve-vehicle-device-uid.js");

const samplePoints = [
  [-23.55, -46.63],
  [-23.56, -46.64],
  [-23.57, -46.62],
];

const geofenceFixture = {
  id: "geo-1",
  clientId: "client-1",
  name: "Teste",
  type: "polygon",
  points: samplePoints,
};

test.after(() => {
  global.fetch = originalFetch;
  __setGeofenceTestOverrides(null);
});

__setGeofenceTestOverrides({
  listGeofences: async ({ clientId } = {}) =>
    !clientId || String(clientId) === String(geofenceFixture.clientId) ? [geofenceFixture] : [],
  getGeofenceById: async (id) => (String(id) === String(geofenceFixture.id) ? geofenceFixture : null),
});

test("normalizePolygon fecha o polígono e mantém hash determinístico", () => {
  const polygon = normalizePolygon({ type: "polygon", points: samplePoints });
  assert.equal(polygon.length, 4);
  assert.deepEqual(polygon[0], polygon[polygon.length - 1]);

  const hashA = buildGeometryHash(polygon);
  const hashB = buildGeometryHash(polygon);
  assert.equal(hashA, hashB);
});

test("syncGeofence é idempotente para a mesma geometria", async () => {
  importCalls = 0;
  clearGeofenceMappings();
  await syncGeofence(geofenceFixture.id, { clientId: geofenceFixture.clientId, geofence: geofenceFixture });
  await syncGeofence(geofenceFixture.id, { clientId: geofenceFixture.clientId, geofence: geofenceFixture });
  assert.equal(importCalls, 1);
});

test("syncGeozoneGroup evita recriar grupo quando hash não muda", async () => {
  groupCreateCalls = 0;
  lastGroupPayload = null;
  clearGeofenceMappings();
  clearGeozoneGroupMappings();
  const itinerary = createItinerary({
    clientId: geofenceFixture.clientId,
    name: "Itinerário",
    items: [{ type: "geofence", id: geofenceFixture.id }],
  });
  const geofencesById = new Map([[geofenceFixture.id, geofenceFixture]]);
  await syncGeozoneGroup(itinerary.id, {
    clientId: geofenceFixture.clientId,
    clientDisplayName: "Cliente Teste",
    geofencesById,
  });
  await syncGeozoneGroup(itinerary.id, {
    clientId: geofenceFixture.clientId,
    clientDisplayName: "Cliente Teste",
    geofencesById,
  });
  assert.equal(groupCreateCalls, 1);
  assert.ok(
    lastGroupPayload?.name?.includes("Cliente Teste") && lastGroupPayload?.name?.includes("Itinerário"),
  );
});

test("syncGeozoneGroup normaliza id criado com wrapper data", async () => {
  groupCreateCalls = 0;
  clearGeofenceMappings();
  clearGeozoneGroupMappings();
  const response = await syncGeozoneGroupForGeofences({
    clientId: geofenceFixture.clientId,
    geofenceIds: [geofenceFixture.id],
    groupName: "DATA_ID_GROUP",
    scopeKey: "data-id",
    geofencesById: new Map([[geofenceFixture.id, geofenceFixture]]),
  });
  assert.equal(response.xdmGeozoneGroupId, 555);
});

test("queueDeployment evita duplicidade quando já há deploy ativo", () => {
  const first = queueDeployment({
    clientId: "client-1",
    itineraryId: "it-1",
    vehicleId: "veh-1",
    deviceImei: "123",
    requestedByUserId: "user-1",
    requestedByName: "Usuário",
    ipAddress: "127.0.0.1",
  });
  const second = queueDeployment({
    clientId: "client-1",
    itineraryId: "it-1",
    vehicleId: "veh-1",
    deviceImei: "123",
    requestedByUserId: "user-1",
    requestedByName: "Usuário",
    ipAddress: "127.0.0.1",
  });
  assert.equal(first.status, "QUEUED");
  assert.equal(second.status, "ACTIVE");
  assert.equal(second.deployment.id, first.deployment.id);
});

test("resolveVehicleDeviceUid usa uniqueId do device associado", () => {
  const device = createDevice({
    clientId: geofenceFixture.clientId,
    name: "Device Teste",
    uniqueId: `imei-assoc-${randomUUID()}`,
  });
  const vehicle = createVehicle({
    clientId: geofenceFixture.clientId,
    name: "Carro com Device",
    plate: "JKL-1234",
    model: "Modelo D",
    type: "carro",
    deviceId: device.id,
  });

  const resolved = resolveVehicleDeviceUid(vehicle);
  assert.equal(resolved, device.uniqueId);
});

test("buildVehicleRecordFromPrisma preenche deviceImei com uniqueId do device", () => {
  const record = buildVehicleRecordFromPrisma({
    id: "veh-prisma-1",
    clientId: geofenceFixture.clientId,
    name: "Veículo Prisma",
    plate: "MNO-1234",
    model: "Modelo E",
    type: "carro",
    devices: [{ id: "dev-1", uniqueId: "imei-from-device" }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  assert.equal(record.deviceId, "dev-1");
  assert.equal(record.deviceImei, "imei-from-device");
});

test("embark múltiplos veículos aplica overrides por deviceUid", async () => {
  rolloutCalls = 0;
  overrideCalls = 0;
  overridePayloads = [];

  const itinerary = createItinerary({
    clientId: geofenceFixture.clientId,
    name: "Itinerário Multi",
    items: [{ type: "geofence", id: geofenceFixture.id }],
  });

  const vehicleA = createVehicle({
    clientId: geofenceFixture.clientId,
    name: "Caminhão A",
    plate: "ABC-1234",
    model: "Modelo A",
    type: "caminhao",
    deviceImei: "imei-1",
  });

  const vehicleB = createVehicle({
    clientId: geofenceFixture.clientId,
    name: "Caminhão B",
    plate: "DEF-5678",
    model: "Modelo B",
    type: "caminhao",
    deviceId: createDevice({
      clientId: geofenceFixture.clientId,
      name: "Device B",
      uniqueId: `imei-2-${randomUUID()}`,
    }).id,
  });

  const response = await embarkItinerary({
    clientId: geofenceFixture.clientId,
    itineraryId: itinerary.id,
    vehicleIds: [vehicleA.id, vehicleB.id],
    configId: 42,
    geofencesById: new Map([[geofenceFixture.id, geofenceFixture]]),
  });

  assert.equal(response.xdmGeozoneGroupId, 555);

  const deploymentB = getDeploymentById(response.vehicles[1].deploymentId);
  assert.match(deploymentB.deviceImei, /imei-2-/);

  await waitFor(() => overrideCalls >= 2, { timeoutMs: 2000 });

  assert.equal(overrideCalls, 2);
  assert.equal(rolloutCalls, 0);
  const firstOverrides = overridePayloads[0]?.Overrides || {};
  assert.equal(Object.keys(firstOverrides).length, 3);
  assert.ok(Object.values(firstOverrides).every((entry) => entry?.value === 555));
});

test("embark falha para veículo sem IMEI/deviceUid", async () => {
  const itinerary = createItinerary({
    clientId: geofenceFixture.clientId,
    name: "Itinerário Sem IMEI",
    items: [{ type: "geofence", id: geofenceFixture.id }],
  });

  const vehicle = createVehicle({
    clientId: geofenceFixture.clientId,
    name: "Carro",
    plate: "GHI-0001",
    model: "Modelo C",
    type: "carro",
  });

  const response = await embarkItinerary({
    clientId: geofenceFixture.clientId,
    itineraryId: itinerary.id,
    vehicleIds: [vehicle.id],
    configId: 42,
    geofencesById: new Map([[geofenceFixture.id, geofenceFixture]]),
  });

  assert.equal(response.vehicles[0].status, "failed");
  assert.match(response.vehicles[0].message, /IMEI/i);
});

test("disembark limpa override do device", async () => {
  overrideCalls = 0;
  overridePayloads = [];

  const itinerary = createItinerary({
    clientId: geofenceFixture.clientId,
    name: "Itinerário Desembarque",
    items: [{ type: "geofence", id: geofenceFixture.id }],
  });

  const vehicle = createVehicle({
    clientId: geofenceFixture.clientId,
    name: "Carro Desembarque",
    plate: "ZZZ-0001",
    model: "Modelo Z",
    type: "carro",
    deviceImei: "imei-disembark",
  });

  const response = await disembarkItinerary({
    clientId: geofenceFixture.clientId,
    itineraryId: itinerary.id,
    vehicleIds: [vehicle.id],
  });

  await waitFor(() => overrideCalls >= 1, { timeoutMs: 2000 });

  assert.equal(response.vehicles[0].status, "queued");
  assert.ok(overrideCalls >= 1);
  const clearedOverrides = overridePayloads[0]?.Overrides || {};
  assert.equal(Object.keys(clearedOverrides).length, 3);
  assert.ok(Object.values(clearedOverrides).every((entry) => entry?.value === null));
});

test("ensureGeozoneGroup reutiliza mapeamento salvo", async () => {
  groupCreateCalls = 0;
  clearGeofenceMappings();
  clearGeozoneGroupMappings();

  const itinerary = createItinerary({
    clientId: geofenceFixture.clientId,
    name: "Itinerário Persistente",
    items: [{ type: "geofence", id: geofenceFixture.id }],
  });

  const first = await ensureGeozoneGroup(itinerary.id, {
    clientId: geofenceFixture.clientId,
    geofencesById: new Map([[geofenceFixture.id, geofenceFixture]]),
  });

  const second = await ensureGeozoneGroup(itinerary.id, { clientId: geofenceFixture.clientId });

  assert.equal(first.xdmGeozoneGroupId, 555);
  assert.equal(second.xdmGeozoneGroupId, 555);
  assert.equal(groupCreateCalls, 1);
});
