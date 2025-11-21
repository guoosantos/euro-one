import test from "node:test";
import assert from "node:assert/strict";
import { buildGeofencePayload, decodeGeofencePolygon } from "../src/lib/geofence-utils.js";

test("buildPayload produces circle payload", () => {
  const payload = buildGeofencePayload({
    name: "Base",
    shapeType: "circle",
    radius: 300,
    center: [-23.5, -46.6],
    points: [],
  });
  assert.equal(payload.name, "Base");
  assert.equal(payload.type, "circle");
  assert.equal(payload.radius, 300);
  assert.equal(payload.latitude, -23.5);
  assert.equal(payload.longitude, -46.6);
});

test("buildPayload produces polygon payload", () => {
  const payload = buildGeofencePayload({
    name: "Polígono",
    shapeType: "polygon",
    radius: 0,
    center: null,
    points: [
      [-23.5, -46.6],
      [-23.6, -46.7],
      [-23.4, -46.8],
    ],
  });
  assert.equal(payload.type, "polygon");
  assert.ok(payload.area.includes("-23.5 -46.6"));
});

test("decodePolygon converts area string to coordinates", () => {
  const points = decodeGeofencePolygon("-23.5 -46.6,-23.6 -46.7");
  assert.equal(points.length, 2);
  assert.deepEqual(points[0], [-23.5, -46.6]);
});
