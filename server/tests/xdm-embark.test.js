import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { initStorage } from "../services/storage.js";

let importCalls = 0;
let groupCreateCalls = 0;
let rolloutCalls = 0;
let overrideCalls = 0;

function sendJson(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function createMockServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(404);
        res.end();
        return;
      }

      if (req.url === "/oauth/token" && req.method === "POST") {
        sendJson(res, { access_token: "token", expires_in: 3600 });
        return;
      }

      if (req.url === "/api/external/v1/geozones/import" && req.method === "POST") {
        importCalls += 1;
        sendJson(res, [123]);
        return;
      }

      if (req.url.startsWith("/api/external/v1/geozones/") && req.method === "DELETE") {
        sendJson(res, {});
        return;
      }

      if (req.url === "/api/external/v1/geozonegroups" && req.method === "POST") {
        groupCreateCalls += 1;
        sendJson(res, 555);
        return;
      }

      if (/^\/api\/external\/v1\/geozonegroups\/\d+$/.test(req.url) && req.method === "PUT") {
        sendJson(res, {});
        return;
      }

      if (/^\/api\/external\/v1\/geozonegroups\/\d+$/.test(req.url) && req.method === "GET") {
        sendJson(res, { id: 555, geozoneIds: [] });
        return;
      }

      if (req.url.endsWith("/geozones") && req.method === "POST") {
        sendJson(res, 1);
        return;
      }

      if (req.url.endsWith("/geozones") && req.method === "DELETE") {
        sendJson(res, 1);
        return;
      }

      if (/^\/api\/external\/v3\/settingsOverrides\//.test(req.url) && req.method === "PUT") {
        overrideCalls += 1;
        sendJson(res, {});
        return;
      }

      if (req.url === "/api/external/v1/rollouts/create" && req.method === "POST") {
        rolloutCalls += 1;
        sendJson(res, { rolloutId: `rollout-${rolloutCalls}` });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const server = await createMockServer();
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

process.env.XDM_AUTH_URL = `${baseUrl}/oauth/token`;
process.env.XDM_BASE_URL = baseUrl;
process.env.XDM_CLIENT_ID = "client";
process.env.XDM_CLIENT_SECRET = "secret";
process.env.XDM_DEALER_ID = "10";
process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY = "geoGroup";

await initStorage();

const { normalizePolygon, buildGeometryHash, syncGeofence } = await import(
  "../services/xdm/geofence-sync-service.js"
);
const { syncGeozoneGroup } = await import("../services/xdm/geozone-group-sync-service.js");
const { createItinerary } = await import("../models/itinerary.js");
const { queueDeployment, embarkItinerary } = await import("../services/xdm/deployment-service.js");
const { createVehicle } = await import("../models/vehicle.js");

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

test.after(() => server.close());

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
  await syncGeofence(geofenceFixture.id, { clientId: geofenceFixture.clientId, geofence: geofenceFixture });
  await syncGeofence(geofenceFixture.id, { clientId: geofenceFixture.clientId, geofence: geofenceFixture });
  assert.equal(importCalls, 1);
});

test("syncGeozoneGroup evita recriar grupo quando hash não muda", async () => {
  groupCreateCalls = 0;
  const itinerary = createItinerary({
    clientId: geofenceFixture.clientId,
    name: "Itinerário",
    items: [{ type: "geofence", id: geofenceFixture.id }],
  });
  const geofencesById = new Map([[geofenceFixture.id, geofenceFixture]]);
  await syncGeozoneGroup(itinerary.id, { clientId: geofenceFixture.clientId, geofencesById });
  await syncGeozoneGroup(itinerary.id, { clientId: geofenceFixture.clientId, geofencesById });
  assert.equal(groupCreateCalls, 1);
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

test("embark múltiplos veículos cria rollouts por deviceUid", async () => {
  rolloutCalls = 0;
  overrideCalls = 0;

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
    deviceImei: "imei-2",
  });

  const response = await embarkItinerary({
    clientId: geofenceFixture.clientId,
    itineraryId: itinerary.id,
    vehicleIds: [vehicleA.id, vehicleB.id],
    configId: 42,
    geofencesById: new Map([[geofenceFixture.id, geofenceFixture]]),
  });

  assert.equal(response.xdmGeozoneGroupId, 555);

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(overrideCalls, 2);
  assert.equal(rolloutCalls, 2);
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
