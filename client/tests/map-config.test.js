import test from "node:test";
import assert from "node:assert/strict";

import { buildEffectiveMaxZoom, normaliseGeocoderUrl, resolveFocusZoom, resolveMapPreferences } from "../src/lib/map-config.js";
import { mapGeocoderError } from "../src/lib/hooks/useGeocodeSearch.js";

test("resolveFocusZoom aplica clamp com maxZoom configurado", () => {
  const { zoom } = resolveFocusZoom({ requestedZoom: 16, selectZoom: 15, maxZoom: 10, providerMaxZoom: 20 });
  assert.equal(zoom, 10);
});

test("resolveFocusZoom respeita selectZoom padrão quando zoom atual é baixo", () => {
  const { zoom } = resolveFocusZoom({ requestedZoom: null, selectZoom: 15, currentZoom: 8, maxZoom: null, providerMaxZoom: 19 });
  assert.equal(zoom, 15);
});

test("resolveMapPreferences ativa aviso quando maxZoom é muito baixo", () => {
  const prefs = resolveMapPreferences({ "web.maxZoom": 2 });
  assert.equal(prefs.shouldWarnMaxZoom, true);
  assert.equal(buildEffectiveMaxZoom(prefs.maxZoom, 18), 2);
});

test("normaliseGeocoderUrl garante https e normaliza caminho", () => {
  const url = normaliseGeocoderUrl("nominatim.openstreetmap.org/search/");
  assert.equal(url, "https://nominatim.openstreetmap.org/search");
});

test("mapGeocoderError retorna mensagens amigáveis para 429 e falhas de rede", () => {
  assert.equal(mapGeocoderError({ status: 429 }), "Geocoder recusou a requisição (403/429). Verifique bloqueio/rate limit e considere usar geocoder próprio.");
  assert.equal(mapGeocoderError({ message: "Falha ao consultar geocoder. Verifique conectividade/firewall/CORS.", cause: new TypeError("network") }), "Falha ao consultar geocoder. Verifique conectividade/firewall/CORS.");
});
