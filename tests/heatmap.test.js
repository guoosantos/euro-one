import test from "node:test";
import assert from "node:assert";

import { aggregateHeatmapEvents, extractCoordinates, rankHeatmapZones } from "../server/utils/heatmap.js";

test("extractCoordinates resolve lat/lng from multiple shapes", () => {
  const event = { attributes: { latitude: "-23.1", longitude: "-46.2" } };
  assert.deepStrictEqual(extractCoordinates(event), { lat: -23.1, lng: -46.2 });
});

test("aggregateHeatmapEvents agrupa coordenadas semelhantes", () => {
  const events = [
    { latitude: -23.1, longitude: -46.2 },
    { latitude: -23.10001, longitude: -46.20001 },
    { latitude: -22.9, longitude: -46.0 },
  ];
  const points = aggregateHeatmapEvents(events, { precision: 3 });
  assert.strictEqual(points.length, 2);
  const byKey = new Map(points.map((p) => [`${p.lat.toFixed(3)},${p.lng.toFixed(3)}`, p.count]));
  assert.strictEqual(byKey.get("-23.100,-46.200"), 2);
  assert.strictEqual(byKey.get("-22.900,-46.000"), 1);
});

test("rankHeatmapZones retorna top ordenado", () => {
  const points = [
    { lat: 1, lng: 1, count: 5 },
    { lat: 2, lng: 2, count: 10 },
    { lat: 3, lng: 3, count: 2 },
  ];
  const ranked = rankHeatmapZones(points, 2);
  assert.strictEqual(ranked.length, 2);
  assert.deepStrictEqual(ranked[0], points[1]);
});

test("aggregateHeatmapEvents ignora eventos sem coordenada", () => {
  const events = [
    { some: "data" },
    { latitude: null, longitude: undefined },
    { latitude: -10, longitude: 20 },
  ];
  const points = aggregateHeatmapEvents(events);
  assert.strictEqual(points.length, 1);
  assert.deepStrictEqual(points[0], { lat: -10, lng: 20, count: 1 });
});
