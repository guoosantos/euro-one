import assert from "node:assert/strict";
import test from "node:test";

import { initStorage } from "../services/storage.js";

let importContentType = null;
let importStatus = 200;

function withMockedFetch(fn) {
  const originalFetch = global.fetch;
  global.fetch = async (input, init = {}) => {
    const target = typeof input === "string" ? input : input?.url || String(input);
    const url = new URL(target);
    const method = String(init.method || input?.method || "GET").toUpperCase();
    const json = (payload, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

    if (url.pathname === "/oauth/token" && method === "POST") {
      return json({ access_token: "token", expires_in: 3600 });
    }

    if (url.pathname === "/api/external/v1/geozones/import" && method === "POST") {
      const headers = new Headers(init.headers || input?.headers || {});
      importContentType = headers.get("content-type");
      if (!importContentType && typeof FormData !== "undefined" && init.body instanceof FormData) {
        importContentType = "multipart/form-data";
      }
      if (importStatus !== 200) {
        return new Response("payload too large", { status: importStatus, headers: { "Content-Type": "text/plain" } });
      }
      return json([999]);
    }

    if (url.pathname.startsWith("/api/external/v1/geozones/") && method === "DELETE") {
      return json({});
    }

    return json({ message: "Not Found" }, 404);
  };

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = originalFetch;
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

const baseUrl = "http://xdm.local";

await initStorage();
const { clearGeofenceMappings, getGeofenceMapping } = await import("../models/xdm-geofence.js");

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
      await withMockedFetch(async () => {
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
        assert.ok(mapping.name.includes("Cliente 1"));
        assert.ok(mapping.name.includes("Geofence Grande"));
        assert.match(importContentType || "", /multipart\/form-data/);
      });
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
      await withMockedFetch(async () => {
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
      });
    },
  );
});
