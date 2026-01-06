import assert from "node:assert/strict";
import test from "node:test";

import { calculateDistanceMeters, isWithinDistanceMeters } from "../utils/geo.js";

test("calculateDistanceMeters retorna 0 para pontos iguais", () => {
  const distance = calculateDistanceMeters({ latitude: -23.5, longitude: -46.6 }, { latitude: -23.5, longitude: -46.6 });
  assert.equal(distance, 0);
});

test("isWithinDistanceMeters respeita reuseDistance", () => {
  const from = { latitude: -23.5, longitude: -46.6 };
  const to = { latitude: -23.5001, longitude: -46.6 };
  const distance = calculateDistanceMeters(from, to);
  assert.ok(distance > 0);
  assert.ok(isWithinDistanceMeters(from, to, 25));
  assert.ok(!isWithinDistanceMeters(from, to, 5));
});
