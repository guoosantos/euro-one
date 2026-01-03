import test from "node:test";
import assert from "node:assert/strict";

import { buildCriticalVehicleSummary } from "../utils/critical-vehicles.js";

test("buildCriticalVehicleSummary returns vehicles with 2+ critical events within window", () => {
  const now = new Date("2025-01-01T12:00:00Z");
  const events = [
    { id: "1", vehicleId: "veh-1", severity: "critical", eventTime: "2025-01-01T11:30:00Z" },
    { id: "2", vehicleId: "veh-1", severity: "critical", eventTime: "2025-01-01T10:45:00Z" },
    { id: "3", vehicleId: "veh-2", severity: "critical", eventTime: "2025-01-01T11:10:00Z" },
  ];

  const result = buildCriticalVehicleSummary(events, { now, windowMs: 3 * 60 * 60 * 1000, minEvents: 2 });

  assert.equal(result.length, 1);
  assert.equal(result[0].vehicleId, "veh-1");
  assert.equal(result[0].count, 2);
  assert.equal(result[0].lastEventAt, "2025-01-01T11:30:00.000Z");
});

test("buildCriticalVehicleSummary ignores resolved or out-of-window events", () => {
  const now = new Date("2025-01-01T12:00:00Z");
  const events = [
    { id: "1", vehicleId: "veh-1", severity: "critical", eventTime: "2025-01-01T08:30:00Z" },
    { id: "2", vehicleId: "veh-1", severity: "critical", eventTime: "2025-01-01T11:45:00Z", resolved: true },
    { id: "3", vehicleId: "veh-1", severity: "critical", eventTime: "2025-01-01T11:55:00Z" },
  ];

  const result = buildCriticalVehicleSummary(events, { now, windowMs: 3 * 60 * 60 * 1000, minEvents: 2 });

  assert.equal(result.length, 0);
});
