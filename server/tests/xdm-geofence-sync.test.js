import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { initStorage } from "../services/storage.js";

let importContentType = null;
let importStatus = 200;

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
        importContentType = req.headers["content-type"] || null;
        if (importStatus !== 200) {
          res.writeHead(importStatus, { "Content-Type": "text/plain" });
          res.end("payload too large");
          return;
        }
        sendJson(res, [999]);
        return;
      }

      if (req.url.startsWith("/api/external/v1/geozones/") && req.method === "DELETE") {
        sendJson(res, {});
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function buildPoints(count) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count;
    const lat = -23.55 + 0.01 * Math.sin(angle);
    const lon = -46.63 + 0.01 * Math.cos(angle);
    points.push([lat, lon]);
  }
  return points;
}

function withEnv(pairs, fn) {
  const previous = {};
  Object.keys(pairs).forEach((key) => {
    previous[key] = process.env[key];
    if (pairs[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = pairs[key];
    }
  });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.keys(pairs).forEach((key) => {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      });
    });
}

const server = await createMockServer();
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

await initStorage();
const { clearGeofenceMappings, getGeofenceMapping } = await import("../models/xdm-geofence.js");

test.after(() => server.close());

test("normalizePolygon não limita pontos quando env está vazio", async () => {
  await withEnv({ XDM_GEOFENCE_MAX_POINTS: "" }, async () => {
    const { normalizePolygon } = await import(
      `../services/xdm/geofence-sync-service.js?maxPoints=empty-${Date.now()}`
    );
    const points = buildPoints(250);
    const polygon = normalizePolygon({ type: "polygon", points });
    assert.equal(polygon.length, 251);
  });
});

test("normalizePolygon não limita pontos quando env é 0", async () => {
  await withEnv({ XDM_GEOFENCE_MAX_POINTS: "0" }, async () => {
    const { normalizePolygon } = await import(
      `../services/xdm/geofence-sync-service.js?maxPoints=zero-${Date.now()}`
    );
    const points = buildPoints(250);
    const polygon = normalizePolygon({ type: "polygon", points });
    assert.equal(polygon.length, 251);
  });
});

test("normalizePolygon não limita pontos quando env está ausente", async () => {
  await withEnv({ XDM_GEOFENCE_MAX_POINTS: undefined }, async () => {
    const { normalizePolygon } = await import(
      `../services/xdm/geofence-sync-service.js?maxPoints=unset-${Date.now()}`
    );
    const points = buildPoints(250);
    const polygon = normalizePolygon({ type: "polygon", points });
    assert.equal(polygon.length, 251);
  });
});

test("normalizePolygon aplica limite quando XDM_GEOFENCE_MAX_POINTS=200", async () => {
  await withEnv({ XDM_GEOFENCE_MAX_POINTS: "200" }, async () => {
    const { normalizePolygon } = await import(
      `../services/xdm/geofence-sync-service.js?maxPoints=limit-${Date.now()}`
    );
    const points = buildPoints(250);
    const polygon = normalizePolygon({ type: "polygon", points });
    assert.equal(polygon.length, 201);
  });
});

test("syncGeofence gera nome determinístico e envia FormData", async () => {
  await withEnv(
    {
      XDM_AUTH_URL: `${baseUrl}/oauth/token`,
      XDM_BASE_URL: baseUrl,
      XDM_CLIENT_ID: "client",
      XDM_CLIENT_SECRET: "secret",
      XDM_GEOFENCE_MAX_POINTS: "",
    },
    async () => {
      importContentType = null;
      importStatus = 200;
      clearGeofenceMappings();
      const { syncGeofence } = await import(
        `../services/xdm/geofence-sync-service.js?sync-${Date.now()}`
      );
      const geofence = {
        id: "geo-large",
        clientId: "client-1",
        name: "Geofence Grande",
        type: "polygon",
        points: buildPoints(10),
      };
      await syncGeofence(geofence.id, {
        clientId: geofence.clientId,
        clientDisplayName: "Cliente 1",
        geofence,
        itineraryId: "it-1",
      });
      const mapping = getGeofenceMapping({ geofenceId: geofence.id, clientId: geofence.clientId });
      assert.equal(mapping.name, "Cliente 1 - Geofence Grande");
      assert.match(importContentType || "", /multipart\/form-data/);
    },
  );
});

test("syncGeofence retorna erro claro quando XDM rejeita payload grande", async () => {
  await withEnv(
    {
      XDM_AUTH_URL: `${baseUrl}/oauth/token`,
      XDM_BASE_URL: baseUrl,
      XDM_CLIENT_ID: "client",
      XDM_CLIENT_SECRET: "secret",
      XDM_GEOFENCE_MAX_POINTS: "",
    },
    async () => {
      importStatus = 413;
      clearGeofenceMappings();
      const { syncGeofence } = await import(
        `../services/xdm/geofence-sync-service.js?size-${Date.now()}`
      );
      const geofence = {
        id: "geo-huge",
        clientId: "client-1",
        name: "Geofence Gigante",
        type: "polygon",
        points: buildPoints(20),
      };

      await assert.rejects(
        () => syncGeofence(geofence.id, { clientId: geofence.clientId, geofence }),
        (error) => {
          assert.match(String(error.message), /XDM rejeitou geofence por tamanho/i);
          return true;
        },
      );
    },
  );
});
