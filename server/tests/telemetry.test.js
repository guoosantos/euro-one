import assert from "node:assert/strict";
import express from "express";
import { afterEach, describe, it } from "node:test";

import { errorHandler } from "../middleware/error-handler.js";
import coreRoutes, { __resetCoreRouteMocks, __setCoreRouteMocks } from "../routes/core.js";

const user = { id: "user-1", role: "admin", clientId: "tenant-1" };

function buildTraccarProxy({ failEvents = false, failPositions = false } = {}) {
  return async function traccarProxy(method, url) {
    if (url === "/devices") {
      return [
        { id: 10, uniqueId: "u-10", positionId: "p-1", status: "online", lastUpdate: "2024-01-01T00:00:05Z" },
      ];
    }
    if (url === "/positions") {
      if (failPositions) {
        throw new Error("positions unavailable");
      }
      return {
        positions: [
          {
            id: "p-1",
            deviceId: 10,
            fixTime: "2024-01-01T00:00:00Z",
            latitude: 1,
            longitude: 2,
            speed: 0,
            address: { formatted: "Rua A" },
          },
        ],
      };
    }
    if (url === "/events") {
      if (failEvents) {
        const error = new Error("events down");
        error.status = 500;
        throw error;
      }
      return {
        events: [
          { id: 1, deviceId: 10, eventTime: "2024-01-01T00:05:00Z", type: "deviceOnline" },
        ],
      };
    }
    throw new Error(`unexpected call ${method} ${url}`);
  };
}

function stubCoreDeps(traccarOpts = {}) {
  __setCoreRouteMocks({
    authenticate: (req, _res, next) => {
      req.user = user;
      next();
    },
    resolveClientId: () => user.clientId,
    resolveClientIdMiddleware: (req, _res, next) => {
      req.clientId = user.clientId;
      next();
    },
    listDevices: () => [
      { id: "dev-1", traccarId: 10, uniqueId: "u-10", clientId: "tenant-1", name: "Teste" },
    ],
    listModels: () => [],
    listChips: () => [],
    listVehicles: () => [],
    traccarProxy: buildTraccarProxy(traccarOpts),
    buildTraccarUnavailableError: (reason) => {
      const error = new Error(reason?.message || "TRACCAR_UNAVAILABLE");
      error.code = "TRACCAR_UNAVAILABLE";
      error.status = 503;
      error.isTraccarError = true;
      return error;
    },
    getCachedTraccarResources: () => [],
    isTraccarDbConfigured: () => false,
    fetchLatestPositions: async () => [],
    enrichPositionsWithAddresses: (positions) => positions,
  });
}

function buildApp(traccarOpts = {}) {
  stubCoreDeps(traccarOpts);
  const app = express();
  app.use(express.json());
  app.use("/api/core", coreRoutes);
  app.use(errorHandler);
  return app;
}

async function callTelemetry(app, query = "") {
  const server = app.listen(0);
  const url = new URL(`/api/core/telemetry${query}`, `http://127.0.0.1:${server.address().port}`);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  server.close();
  return { status: response.status, data };
}

afterEach(() => {
  __resetCoreRouteMocks();
});

describe("/api/core/telemetry", () => {
  it("retorna posições e eventos quando sucesso", async () => {
    const app = buildApp();
    const { status, data } = await callTelemetry(app, "?clientId=tenant-1");

    assert.equal(status, 200);
    assert.equal(data.telemetry.length, 1);
    assert.equal(data.telemetry[0].position.address, "Rua A");
    assert.equal(data.warnings.length, 0);
  });

  it("mantém resposta com aviso quando eventos falham", async () => {
    const app = buildApp({ failEvents: true });
    const { status, data } = await callTelemetry(app, "?clientId=tenant-1");

    assert.equal(status, 200);
    assert.equal(data.telemetry.length, 1);
    assert.equal(data.warnings[0].stage, "events");
  });

  it("propaga erro quando posições não carregam", async () => {
    const app = buildApp({ failPositions: true });
    const { status, data } = await callTelemetry(app, "?clientId=tenant-1");

    assert.equal(status, 503);
    assert.match(data.message, /positions unavailable/i);
  });
});
