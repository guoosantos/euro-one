import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normaliseDeviceList, pickNewestPosition, normalisePositionResponse } from "../src/lib/hooks/useDevices.helpers.js";
import { buildParams } from "../src/lib/hooks/events-helpers.js";

describe("useDevices helpers", () => {
  it("normalises device arrays from different payload formats", () => {
    const sample = [{ id: 1 }, { id: 2 }];
    assert.deepEqual(normaliseDeviceList(sample), sample);
    assert.deepEqual(normaliseDeviceList({ devices: sample }), sample);
    assert.deepEqual(normaliseDeviceList({ data: sample }), sample);
    assert.deepEqual(normaliseDeviceList(null), []);
  });

  it("selects the newest position by time fields", () => {
    const now = new Date();
    const older = { deviceId: 1, fixTime: new Date(now.getTime() - 60_000).toISOString() };
    const latest = { deviceId: 1, serverTime: now.toISOString() };
    const positions = [older, latest];
    assert.equal(pickNewestPosition(positions), latest);
  });

  it("normalises position responses", () => {
    const position = { id: 123 };
    assert.deepEqual(normalisePositionResponse(position), [position]);
    assert.deepEqual(normalisePositionResponse([position]), [position]);
    assert.deepEqual(normalisePositionResponse({ positions: [position] }), [position]);
    assert.deepEqual(normalisePositionResponse({ data: [position] }), [position]);
  });
});

describe("useEvents helpers", () => {
  it("monta parâmetros corretamente", () => {
    const params = buildParams({ deviceId: 10, types: ["speed", "alarm"], from: "2024-01-01", to: "2024-01-02", limit: 50 });
    assert.equal(params.deviceId, 10);
    assert.equal(params.type, "speed,alarm");
    assert.equal(params.from, "2024-01-01");
    assert.equal(params.to, "2024-01-02");
    assert.equal(params.limit, 50);
  });

  it("aceita tipo simples", () => {
    const params = buildParams({ types: "alarm" });
    assert.equal(params.type, "alarm");
  });
});
