import assert from "node:assert/strict";
import test from "node:test";

import { initStorage, __resetStorageForTests } from "../services/storage.js";
import {
  createDeployment,
  clearDeployments,
  listLatestDeploymentsByItinerary,
  updateDeployment,
} from "../models/xdm-deployment.js";
import { __resolveBlockingEmbarkDeployments } from "../routes/itineraries.js";

test("delete itinerário ignora deployments antigos quando último é desembarque", async () => {
  __resetStorageForTests();
  await initStorage();
  clearDeployments();

  const first = createDeployment({
    clientId: "client-1",
    itineraryId: "it-1",
    vehicleId: "veh-1",
    action: "EMBARK",
  });
  updateDeployment(first.id, { status: "DEPLOYED", startedAt: "2024-01-01T00:00:00Z" });

  const second = createDeployment({
    clientId: "client-1",
    itineraryId: "it-1",
    vehicleId: "veh-1",
    action: "DISEMBARK",
  });
  updateDeployment(second.id, { status: "CLEARED", startedAt: "2024-01-02T00:00:00Z" });

  const latest = listLatestDeploymentsByItinerary({
    clientId: "client-1",
    itineraryId: "it-1",
  });

  assert.equal(latest.length, 1);
  assert.equal(latest[0].id, second.id);

  const blocking = __resolveBlockingEmbarkDeployments(latest);
  assert.equal(blocking.length, 0);
});
