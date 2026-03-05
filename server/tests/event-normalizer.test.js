import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeEventPayload } from "../services/event-normalizer.js";

describe("event-normalizer", () => {
  it("normalizes GT06 alarm codes and formats metrics", () => {
    const event = {
      id: 1,
      deviceId: 10,
      type: "alarm",
      attributes: {
        alarm: "2",
        power: 12.3456,
        speed: 10,
        temperature: -273,
      },
    };

    const normalized = normalizeEventPayload({ event, protocol: "gt06" });
    assert.ok(normalized, "normalized payload should exist");
    assert.equal(normalized.eventType, "POWER_CUT");
    assert.equal(normalized.typeKey, "powercut");

    const metrics = new Map((normalized.metrics || []).map((entry) => [entry.key, entry]));
    assert.equal(metrics.get("power")?.text, "12.35 V");
    assert.equal(metrics.get("speed")?.text, "18.5 km/h");
    assert.equal(metrics.get("temperature")?.valid, false);
    assert.equal(metrics.get("temperature")?.text, "Valor inválido");
  });

  it("normalizes Suntech event types and formats battery", () => {
    const event = {
      id: 2,
      deviceId: 22,
      type: "deviceOffline",
      attributes: {
        batteryLevel: 88.6,
      },
    };

    const normalized = normalizeEventPayload({ event, protocol: "suntech" });
    assert.ok(normalized, "normalized payload should exist");
    assert.equal(normalized.eventType, "DEVICE_OFFLINE");
    assert.equal(normalized.typeKey, "deviceoffline");

    const metrics = new Map((normalized.metrics || []).map((entry) => [entry.key, entry]));
    assert.equal(metrics.get("batteryLevel")?.text, "89 %");
  });
});
