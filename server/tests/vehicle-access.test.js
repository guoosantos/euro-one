import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { config } from "../config.js";
import { createGroup, deleteGroup } from "../models/group.js";
import { createVehicle, deleteVehicle } from "../models/vehicle.js";
import { getAccessibleVehicles } from "../services/accessible-vehicles.js";

const createdVehicles = [];
const createdGroups = [];
const originalMirrorMode = config.features.mirrorMode;

function buildVehicle({ clientId, plate }) {
  const vehicle = createVehicle({ clientId, plate, model: "Teste", type: "carro" });
  createdVehicles.push(vehicle.id);
  return vehicle;
}

function buildVehicleGroup({ clientId, name, attributes }) {
  const group = createGroup({
    clientId,
    name,
    description: "Grupo teste",
    attributes: { kind: "VEHICLE_GROUP", ...(attributes || {}) },
  });
  createdGroups.push(group.id);
  return group;
}

afterEach(() => {
  createdVehicles.splice(0).forEach((id) => {
    try {
      deleteVehicle(id);
    } catch (_error) {
      // ignore
    }
  });
  createdGroups.splice(0).forEach((id) => {
    try {
      deleteGroup(id);
    } catch (_error) {
      // ignore
    }
  });
  config.features.mirrorMode = originalMirrorMode;
});

describe("getAccessibleVehicles (user access)", () => {
  it("filtra veículos por grupo BY_CLIENT quando modo selecionado", async () => {
    config.features.mirrorMode = false;
    const clientId = "client-access-1";
    const v1 = buildVehicle({ clientId, plate: "AAA-0001" });
    const v2 = buildVehicle({ clientId, plate: "AAA-0002" });
    const group = buildVehicleGroup({
      clientId,
      name: "Grupo cliente",
      attributes: { groupType: "BY_CLIENT", sourceClientId: clientId },
    });

    const access = await getAccessibleVehicles({
      user: {
        id: "user-1",
        role: "user",
        clientId,
        attributes: {
          userAccess: {
            vehicleAccess: { mode: "selected", vehicleIds: [] },
            vehicleGroupIds: [group.id],
          },
        },
      },
      clientId,
    });

    assert.deepEqual(
      access.vehicles.map((vehicle) => vehicle.id).sort(),
      [v1.id, v2.id].sort(),
    );
  });

  it("retorna lista vazia quando modo selecionado sem grupos ou veículos", async () => {
    config.features.mirrorMode = false;
    const clientId = "client-access-2";
    buildVehicle({ clientId, plate: "BBB-0001" });

    const access = await getAccessibleVehicles({
      user: {
        id: "user-2",
        role: "user",
        clientId,
        attributes: {
          userAccess: {
            vehicleAccess: { mode: "selected", vehicleIds: [] },
            vehicleGroupIds: [],
          },
        },
      },
      clientId,
    });

    assert.equal(access.vehicles.length, 0);
  });
});
