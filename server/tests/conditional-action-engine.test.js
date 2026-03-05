import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  __resetConditionalActionsForTests,
  createConditionalActionRule,
  listConditionalActionEvents,
  listConditionalActionHistory,
} from "../models/conditional-action.js";
import {
  __resetConditionalActionEngineForTests,
  ingestConditionalActions,
} from "../services/conditional-action-engine.js";

afterEach(() => {
  __resetConditionalActionEngineForTests();
  __resetConditionalActionsForTests();
});

describe("conditional-action-engine", () => {
  it("dispara evento quando a condição de velocidade é satisfeita", async () => {
    const clientId = "client-speed";
    createConditionalActionRule({
      clientId,
      payload: {
        name: "Velocidade crítica",
        active: true,
        scope: { mode: "all" },
        conditions: {
          operator: "AND",
          items: [
            {
              type: "speed_above",
              params: { threshold: 80, durationSeconds: 0 },
            },
          ],
        },
        actions: [
          {
            type: "create_event",
            params: { title: "Excesso de velocidade condicional", severity: "critical" },
          },
        ],
        settings: { cooldownMinutes: 0, priority: 5, maxExecutionsPerHour: 0 },
      },
      createdBy: "u-1",
      createdByName: "Tester",
    });

    const generated = await ingestConditionalActions({
      clientId,
      vehicleId: "v-1",
      deviceId: "101",
      position: {
        latitude: -23.55,
        longitude: -46.63,
        speed: 50, // nós ~= 92.6 km/h
        fixTime: new Date().toISOString(),
      },
      attributes: {},
      events: [],
    });

    assert.equal(generated.length, 1);
    assert.equal(generated[0].eventSeverity, "critical");

    const events = listConditionalActionEvents({ clientId });
    assert.equal(events.length, 1);

    const history = listConditionalActionHistory({ clientId, page: 1, limit: 10 });
    assert.equal(history.total, 1);
    assert.equal(history.data[0].status, "success");
  });

  it("respeita cooldown por escopo e evita re-disparo imediato", async () => {
    const clientId = "client-cooldown";
    createConditionalActionRule({
      clientId,
      payload: {
        name: "Cooldown regra",
        active: true,
        scope: { mode: "all" },
        conditions: {
          operator: "AND",
          items: [{ type: "speed_above", params: { threshold: 60 } }],
        },
        actions: [{ type: "create_event", params: { title: "Evento com cooldown" } }],
        settings: { cooldownMinutes: 10, priority: 5, maxExecutionsPerHour: 0 },
      },
      createdBy: "u-1",
      createdByName: "Tester",
    });

    const first = await ingestConditionalActions({
      clientId,
      vehicleId: "v-2",
      deviceId: "102",
      position: { latitude: -22.9, longitude: -43.2, speed: 40, fixTime: new Date().toISOString() },
      attributes: {},
      events: [],
    });
    assert.equal(first.length, 1);

    const second = await ingestConditionalActions({
      clientId,
      vehicleId: "v-2",
      deviceId: "102",
      position: { latitude: -22.9, longitude: -43.2, speed: 45, fixTime: new Date().toISOString() },
      attributes: {},
      events: [],
    });
    assert.equal(second.length, 0);

    const history = listConditionalActionHistory({ clientId, page: 1, limit: 10 });
    assert.equal(history.total, 1);
  });

  it("permite condição por evento específico", async () => {
    const clientId = "client-event-condition";
    createConditionalActionRule({
      clientId,
      payload: {
        name: "Disparo por evento",
        active: true,
        scope: { mode: "all" },
        conditions: {
          operator: "AND",
          items: [{ type: "event_equals", params: { eventId: "ITINERARIO_INVERTIDO" } }],
        },
        actions: [{ type: "create_event", params: { title: "Evento por gatilho externo" } }],
        settings: { cooldownMinutes: 0, priority: 5, maxExecutionsPerHour: 0 },
      },
      createdBy: "u-1",
      createdByName: "Tester",
    });

    const withoutTrigger = await ingestConditionalActions({
      clientId,
      vehicleId: "v-3",
      deviceId: "103",
      position: { latitude: -15, longitude: -47, speed: 20, fixTime: new Date().toISOString() },
      attributes: {},
      events: [],
    });
    assert.equal(withoutTrigger.length, 0);

    const withTrigger = await ingestConditionalActions({
      clientId,
      vehicleId: "v-3",
      deviceId: "103",
      position: { latitude: -15, longitude: -47, speed: 20, fixTime: new Date().toISOString() },
      attributes: {},
      events: [{ eventId: "ITINERARIO_INVERTIDO", type: "itineraryReverse" }],
    });
    assert.equal(withTrigger.length, 1);
  });
});

