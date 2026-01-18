import assert from "node:assert/strict";
import test from "node:test";
import { resolvePositionEventLabel } from "../routes/proxy.js";

test("resolvePositionEventLabel aplica severidade Informativa para posição registrada", () => {
  const result = resolvePositionEventLabel({ latitude: -15.5, longitude: -47.6, attributes: {} });
  assert.equal(result.label, "Posição registrada");
  assert.equal(result.severity, "Informativa");
});

test("resolvePositionEventLabel mantém rótulo real para eventos inativos quando scope=all", () => {
  const position = {
    latitude: -15.5,
    longitude: -47.6,
    eventLabel: "Alerta teste",
    eventActive: false,
    attributes: { event: "123", eventLabel: "Alerta teste", eventActive: false },
  };
  const result = resolvePositionEventLabel(position, { eventScope: "all" });
  assert.notEqual(result.label, "Posição registrada");
});
