import assert from "node:assert/strict";
import express from "express";
import { afterEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import alertRoutes from "../routes/alerts.js";
import { errorHandler } from "../middleware/error-handler.js";
import { signSession } from "../middleware/auth.js";
import { markEventResolved } from "../models/resolved-event.js";
import { handleAlert, upsertAlertFromEvent } from "../services/alerts.js";
import { saveCollection } from "../services/storage.js";
import { requestApp } from "./app-request.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", alertRoutes);
  app.use(errorHandler);
  return app;
}

afterEach(() => {
  saveCollection("vehicle-alerts", {});
  saveCollection("resolved-events", []);
  saveCollection("vehicle-manual-handlings", {});
});

describe("/api/events/handlings", () => {
  it("retorna tratativas de alerta e de alertas conjugados", async () => {
    const clientId = `client-${randomUUID()}`;
    const alert = upsertAlertFromEvent({
      clientId,
      event: {
        id: `evt-${randomUUID()}`,
        eventTime: new Date().toISOString(),
        eventLabel: "Jammer",
        eventSeverity: "high",
      },
      configuredEvent: { requiresHandling: true, active: true },
      vehicleId: `vehicle-${randomUUID()}`,
      deviceId: `device-${randomUUID()}`,
      vehicleLabel: "Veículo Teste",
    });
    assert.ok(alert, "alerta deve ser criado");

    const handled = handleAlert({
      clientId,
      alertId: alert.id,
      payload: { notes: "Tratativa do alerta", action: "Contato com motorista" },
      handledBy: "user-1",
      handledByName: "Operador",
    });
    assert.ok(handled, "alerta deve ser tratado");

    markEventResolved(`conj-${randomUUID()}`, {
      clientId,
      notes: "Tratativa conjugada",
      resolvedBy: "user-1",
      resolvedByName: "Operador",
      vehicleId: handled.vehicleId,
      eventLabel: "Evento crítico",
      eventType: "critical",
      eventTime: new Date().toISOString(),
    });

    const token = signSession({ id: "user-1", role: "admin", clientId });
    const response = await requestApp(buildApp(), {
      url: `/api/events/handlings?clientId=${encodeURIComponent(clientId)}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(payload.data));
    assert.ok(payload.data.some((entry) => entry.source === "alert"));
    assert.ok(payload.data.some((entry) => entry.source === "conjugated"));
  });
});

