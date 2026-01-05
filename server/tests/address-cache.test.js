import assert from "node:assert/strict";
import test from "node:test";
import { ensurePositionAddress, persistGeocode } from "../utils/address.js";
import { initStorage } from "../services/storage.js";

test("ensurePositionAddress usa cache persistido sem geocode remoto", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("fetch não deveria ser chamado");
  };

  try {
    await initStorage();
    await persistGeocode(-23.5, -46.6, { formatted: "Rua Teste, 100 - SP" });
    const position = await ensurePositionAddress({
      latitude: -23.5,
      longitude: -46.6,
    });
    assert.equal(position.fullAddress, "Rua Teste, 100 - SP");
    assert.equal(position.shortAddress, "Rua Teste, 100 - SP");
  } finally {
    global.fetch = originalFetch;
  }
});
