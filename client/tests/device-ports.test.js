import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildPortList, normalizePortCounts } from "../src/lib/device-ports.js";

describe("buildPortList", () => {
  it("prioritizes vehicle labels over device labels", () => {
    const model = { portCounts: { di: 2, do: 0, rs232: 0, rs485: 0, can: 0, lora: 0, wifi: 0, bluetooth: 0 } };
    const ports = buildPortList({
      model,
      telemetry: { input1: true, input2: false },
      deviceLabels: { DI1: "Porta cabine" },
      vehicleLabels: { DI1: "Sensor baú" },
    });
    const di1 = ports.find((port) => port.key === "DI1");
    const di2 = ports.find((port) => port.key === "DI2");
    assert.equal(di1.label, "Sensor baú");
    assert.ok(di2.label.includes("Entrada 2"));
  });
});

describe("normalizePortCounts", () => {
  it("treats null/undefined as zero and supports legacy keys", () => {
    const counts = normalizePortCounts({
      entradasDI: null,
      saidasDO: "2",
      rs232: undefined,
      rs485: "0",
      can: 1,
      lora: "",
      wifi: "3",
      bluetooth: null,
    });
    assert.deepEqual(counts, {
      di: 0,
      do: 2,
      rs232: 0,
      rs485: 0,
      can: 1,
      lora: 0,
      wifi: 3,
      bluetooth: 0,
    });
  });
});
