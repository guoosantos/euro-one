import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  __resetTraccarDbForTests,
  __setTraccarDbTestOverrides,
  fetchEvents,
  fetchLatestPositions,
  fetchTripsByDevice,
} from "../services/traccar-db.js";

const defaultEnv = { ...process.env };

function setTraccarEnv() {
  process.env.TRACCAR_DB_CLIENT = "postgresql";
  process.env.TRACCAR_DB_HOST = "localhost";
  process.env.TRACCAR_DB_NAME = "traccar";
  process.env.TRACCAR_DB_USER = "user";
  process.env.TRACCAR_DB_PASSWORD = "pass";
}

beforeEach(() => {
  Object.assign(process.env, defaultEnv);
  setTraccarEnv();
});

afterEach(() => {
  __resetTraccarDbForTests();
});

describe("traccar-db", () => {
  it("monta viagens agrupando posições sequenciais", async () => {
    const positions = [
      {
        id: 1,
        deviceid: 10,
        fixtime: "2024-01-01T00:00:00Z",
        latitude: 0,
        longitude: 0,
        speed: 10,
        attributes: { totalDistance: 1000 },
      },
      {
        id: 2,
        deviceid: 10,
        fixtime: "2024-01-01T00:10:00Z",
        latitude: 0,
        longitude: 0.1,
        speed: 20,
        attributes: { totalDistance: 3000 },
      },
    ];

    const fakePool = { query: async () => ({ rows: positions }) };
    __setTraccarDbTestOverrides({
      pool: fakePool,
      dialect: {
        placeholder: (index) => `$${index}`,
        query: async (pool, sql, params) => pool.query(sql, params).then((r) => r.rows),
      },
    });

    const trips = await fetchTripsByDevice("10", "2024-01-01", "2024-01-02");

    assert.equal(trips.length, 1);
    assert.equal(trips[0].distanceKm > 1.9, true);
    assert.equal(trips[0].averageSpeedKmh > 20, true);
  });

  it("retorna últimas posições normalizadas por device", async () => {
    const rows = [
      {
        id: 5,
        deviceid: 11,
        fixtime: new Date("2024-01-02T03:00:00Z"),
        latitude: 1.23,
        longitude: 4.56,
        speed: 5,
        attributes: JSON.stringify({ distance: 1200 }),
      },
    ];

    const fakePool = { query: async () => ({ rows }) };
    __setTraccarDbTestOverrides({
      pool: fakePool,
      dialect: {
        placeholder: (index) => `$${index}`,
        query: async (pool, sql, params) => pool.query(sql, params).then((r) => r.rows),
      },
    });

    const result = await fetchLatestPositions([11]);
    assert.deepEqual(result[0].deviceId, 11);
    assert.equal(result[0].attributes.distance, 1200);
    assert.equal(result[0].fixTime, "2024-01-02T03:00:00.000Z");
  });

  it("formata eventos recentes com atributos parseados", async () => {
    const rows = [
      {
        id: 9,
        type: "deviceOnline",
        eventtime: "2024-02-01T10:00:00Z",
        servertime: "2024-02-01T10:00:10Z",
        deviceid: 44,
        positionid: 88,
        geofenceid: null,
        attributes: '{"foo":123}',
      },
    ];

    const fakePool = { query: async () => ({ rows }) };
    __setTraccarDbTestOverrides({
      pool: fakePool,
      dialect: {
        placeholder: (index) => `$${index}`,
        query: async (pool, sql, params) => pool.query(sql, params).then((r) => r.rows),
      },
    });

    const events = await fetchEvents(44, "2024-02-01", "2024-02-02", 10);

    assert.equal(events.length, 1);
    assert.equal(events[0].deviceId, 44);
    assert.equal(events[0].attributes.foo, 123);
  });

  it("encapsula erro de consulta em TRACCAR_UNAVAILABLE", async () => {
    const fakePool = {
      query: async () => {
        throw new Error("db down");
      },
    };

    __setTraccarDbTestOverrides({
      pool: fakePool,
      dialect: {
        placeholder: (index) => `$${index}`,
        query: async (pool, sql, params) => pool.query(sql, params).then((r) => r.rows),
      },
    });

    await assert.rejects(() => fetchLatestPositions([1]), (error) => {
      assert.equal(error.code, "TRACCAR_UNAVAILABLE");
      assert.equal(error.status, 503);
      return true;
    });
  });
});
