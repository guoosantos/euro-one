import assert from "node:assert/strict";
import test from "node:test";
import { resolveEventDescriptor } from "../../shared/telemetryDictionary.js";

test("resolveEventDescriptor aplica protocolo GT06 e IOTM", () => {
  const gt06 = resolveEventDescriptor("69", { protocol: "gt06" });
  assert.equal(gt06?.labelPt, "GSM Jamming");

  const iotm = resolveEventDescriptor("1", { protocol: "iotm" });
  assert.equal(iotm?.labelPt, "Ignição ligada");
});
