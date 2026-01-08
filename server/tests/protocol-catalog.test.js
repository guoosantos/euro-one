import assert from "node:assert/strict";
import test from "node:test";
import iotmEventCatalog from "../../shared/iotmEventCatalog.pt-BR.json" with { type: "json" };
import { getProtocolEvents } from "../services/protocol-catalog.js";

test("getProtocolEvents inclui todos os ids do catálogo IOTM", () => {
  const events = getProtocolEvents("iotm") || [];
  assert.ok(events.length);
  const ids = new Set(events.map((event) => String(event?.id)));
  const missing = (iotmEventCatalog || []).filter((event) => !ids.has(String(event?.id)));
  assert.equal(missing.length, 0);
});
