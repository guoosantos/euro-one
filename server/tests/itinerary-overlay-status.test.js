import assert from "node:assert/strict";
import test from "node:test";

import { __mapOverlayStatusCode } from "../routes/itineraries.js";

test("map overlay status codes para v2", () => {
  assert.equal(__mapOverlayStatusCode("CONFIRMED"), "CONFIRMED");
  assert.equal(__mapOverlayStatusCode("PENDING_CONFIRMATION"), "PENDING");
  assert.equal(__mapOverlayStatusCode("ERROR"), "FAILED");
  assert.equal(__mapOverlayStatusCode("FINISHED"), "FINISHED");
  assert.equal(__mapOverlayStatusCode("NONE"), "NONE");
});

test("fallback de status usa deployment quando solicitado", () => {
  assert.equal(__mapOverlayStatusCode("NONE", { status: "FAILED" }, true), "FAILED");
  assert.equal(__mapOverlayStatusCode("NONE", { status: "CANCELED" }, true), "CANCELED");
  assert.equal(__mapOverlayStatusCode("NONE", { status: "SYNCING" }, true), "PENDING");
});

test("disembark confirmado vira finalizado", () => {
  assert.equal(
    __mapOverlayStatusCode("NONE", { status: "CONFIRMED", action: "DISEMBARK" }, true),
    "FINISHED",
  );
});
