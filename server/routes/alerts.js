import express from "express";

import { authenticate } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { listDevices } from "../models/device.js";
import { listVehicles } from "../models/vehicle.js";
import { fetchEventsWithFallback } from "../services/traccar-db.js";
import { resolveEventConfiguration } from "../services/event-config.js";
import { handleAlert, listAlerts } from "../services/alerts.js";
import { getAccessibleVehicles } from "../services/accessible-vehicles.js";

const router = express.Router();

router.use(authenticate);

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function mergeById(primary = [], secondary = []) {
  const map = new Map(primary.map((item) => [String(item.id), item]));
  secondary.forEach((item) => {
    const key = String(item.id);
    if (!map.has(key)) {
      map.set(key, item);
    }
  });
  return Array.from(map.values());
}

function resolveEventIdFromPayload(event) {
  const attributes = event?.attributes || {};
  return (
    attributes?.event ||
    attributes?.eventCode ||
    attributes?.eventId ||
    attributes?.alarm ||
    event?.event ||
    event?.type ||
    attributes?.type ||
    null
  );
}

router.get("/alerts", (req, res) => {
  const clientId = resolveClientId(req, req.query?.clientId, { required: false });
  const alerts = listAlerts({
    clientId,
    status: req.query?.status,
    vehicleId: req.query?.vehicleId,
    deviceId: req.query?.deviceId,
    severity: req.query?.severity,
    category: req.query?.category,
    from: req.query?.from,
    to: req.query?.to,
  });
  return res.json({ data: alerts, total: alerts.length });
});

router.patch("/alerts/:id/handle", (req, res) => {
  const { id } = req.params;
  const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: false });
  const payload = {
    isOk: req.body?.isOk,
    action: req.body?.action,
    cause: req.body?.cause,
    notes: req.body?.notes,
  };

  const alert = handleAlert({
    clientId,
    alertId: id,
    payload,
    handledBy: req.user?.id ?? null,
    handledByName: req.user?.name || req.user?.email || null,
  });
  if (!alert) {
    return res.status(404).json({ message: "Alerta não encontrado" });
  }
  return res.json({ data: alert, ok: true });
});

router.get("/alerts/conjugated", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const windowHours = parsePositiveNumber(req.query?.windowHours, 5);
    const limit = Math.min(2000, Math.floor(parsePositiveNumber(req.query?.limit, 500)));

    const access = await getAccessibleVehicles({
      user: req.user,
      clientId,
      includeMirrorsForNonReceivers: false,
      mirrorContext: req.mirrorContext,
    });
    const allowedVehicleIds = new Set(access.vehicles.map((vehicle) => String(vehicle.id)));
    let devices = listDevices({ clientId });
    if (access.mirrorOwnerIds.length) {
      const extraDevices = access.mirrorOwnerIds.flatMap((ownerId) => listDevices({ clientId: ownerId }));
      devices = mergeById(devices, extraDevices);
    }
    devices = devices.filter((device) => device?.vehicleId && allowedVehicleIds.has(String(device.vehicleId)));
    const deviceByTraccarId = new Map(
      devices
        .filter((device) => device?.traccarId != null)
        .map((device) => [String(device.traccarId), device]),
    );
    const deviceIds = Array.from(deviceByTraccarId.keys());
    console.info("[alerts/conjugated] request", {
      clientIdReceived: req.query?.clientId ?? null,
      clientIdResolved: clientId ?? null,
      mirrorContext: req.mirrorContext
        ? { ownerClientId: req.mirrorContext.ownerClientId, vehicleIds: req.mirrorContext.vehicleIds || [] }
        : null,
      deviceCount: deviceIds.length,
    });
    if (!deviceIds.length) {
      return res.json({ data: [], total: 0 });
    }

    const now = new Date();
    const from = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();

    const events = await fetchEventsWithFallback(deviceIds, from, to, limit);
    const vehicles = access.vehicles.length ? access.vehicles : listVehicles({ clientId });
    const vehicleById = new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle]));

    const filtered = events
      .map((event) => {
        const eventId = resolveEventIdFromPayload(event);
        const device = deviceByTraccarId.get(String(event.deviceId));
        const vehicleId = device?.vehicleId ?? null;
        const vehicle = vehicleId ? vehicleById.get(String(vehicleId)) : null;
        const protocol = event?.protocol || event?.attributes?.protocol || device?.protocol || null;
        const configuredEvent = eventId
          ? resolveEventConfiguration({
              clientId,
              protocol,
              eventId,
              payload: event,
              deviceId: event?.deviceId ?? null,
            })
          : null;
        const severity = configuredEvent?.severity || event?.severity || event?.attributes?.severity || null;
        const active = configuredEvent?.active ?? true;
        return {
          id: event.id,
          eventId: eventId || event.id,
          deviceId: event.deviceId,
          vehicleId,
          plate: vehicle?.plate ?? null,
          vehicleLabel: vehicle?.name ?? vehicle?.plate ?? null,
          eventLabel: configuredEvent?.label || event?.type || event?.event || null,
          severity,
          active,
          eventTime: event.eventTime ?? event.serverTime ?? event.deviceTime ?? null,
          address: event.address ?? event?.attributes?.address ?? null,
          protocol,
        };
      })
      .filter((event) => {
        if (!event.active) return false;
        const normalized = String(event.severity || "").trim().toLowerCase();
        return ["grave", "critica", "crítica", "critical", "critico", "crítico"].includes(normalized);
      });

    return res.json({ data: filtered, total: filtered.length });
  } catch (error) {
    return next(error);
  }
});

export default router;
