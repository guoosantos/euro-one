import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveStatus,
  distanceInKm,
  getDeviceKey,
  getLastUpdate,
  isLinkedToVehicle,
  isOnline,
  minutesSince,
  pickCoordinate,
  pickSpeed,
} from "../src/lib/monitoring-helpers.js";

test("getDeviceKey normaliza vários identificadores", () => {
  assert.equal(getDeviceKey({ id: 10 }), "10");
  assert.equal(getDeviceKey({ deviceId: "abc" }), "abc");
  assert.equal(getDeviceKey({ unique_id: 99 }), "99");
  assert.equal(getDeviceKey({ identifier: "ZX" }), "ZX");
});

test("pickCoordinate retorna primeiro número válido", () => {
  assert.equal(pickCoordinate([null, "", "-23.5", -22]), -23.5);
  assert.equal(pickCoordinate([undefined, "foo", 1]), 1);
  assert.equal(pickCoordinate([null, undefined]), null);
});

test("pickSpeed converte para km/h e arredonda", () => {
  assert.equal(pickSpeed({ speed: 10 }), 36);
  assert.equal(pickSpeed({ attributes: { speed: "5.2" } }), 19);
  assert.equal(pickSpeed({}), null);
});

test("isOnline avalia idade da posição", () => {
  const now = Date.now();
  const fresh = { serverTime: new Date(now - 2 * 60 * 1000).toISOString() };
  const stale = { serverTime: new Date(now - 10 * 60 * 1000).toISOString() };
  assert.equal(isOnline(fresh, 5), true);
  assert.equal(isOnline(stale, 5), false);
});

test("deriveStatus respeita bloqueio e alarmes", () => {
  const base = { serverTime: new Date().toISOString() };
  assert.equal(deriveStatus(base), "online");
  assert.equal(deriveStatus({ ...base, attributes: { alarm: true } }), "alert");
  assert.equal(deriveStatus({ ...base, blocked: true }), "blocked");
  assert.equal(deriveStatus(null), "offline");
});

test("getLastUpdate aceita campos alternativos", () => {
  const fix = getLastUpdate({ fixTime: "2024-01-01T00:00:00Z" });
  assert.ok(fix instanceof Date);
  assert.equal(fix.toISOString(), "2024-01-01T00:00:00.000Z");
});

test("minutesSince retorna infinito para entradas inválidas", () => {
  assert.equal(minutesSince(null), Infinity);
});

test("distanceInKm calcula distância aproximada", () => {
  const distance = distanceInKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  assert.ok(distance > 110 && distance < 112); // ~111 km por grau
});

test("isLinkedToVehicle ignora veículo sintético criado apenas por id", () => {
  const syntheticVehicle = { id: "v1", plate: "ABC1D23", __synthetic: true };
  const entry = { device: { id: "d1" }, source: {}, vehicle: syntheticVehicle };
  assert.equal(isLinkedToVehicle(entry), false);
});

test("isLinkedToVehicle considera vínculo real via device.vehicleId", () => {
  const entry = { device: { id: "d1", vehicleId: "v1" }, source: {}, vehicle: null };
  assert.equal(isLinkedToVehicle(entry), true);
});
