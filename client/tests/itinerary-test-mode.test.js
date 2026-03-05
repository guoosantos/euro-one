import test from "node:test";
import assert from "node:assert/strict";

import { translateItineraryStatusLabel } from "../src/lib/itinerary-status.js";
import { buildTestModeBannerData, shouldAutoShowTestModeOverlay } from "../src/lib/itinerary-test-mode.js";

test("translateItineraryStatusLabel normaliza CONFIRMED e DISEMBARKED", () => {
  assert.equal(translateItineraryStatusLabel("CONFIRMED"), "CONFIRMADO");
  assert.equal(translateItineraryStatusLabel("DISEMBARKED"), "DESEMBARCADO");
});

test("Modo teste com itinerário desembarcado exibe mensagem e bloqueia rota automática", () => {
  const banner = buildTestModeBannerData({
    enabled: true,
    itineraryName: "Rota X",
    plate: "ABC1D23",
    status: "DISEMBARKED",
    isDisembarked: false,
  });

  assert.equal(banner.kind, "disembarked");
  assert.ok(banner.message.toLowerCase().includes("desembarcado"));
  assert.equal(
    shouldAutoShowTestModeOverlay({
      enabled: true,
      hasOverlay: true,
      isDisembarked: true,
    }),
    false,
  );
});

test("Modo teste com itinerário confirmado bloqueia rota automática", () => {
  assert.equal(
    shouldAutoShowTestModeOverlay({
      enabled: true,
      hasOverlay: true,
      hasConfirmedEmbarked: true,
    }),
    false,
  );
});
