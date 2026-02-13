import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { createVehicle, deleteVehicle } from "../models/vehicle.js";
import { createDevice, deleteDevice, updateDevice } from "../models/device.js";
import { createRoute, deleteRoute } from "../models/route.js";
import { createItinerary, deleteItinerary } from "../models/itinerary.js";
import { clearDeployments, createDeployment } from "../models/xdm-deployment.js";
import {
  __resetItineraryDirectionForTests,
  ingestItineraryDirectionEvents,
  listItineraryDirectionEvents,
} from "../services/itinerary-direction-events.js";

const createdVehicleIds = [];
const createdDeviceIds = [];
const createdRouteIds = [];
const createdItineraryIds = [];

function isoFrom(base, plusSeconds) {
  return new Date(base.getTime() + plusSeconds * 1000).toISOString();
}

afterEach(async () => {
  createdDeviceIds.splice(0).forEach((id) => {
    try {
      deleteDevice(id);
    } catch (_error) {
      // ignore cleanup error
    }
  });
  createdVehicleIds.splice(0).forEach((id) => {
    try {
      deleteVehicle(id);
    } catch (_error) {
      // ignore cleanup error
    }
  });
  for (const id of createdRouteIds.splice(0)) {
    try {
      await deleteRoute(id);
    } catch (_error) {
      // ignore cleanup error
    }
  }
  createdItineraryIds.splice(0).forEach((id) => {
    try {
      deleteItinerary(id);
    } catch (_error) {
      // ignore cleanup error
    }
  });
  clearDeployments();
  __resetItineraryDirectionForTests();
});

describe("itinerary direction events", () => {
  it("gera evento quando o deslocamento predominante ocorre no sentido inverso da rota", async () => {
    const clientId = `client-${randomUUID()}`;
    const vehicle = createVehicle({
      clientId,
      plate: `ABC${String(Math.floor(Math.random() * 9000) + 1000)}`,
      model: "Caminhao Teste",
      type: "Caminhao",
    });
    createdVehicleIds.push(vehicle.id);

    const device = createDevice({
      clientId,
      uniqueId: `IMEI-${randomUUID()}`,
      traccarId: String(Math.floor(Math.random() * 900000) + 100000),
    });
    createdDeviceIds.push(device.id);
    updateDevice(device.id, { vehicleId: vehicle.id });

    const route = await createRoute({
      clientId,
      name: "Rota A-B",
      points: [
        [0, 0],
        [0, 0.02],
      ],
      metadata: { bufferMeters: 220 },
    });
    createdRouteIds.push(route.id);

    const itinerary = createItinerary({
      clientId,
      name: "Itinerario Principal",
      items: [{ type: "route", id: route.id }],
    });
    createdItineraryIds.push(itinerary.id);

    createDeployment({
      clientId,
      itineraryId: itinerary.id,
      vehicleId: vehicle.id,
      deviceImei: device.uniqueId,
      requestedByUserId: "user-1",
      requestedByName: "Tester",
      status: "DEPLOYED",
      action: "EMBARK",
    });

    const base = new Date();
    const samples = [
      { lat: 0, lng: 0.019, s: 0 },
      { lat: 0, lng: 0.018, s: 30 },
      { lat: 0, lng: 0.017, s: 60 },
      { lat: 0, lng: 0.016, s: 90 },
      { lat: 0, lng: 0.015, s: 120 },
      { lat: 0, lng: 0.014, s: 150 },
      { lat: 0, lng: 0.013, s: 180 },
    ];

    let generated = [];
    samples.forEach((sample) => {
      const created = ingestItineraryDirectionEvents({
        clientId,
        vehicleId: vehicle.id,
        deviceId: device.traccarId || device.id,
        position: {
          latitude: sample.lat,
          longitude: sample.lng,
          fixTime: isoFrom(base, sample.s),
          protocol: "iotm",
          address: "Avenida Teste, 123",
        },
      });
      if (Array.isArray(created) && created.length) {
        generated = created;
      }
    });

    assert.equal(generated.length, 1);
    assert.equal(generated[0].eventId, "ITINERARIO_INVERTIDO");
    assert.equal(generated[0].eventSeverity, "critical");

    const listed = listItineraryDirectionEvents({ clientId });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].vehicleId, vehicle.id);
  });

  it("nao gera evento com poucos pontos e baixa distancia acumulada", async () => {
    const clientId = `client-${randomUUID()}`;
    const vehicle = createVehicle({
      clientId,
      plate: `DEF${String(Math.floor(Math.random() * 9000) + 1000)}`,
      model: "Van Teste",
      type: "Van",
    });
    createdVehicleIds.push(vehicle.id);

    const device = createDevice({
      clientId,
      uniqueId: `IMEI-${randomUUID()}`,
      traccarId: String(Math.floor(Math.random() * 900000) + 100000),
    });
    createdDeviceIds.push(device.id);
    updateDevice(device.id, { vehicleId: vehicle.id });

    const route = await createRoute({
      clientId,
      name: "Rota curta",
      points: [
        [0, 0],
        [0, 0.02],
      ],
    });
    createdRouteIds.push(route.id);

    const itinerary = createItinerary({
      clientId,
      name: "Itinerario Curto",
      items: [{ type: "route", id: route.id }],
    });
    createdItineraryIds.push(itinerary.id);

    createDeployment({
      clientId,
      itineraryId: itinerary.id,
      vehicleId: vehicle.id,
      deviceImei: device.uniqueId,
      requestedByUserId: "user-1",
      requestedByName: "Tester",
      status: "DEPLOYED",
      action: "EMBARK",
    });

    const base = new Date();
    const samples = [
      { lat: 0, lng: 0.0100, s: 0 },
      { lat: 0, lng: 0.0099, s: 10 },
      { lat: 0, lng: 0.0098, s: 20 },
    ];

    const generatedCount = samples.reduce((count, sample) => {
      const created = ingestItineraryDirectionEvents({
        clientId,
        vehicleId: vehicle.id,
        deviceId: device.traccarId || device.id,
        position: {
          latitude: sample.lat,
          longitude: sample.lng,
          fixTime: isoFrom(base, sample.s),
        },
      });
      return count + (Array.isArray(created) ? created.length : 0);
    }, 0);

    assert.equal(generatedCount, 0);
    assert.equal(listItineraryDirectionEvents({ clientId }).length, 0);
  });
});
