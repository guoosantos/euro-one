import assert from "node:assert/strict";
import test from "node:test";
import iotmEventCatalog from "../../shared/iotmEventCatalog.pt-BR.json" with { type: "json" };
import diagnosticCatalog from "../../shared/deviceDiagnosticEvents.pt-BR.json" with { type: "json" };
import { getProtocolEvents } from "../services/protocol-catalog.js";

test("getProtocolEvents inclui todos os ids do catálogo IOTM", () => {
  const events = getProtocolEvents("iotm") || [];
  assert.ok(events.length);
  const ids = new Set(events.map((event) => String(event?.id)));
  const missing = (iotmEventCatalog || []).filter((event) => !ids.has(String(event?.id)));
  assert.equal(missing.length, 0);
});

test("getProtocolEvents inclui eventos diagnósticos e supera os 69 eventos", () => {
  const events = getProtocolEvents("iotm") || [];
  assert.ok(events.length > 69);

  const ids = new Set(events.map((event) => String(event?.id)));
  const diagnosticEntry = diagnosticCatalog?.events?.[0];
  assert.ok(diagnosticEntry?.key);
  assert.ok(ids.has(String(diagnosticEntry.key)));
});
