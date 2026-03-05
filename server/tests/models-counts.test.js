import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildModelDeviceCounts, resolveModelIdFromDevice } from "../utils/model-stats.js";

describe("buildModelDeviceCounts", () => {
  it("counts linked and available devices by model (modelId and productId fallbacks)", () => {
    const devices = [
      { id: "d1", modelId: "m1", vehicleId: "v1" },
      { id: "d2", modelId: "m1", vehicleId: null },
      { id: "d3", attributes: { modelId: "m2" }, vehicleId: null },
      { id: "d4", attributes: { productId: "m2" }, vehicleId: "v2" },
      { id: "d5", productId: "m3", vehicleId: null },
      { id: "d6", model: { id: "m3" }, vehicleId: "v3" },
    ];

    const counts = buildModelDeviceCounts(devices);

    assert.deepEqual(counts.get("m1"), { available: 1, linked: 1, total: 2 });
    assert.deepEqual(counts.get("m2"), { available: 1, linked: 1, total: 2 });
    assert.deepEqual(counts.get("m3"), { available: 1, linked: 1, total: 2 });
  });

  it("counts ES JAMMER RAT and ES BLOCK RAT devices by modelId", () => {
    const ES_JAMMER_RAT = "09b09042-d151-409b-94a2-770cda5d2c90";
    const ES_BLOCK_RAT = "49b4e24e-41d5-43b1-9b01-0c534d3ae31c";
    const devices = [
      { id: "c346886f-829b-4148-bc6a-ff292041f89a", uniqueId: "25100001", attributes: { modelId: ES_JAMMER_RAT }, vehicleId: "v1" },
      { id: "19ae4d93-6e8b-4301-82f3-74710781bfdf", uniqueId: "25200002", attributes: { modelId: ES_BLOCK_RAT }, vehicleId: "v2" },
    ];

    const counts = buildModelDeviceCounts(devices);

    assert.deepEqual(counts.get(ES_JAMMER_RAT), { available: 0, linked: 1, total: 1 });
    assert.deepEqual(counts.get(ES_BLOCK_RAT), { available: 0, linked: 1, total: 1 });
  });
});

describe("resolveModelIdFromDevice", () => {
  it("resolves model id from legacy fields", () => {
    assert.equal(resolveModelIdFromDevice({ modelId: "m1", productId: "m2" }), "m1");
    assert.equal(resolveModelIdFromDevice({ productId: "m2" }), "m2");
    assert.equal(resolveModelIdFromDevice({ attributes: { modelId: "m3" } }), "m3");
    assert.equal(resolveModelIdFromDevice({ attributes: { productId: "m4" } }), "m4");
    assert.equal(resolveModelIdFromDevice({ model: { id: "m5" } }), "m5");
  });
});
