import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { addManualHandling, listAlerts, upsertAlertFromEvent } from "../services/alerts.js";

describe("alert handlings", () => {
  it("stores manual handling entries", () => {
    const clientId = `client-${randomUUID()}`;
    const created = upsertAlertFromEvent({
      clientId,
      event: { id: `event-${randomUUID()}`, eventTime: new Date().toISOString() },
      configuredEvent: { requiresHandling: true },
    });

    assert.ok(created, "alert should be created");

    const updated = addManualHandling({
      clientId,
      alertId: created.id,
      payload: { notes: "Teste de tratativa manual" },
      handledByName: "Tester",
    });

    assert.ok(updated, "alert should be updated");
    const manualEntries = Array.isArray(updated.handlings)
      ? updated.handlings.filter((entry) => entry?.type === "manual")
      : [];
    assert.equal(manualEntries.length, 1);
    assert.equal(manualEntries[0].notes, "Teste de tratativa manual");

    const list = listAlerts({ clientId });
    assert.equal(list.length, 1);
    assert.equal(list[0].handlings?.[0]?.type, "manual");
  });
});
