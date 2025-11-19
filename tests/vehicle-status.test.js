import test from "node:test";
import assert from "node:assert";

import { classifyVehicleStates } from "../server/utils/vehicle-status.js";

test("classifyVehicleStates identifica veículos em movimento", () => {
  const result = classifyVehicleStates({
    positions: [
      { deviceId: "1", speed: 12 },
      { deviceId: "2", speed: 2 },
    ],
  });
  assert.deepStrictEqual(result.enRoute, ["1"]);
});

test("classifyVehicleStates agrupa entregas e coletas com atrasos", () => {
  const now = Date.parse("2024-01-01T12:00:00Z");
  const tasks = [
    { vehicleId: "1", type: "coleta", status: "em rota", endTimeExpected: "2024-01-01T10:00:00Z" },
    { vehicleId: "2", type: "entrega", status: "em atendimento", endTimeExpected: "2024-01-01T11:00:00Z" },
    { vehicleId: "3", type: "entrega", status: "atrasada", endTimeExpected: "2024-01-01T13:00:00Z" },
  ];
  const result = classifyVehicleStates({ tasks, now });
  assert.deepStrictEqual(new Set(result.collecting), new Set(["1"]));
  assert.deepStrictEqual(new Set(result.delivering), new Set(["2", "3"]));
  assert.ok(result.routeDelay.includes("1") && result.routeDelay.includes("3"));
  assert.ok(result.serviceDelay.includes("2") && result.serviceDelay.includes("3"));
});
