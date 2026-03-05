import assert from "node:assert/strict";
import { after, before, it } from "node:test";

import app from "../app.js";
import { signSession } from "../middleware/auth.js";
import { initStorage } from "../services/storage.js";
import { clearGeofenceMappings } from "../models/xdm-geofence.js";
import { clearGeozoneGroupMappings } from "../models/xdm-geozone-group.js";
import { requestApp } from "./app-request.js";

let importCalls = 0;
let groupCreateCalls = 0;
let rolloutCalls = 0;
let overrideCalls = 0;
let lastOverridePayload = null;

let originalFetch;
let overrideEnvSnapshot = null;

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
  const xdmBaseUrl = "http://xdm.local";

  process.env.NODE_ENV = "test";
  process.env.XDM_AUTH_URL = `${xdmBaseUrl}/oauth/token`;
  process.env.XDM_BASE_URL = xdmBaseUrl;
  process.env.XDM_CLIENT_ID = "client";
  process.env.XDM_CLIENT_SECRET = "secret";
  process.env.XDM_DEALER_ID = "10";
  overrideEnvSnapshot = Object.keys(process.env)
    .filter(
      (key) =>
        key === "XDM_GEOZONE_GROUP_OVERRIDE_ID" ||
        key === "XDM_GEOZONE_GROUP_OVERRIDE_KEY" ||
        key === "XDM_GEOZONE_GROUP_OVERRIDE_KEYS" ||
        key.startsWith("XDM_GEOZONE_GROUP_OVERRIDE_ID_") ||
        key.startsWith("XDM_GEOZONE_GROUP_OVERRIDE_KEY_"),
    )
    .reduce((acc, key) => {
      acc[key] = process.env[key];
      return acc;
    }, {});
  Object.keys(overrideEnvSnapshot).forEach((key) => {
    delete process.env[key];
  });
  process.env.XDM_GEOZONE_GROUP_OVERRIDE_IDS = "1234,2345,3456";
  process.env.XDM_CONFIG_NAME = "Config XDM";
  process.env.ENABLE_DEMO_FALLBACK = "true";

  await initStorage();
  originalFetch = global.fetch;
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
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
    if (url.pathname === "/api/external/v1/geozonegroups" && method === "POST") {
      groupCreateCalls += 1;
      return json(555);
    }
    if (/^\/api\/external\/v1\/geozonegroups\/\d+$/.test(url.pathname) && method === "GET") {
      return json({ id: 555, geozoneIds: [] });
    }
    if (url.pathname.endsWith("/geozones") && method === "POST") {
      return json(1);
    }
    if (/^\/api\/external\/v3\/settingsOverrides\//.test(url.pathname) && method === "PUT") {
      overrideCalls += 1;
      lastOverridePayload = readBody();
      return json({});
    }
    if (url.pathname === "/api/external/v1/rollouts/create" && method === "POST") {
      rolloutCalls += 1;
      return json({ rolloutId: `rollout-${rolloutCalls}` });
    }
    if (url.pathname === "/api/external/v3/configs/forDevices" && method === "POST") {
      return json([{ id: 99, name: "Config XDM" }]);
    }
    return json({ message: "Not Found" }, 404);
  };
});

after(() => {
  if (originalFetch) {
    global.fetch = originalFetch;
  }
  if (overrideEnvSnapshot) {
    Object.keys(overrideEnvSnapshot).forEach((key) => {
      process.env[key] = overrideEnvSnapshot[key];
    });
  }
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

  const first = await requestApp(app, {
    url: "/api/xdm/geozone-group/apply",
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload,
  });
  const firstBody = await first.json();

  const second = await requestApp(app, {
    url: "/api/xdm/geozone-group/apply",
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload,
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
  assert.deepEqual(lastOverridePayload?.Overrides, {
    1234: { value: 555 },
    2345: { value: null },
    3456: { value: null },
  });
});

it("falha quando override id não é numérico", async () => {
  const previousOverrideIds = process.env.XDM_GEOZONE_GROUP_OVERRIDE_IDS;
  process.env.XDM_GEOZONE_GROUP_OVERRIDE_IDS = "abc,2345,3456";
  overrideCalls = 0;

  const token = signSession({ id: "admin-1", role: "admin", clientId: "client-1" });
  const payload = {
    clientId: "client-1",
    deviceUid: "imei-123",
    geofenceIds: ["geo-1"],
    geofences: [geofenceFixture],
    groupName: "GROUP-TEST",
  };

  const response = await requestApp(app, {
    url: "/api/xdm/geozone-group/apply",
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload,
  });

  assert.equal(response.status, 400);
  assert.equal(overrideCalls, 0);

  if (previousOverrideIds === undefined) {
    delete process.env.XDM_GEOZONE_GROUP_OVERRIDE_IDS;
  } else {
    process.env.XDM_GEOZONE_GROUP_OVERRIDE_IDS = previousOverrideIds;
  }
});
