import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { normalizeTrips } from "../src/lib/hooks/useReports.js";
import { normalizeRoute } from "../src/lib/hooks/useReportsRoute.js";
import { normalizeSummary } from "../src/lib/hooks/useReportsSummary.js";
import { normalizeStops } from "../src/lib/hooks/useReportsStops.js";
import { readCachedReport, writeCachedReport } from "../src/lib/hooks/reportStorage.js";

const createFakeStorage = () => {
  const store = new Map();

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    clear() {
      store.clear();
    },
  };
};

describe("hooks de relatórios", () => {
  let storage;
  const baseWindow = globalThis.window;

  beforeEach(() => {
    storage = createFakeStorage();
    globalThis.window = { localStorage: storage };
  });

  afterEach(() => {
    storage?.clear();
    globalThis.window = baseWindow;
  });

  it("hidrata dados a partir do localStorage quando existir cache", () => {
    const cachedPayload = { trips: [{ id: 1, distance: 10 }] };
    storage.setItem("reports:trips:last", JSON.stringify(cachedPayload));

    const cached = readCachedReport("reports:trips:last", normalizeTrips);
    assert.deepEqual(cached, normalizeTrips(cachedPayload));
  });

  it("ignora cache inválido ou ausente", () => {
    storage.setItem("reports:route:last", "{not json}");
    assert.equal(readCachedReport("reports:route:last", normalizeRoute), null);

    storage.clear();
    assert.equal(readCachedReport("reports:summary:last", normalizeSummary), null);
  });

  it("salva cache de forma segura", () => {
    const payload = { summary: [{ duration: 20 }] };
    writeCachedReport("reports:summary:last", payload);
    const hydrated = readCachedReport("reports:summary:last", normalizeSummary);

    assert.deepEqual(hydrated, normalizeSummary(payload));
  });

  it("normaliza respostas vazias das APIs", () => {
    assert.deepEqual(normalizeTrips(null), { trips: [] });
    assert.deepEqual(normalizeRoute(undefined), { positions: [] });
    assert.deepEqual(normalizeSummary(0), { summary: [] });
    assert.deepEqual(normalizeStops(false), { stops: [] });
  });

  it("normaliza respostas preenchidas das APIs", () => {
    const routePayload = { data: [{ id: 1 }, { id: 2 }] };
    assert.deepEqual(normalizeRoute(routePayload).positions, routePayload.data);

    const tripsPayload = { trips: [{ id: "abc" }] };
    assert.deepEqual(normalizeTrips(tripsPayload).trips, tripsPayload.trips);

    const summaryPayload = { summary: [{ total: 10 }] };
    assert.deepEqual(normalizeSummary(summaryPayload).summary, summaryPayload.summary);

    const stopsPayload = { data: [{ id: 50 }] };
    assert.deepEqual(normalizeStops(stopsPayload).stops, stopsPayload.data);
  });
});
