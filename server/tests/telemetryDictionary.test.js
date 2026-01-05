import assert from "node:assert/strict";
import test from "node:test";
import { resolveEventDescriptor, resolveTelemetryDescriptor } from "../../shared/telemetryDictionary.js";

test("resolveEventDescriptor aplica protocolo GT06 e IOTM", () => {
  const gt06 = resolveEventDescriptor("69", { protocol: "gt06" });
  assert.equal(gt06?.labelPt, "Interferência GSM");

  const iotm = resolveEventDescriptor("1", { protocol: "iotm" });
  assert.equal(iotm?.labelPt, "Ignição ligada");
});

test("resolveTelemetryDescriptor resolve IOs amigáveis e fallback numérico", () => {
  const friendly = resolveTelemetryDescriptor("io49156");
  assert.equal(friendly?.labelPt, "Nome do script 1");

  const fallback = resolveTelemetryDescriptor("99999");
  assert.equal(fallback?.labelPt, "Sensor 99999");
});
