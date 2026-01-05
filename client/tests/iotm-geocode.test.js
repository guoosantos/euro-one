import test from "node:test";
import assert from "node:assert/strict";

import { formatIotmDiagEvent } from "../src/utils/formatIotmDiagEvent.js";
import { formatGeocodeAddress } from "../src/utils/formatGeocodeAddress.js";
import { reverseGeocode } from "../src/services/reverseGeocode.js";

const buildMockResponse = (status, payload = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

test("formatIotmDiagEvent resolve eventos especiais", () => {
  assert.strictEqual(
    formatIotmDiagEvent({ funId: 0, warId: 164 }),
    "Sincronização NTP concluída",
  );
  assert.strictEqual(
    formatIotmDiagEvent({ funId: 20, warId: 12 }),
    "Registro de falhas (bits 24–31): 12",
  );
});

test("formatGeocodeAddress normaliza objeto em string", () => {
  const formatted = formatGeocodeAddress({ road: "Rua X", suburb: "Bairro Y", town: "Z", state: "MG" });
  assert.ok(formatted.includes("R. X"));
  assert.ok(formatted.includes("Bairro Y"));
  assert.ok(formatted.includes("Z"));
  assert.ok(formatted.includes("MG"));
});

test("reverseGeocode retorna null em erro 502", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => buildMockResponse(502, { error: "Bad Gateway" });

  try {
    const resolved = await reverseGeocode(-19.9, -43.9);
    assert.strictEqual(resolved, null);
  } finally {
    global.fetch = originalFetch;
  }
});
