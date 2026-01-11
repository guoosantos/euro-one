import assert from "node:assert/strict";
import http from "node:http";
import { after, before, it } from "node:test";
import { once } from "node:events";

import app from "../app.js";
import { signSession } from "../middleware/auth.js";
import { initStorage } from "../services/storage.js";
import { clearGeofenceMappings } from "../models/xdm-geofence.js";
import { clearGeozoneGroupMappings } from "../models/xdm-geozone-group.js";

let importCalls = 0;
let groupCreateCalls = 0;
let rolloutCalls = 0;
let overrideCalls = 0;
let lastOverridePayload = null;

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

      if (req.url === "/api/external/v1/geozonegroups" && req.method === "POST") {
        groupCreateCalls += 1;
        sendJson(res, 555);
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

      if (/^\/api\/external\/v3\/settingsOverrides\//.test(req.url) && req.method === "PUT") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          overrideCalls += 1;
          lastOverridePayload = body ? JSON.parse(body) : null;
          sendJson(res, {});
        });
        return;
      }

      if (req.url === "/api/external/v1/rollouts/create" && req.method === "POST") {
        rolloutCalls += 1;
        sendJson(res, { rolloutId: `rollout-${rolloutCalls}` });
        return;
      }

      if (req.url === "/api/external/v3/configs/forDevices" && req.method === "POST") {
        sendJson(res, [{ id: 99, name: "Config XDM" }]);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

let xdmServer;
let server;
let baseUrl;

const geofenceFixture = {
  id: "geo-1",
  clientId: "client-1",
  name: "Geofence Teste",
  type: "polygon",
  points: [
    [-23.55, -46.63],
    [-23.56, -46.64],
    [-23.57, -46.62],
  ],
};

before(async () => {
  xdmServer = await createMockServer();
  const { port } = xdmServer.address();
  const xdmBaseUrl = `http://127.0.0.1:${port}`;

  process.env.NODE_ENV = "test";
  process.env.XDM_AUTH_URL = `${xdmBaseUrl}/oauth/token`;
  process.env.XDM_BASE_URL = xdmBaseUrl;
  process.env.XDM_CLIENT_ID = "client";
  process.env.XDM_CLIENT_SECRET = "secret";
  process.env.XDM_DEALER_ID = "10";
  process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID = "1234";
  process.env.XDM_CONFIG_NAME = "Config XDM";
  process.env.ENABLE_DEMO_FALLBACK = "true";

  await initStorage();

  server = app.listen(0);
  await once(server, "listening");
  const { port: appPort } = server.address();
  baseUrl = `http://127.0.0.1:${appPort}`;
});

after(() => {
  if (server) server.close();
  if (xdmServer) xdmServer.close();
});

it("POST /api/xdm/geozone-group/apply é idempotente para geofences", async () => {
  importCalls = 0;
  groupCreateCalls = 0;
  rolloutCalls = 0;
  overrideCalls = 0;
  lastOverridePayload = null;
  clearGeofenceMappings();
  clearGeozoneGroupMappings();

  const token = signSession({ id: "admin-1", role: "admin", clientId: "client-1" });
  const payload = {
    clientId: "client-1",
    deviceUid: "imei-123",
    geofenceIds: ["geo-1"],
    geofences: [geofenceFixture],
    groupName: "GROUP-TEST",
  };

  const first = await fetch(`${baseUrl}/api/xdm/geozone-group/apply`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const firstBody = await first.json();

  const second = await fetch(`${baseUrl}/api/xdm/geozone-group/apply`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const secondBody = await second.json();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(firstBody.data.xdmGeozoneGroupId, 555);
  assert.equal(secondBody.data.xdmGeozoneGroupId, 555);
  assert.equal(importCalls, 1);
  assert.equal(groupCreateCalls, 1);
  assert.equal(overrideCalls, 2);
  assert.equal(rolloutCalls, 2);
  assert.deepEqual(lastOverridePayload?.overrides, { "1234": 555 });
});

it("falha quando override id não é numérico", async () => {
  const previousOverrideId = process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID;
  const previousOverrideKey = process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
  process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID = "geoGroup";
  delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
  overrideCalls = 0;

  const token = signSession({ id: "admin-1", role: "admin", clientId: "client-1" });
  const payload = {
    clientId: "client-1",
    deviceUid: "imei-123",
    geofenceIds: ["geo-1"],
    geofences: [geofenceFixture],
    groupName: "GROUP-TEST",
  };

  const response = await fetch(`${baseUrl}/api/xdm/geozone-group/apply`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 500);
  assert.equal(overrideCalls, 0);

  if (previousOverrideId === undefined) {
    delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID;
  } else {
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID = previousOverrideId;
  }
  if (previousOverrideKey === undefined) {
    delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY;
  } else {
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY = previousOverrideKey;
  }
});
