import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import * as chipModel from "../models/chip.js";
import * as deviceModel from "../models/device.js";
import { linkChipToDevice } from "../routes/core.js";

describe("chip-device linking", () => {
  it("links chip and device in both directions", () => {
    const clientId = `client-${randomUUID()}`;
    const device = deviceModel.createDevice({ clientId, name: "Tracker 01", uniqueId: `imei-${randomUUID()}` });
    const chip = chipModel.createChip({ clientId, iccid: `iccid-${randomUUID()}`, phone: "11999999999" });

    linkChipToDevice(clientId, chip.id, device.id);

    const updatedChip = chipModel.getChipById(chip.id);
    const updatedDevice = deviceModel.getDeviceById(device.id);

    assert.equal(updatedChip.deviceId, device.id);
    assert.equal(updatedDevice.chipId, chip.id);
  });

  it("filters devices by clientId", () => {
    const clientA = `client-${randomUUID()}`;
    const clientB = `client-${randomUUID()}`;
    deviceModel.createDevice({ clientId: clientA, name: "A", uniqueId: `imei-${randomUUID()}` });
    deviceModel.createDevice({ clientId: clientB, name: "B", uniqueId: `imei-${randomUUID()}` });

    const listA = deviceModel.listDevices({ clientId: clientA });
    const listB = deviceModel.listDevices({ clientId: clientB });

    assert.equal(listA.every((device) => device.clientId === clientA), true);
    assert.equal(listB.every((device) => device.clientId === clientB), true);
  });
});
