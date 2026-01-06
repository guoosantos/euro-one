import assert from "node:assert/strict";
import test from "node:test";

import { config } from "../config.js";
import { resolveReverseGeocode } from "../services/geocode-provider.js";

test("resolveReverseGeocode usa provider Nominatim com fetch mockado", async () => {
  const originalFetch = global.fetch;
  const originalProvider = config.geocoder.provider;
  const originalBaseUrl = config.geocoder.baseUrl;
  const originalQps = config.geocoder.qpsLimit;
  const originalTimeout = config.geocoder.timeoutMs;

  config.geocoder.provider = "nominatim";
  config.geocoder.baseUrl = "https://nominatim.openstreetmap.org";
  config.geocoder.qpsLimit = 1000;
  config.geocoder.timeoutMs = 1000;

  let requestedUrl = null;
  global.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ display_name: "Rua Teste, 100" }),
    };
  };

  try {
    const payload = await resolveReverseGeocode(-23.5, -46.6);
    assert.equal(payload.display_name, "Rua Teste, 100");
    assert.ok(String(requestedUrl).includes("nominatim.openstreetmap.org"));
  } finally {
    global.fetch = originalFetch;
    config.geocoder.provider = originalProvider;
    config.geocoder.baseUrl = originalBaseUrl;
    config.geocoder.qpsLimit = originalQps;
    config.geocoder.timeoutMs = originalTimeout;
  }
});
