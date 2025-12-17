import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import { normaliseTraccarDevice, syncDevicesFromTraccar } from "../services/device-sync.js";

describe("device-sync", () => {
  it("normalises Traccar payloads", () => {
    const normalised = normaliseTraccarDevice({ id: 12, uniqueId: "  123 ", name: "Tracker" });

    assert.deepEqual(normalised, {
      traccarId: "12",
      uniqueId: "123",
      name: "Tracker",
      modelId: null,
      attributes: {},
    });
  });

  it("creates and updates devices while skipping conflicts", () => {
    const createDevice = mock.fn();
    const updateDevice = mock.fn();
    const existing = { id: "local-1", clientId: "client-a", traccarId: "20", name: null };

    const result = syncDevicesFromTraccar({
      clientId: "client-a",
      devices: [
        { id: 20, uniqueId: "aaa" },
        { id: 21, uniqueId: "bbb", attributes: { modelId: "model-1" } },
        { id: 22, name: "no-unique" },
        { id: 23, uniqueId: "ccc" },
      ],
      findDeviceByTraccarId: (id) => (id === "20" ? existing : null),
      findDeviceByUniqueId: (uniqueId) => (uniqueId === "ccc" ? { ...existing, id: "other", clientId: "other" } : null),
      createDevice,
      updateDevice,
    });

    assert.equal(createDevice.mock.callCount(), 1);
    assert.deepEqual(createDevice.mock.calls[0].arguments[0], {
      clientId: "client-a",
      name: "bbb",
      uniqueId: "bbb",
      modelId: "model-1",
      traccarId: "21",
      attributes: { modelId: "model-1", importedFrom: "traccar-sync" },
    });

    assert.equal(updateDevice.mock.callCount(), 1);
    assert.deepEqual(updateDevice.mock.calls[0].arguments[0], "local-1");
    assert.deepEqual(updateDevice.mock.calls[0].arguments[1], {
      name: "aaa",
      traccarId: "20",
      attributes: { importedFrom: "traccar-sync" },
    });

    assert.equal(result.created, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.total, 2);
    assert.equal(result.skipped.length, 2);
    assert.deepEqual(result.skipped[0], {
      traccarId: "22",
      reason: "Dispositivo no Traccar sem uniqueId",
    });
    assert.deepEqual(result.skipped[1], {
      uniqueId: "ccc",
      traccarId: "23",
      reason: "Dispositivo já existe em outro cliente",
    });
  });
});
