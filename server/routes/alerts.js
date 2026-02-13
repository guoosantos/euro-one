import express from "express";

import { authenticate } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/permissions.js";
import { resolveClientId } from "../middleware/client.js";
import { listDevices } from "../models/device.js";
import { getVehicleById, listVehicles } from "../models/vehicle.js";
import { fetchEventsWithFallback } from "../services/traccar-db.js";
import { resolveEventConfiguration } from "../services/event-config.js";
import {
  addManualHandling,
  addVehicleManualHandling,
  handleAlert,
  listAlerts,
  listVehicleManualHandlings,
} from "../services/alerts.js";
import { getAccessibleVehicles } from "../services/accessible-vehicles.js";
import { getEffectiveVehicleIds } from "../utils/mirror-scope.js";
import { recordAuditEvent, resolveRequestIp } from "../services/audit-log.js";
import { getEventResolution } from "../models/resolved-event.js";

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

function resolveMirrorVehicleNotFoundMessage(req) {
  return req.mirrorContext?.ownerClientId ? "Veículo não encontrado para este espelhamento" : "Veículo não encontrado";
}

export function filterAlertsByVehicleAccess(alerts = [], allowedVehicleIds = null) {
  if (!allowedVehicleIds || allowedVehicleIds.size === 0) return alerts;
  return alerts.filter((alert) => alert?.vehicleId && allowedVehicleIds.has(String(alert.vehicleId)));
}

function buildManualHandlingAlert(entry, vehicle = null) {
  if (!entry) return null;
  const vehicleLabel = vehicle?.name || vehicle?.plate || entry?.vehicleLabel || null;
  const plate = vehicle?.plate || entry?.plate || null;
  const createdAt = entry?.createdAt || new Date().toISOString();
  const handlingEntry = {
    id: entry.id,
    type: "manual",
    createdAt,
    handledBy: entry?.handledBy ?? null,
    handledByName: entry?.handledByName ?? null,
    notes: entry?.notes ?? "",
    action: "",
    cause: "",
    isOk: null,
  };
  return {
    id: entry.id,
    eventId: entry?.eventId || entry.id,
    status: "handled",
    createdAt,
    handledAt: createdAt,
    handledBy: entry?.handledBy ?? null,
    handledByName: entry?.handledByName ?? null,
    handling: null,
    handlings: [handlingEntry],
    deviceId: null,
    vehicleId: entry?.vehicleId ?? null,
    vehicleLabel,
    plate,
    address: entry?.address ?? null,
    eventLabel: "Tratativa manual",
    severity: "Manual",
    category: "manual",
    requiresHandling: true,
    eventActive: true,
    active: true,
    normalizedEvent: {
      title: "Tratativa manual",
      severity: "Manual",
    },
  };
}

router.get(
  "/alerts",
  authorizePermission({
    menuKey: "primary",
    pageKey: "monitoring",
    subKey: "alerts",
  }),
  async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const access = await getAccessibleVehicles({
      user: req.user,
      clientId,
      includeMirrorsForNonReceivers: false,
      mirrorContext: req.mirrorContext,
    });
    const effectiveVehicleIds = getEffectiveVehicleIds(req);
    const allowedVehicleIds = new Set(
      effectiveVehicleIds ?? access.vehicles.map((vehicle) => String(vehicle.id)),
    );
    if (req.mirrorContext?.ownerClientId && allowedVehicleIds.size === 0) {
      return res.json({ data: [], total: 0 });
    }
    if (req.mirrorContext?.ownerClientId && req.query?.vehicleId) {
      const requested = String(req.query.vehicleId);
      if (!allowedVehicleIds.has(requested)) {
        return res.status(404).json({ message: resolveMirrorVehicleNotFoundMessage(req) });
      }
    }

    let alerts = listAlerts({
      clientId,
      status: req.query?.status,
      vehicleId: req.query?.vehicleId,
      deviceId: req.query?.deviceId,
      severity: req.query?.severity,
      category: req.query?.category,
      from: req.query?.from,
      to: req.query?.to,
    });
    if (req.mirrorContext?.ownerClientId) {
      alerts = filterAlertsByVehicleAccess(alerts, allowedVehicleIds);
    }
    const statusFilter = String(req.query?.status || "").trim().toLowerCase();
    const includeManual = !statusFilter || statusFilter === "handled";
    if (includeManual) {
      let manualEntries = listVehicleManualHandlings({
        clientId,
        vehicleId: req.query?.vehicleId,
        from: req.query?.from,
        to: req.query?.to,
      });
      if (req.mirrorContext?.ownerClientId) {
        manualEntries = manualEntries.filter((entry) =>
          entry?.vehicleId && allowedVehicleIds.has(String(entry.vehicleId)),
        );
      }
      if (manualEntries.length) {
        const vehicleCache = new Map();
        const manualAlerts = manualEntries
          .map((entry) => {
            const vehicleId = entry?.vehicleId;
            if (!vehicleId) return null;
            let vehicle = vehicleCache.get(String(vehicleId)) || null;
            if (vehicle === undefined) vehicle = null;
            if (!vehicle) {
              vehicle = getVehicleById(vehicleId);
              vehicleCache.set(String(vehicleId), vehicle || null);
            }
            return buildManualHandlingAlert(entry, vehicle);
          })
          .filter(Boolean);
        alerts = mergeById(manualAlerts, alerts);
      }
    }
    return res.json({ data: alerts, total: alerts.length });
  } catch (error) {
    return next(error);
  }
  },
);

router.patch("/alerts/:id/handle", async (req, res, next) => {
  try {
    const { id } = req.params;
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: false });
    if (req.mirrorContext?.ownerClientId) {
      const access = await getAccessibleVehicles({
        user: req.user,
        clientId,
        includeMirrorsForNonReceivers: false,
        mirrorContext: req.mirrorContext,
      });
      const effectiveVehicleIds = getEffectiveVehicleIds(req);
      const allowedVehicleIds = new Set(
        effectiveVehicleIds ?? access.vehicles.map((vehicle) => String(vehicle.id)),
      );
      const existing = listAlerts({ clientId }).find(
        (alert) => String(alert.id) === String(id) || String(alert.eventId) === String(id),
      );
      if (!existing) {
        return res.status(404).json({ message: "Alerta não encontrado" });
      }
      if (!existing?.vehicleId || !allowedVehicleIds.has(String(existing.vehicleId))) {
        return res.status(404).json({ message: resolveMirrorVehicleNotFoundMessage(req) });
      }
    }
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
    recordAuditEvent({
      clientId,
      vehicleId: alert.vehicleId || null,
      deviceId: alert.deviceId || null,
      category: "alert-handling",
      action: "TRATATIVA ALERTA",
      status: "Concluído",
      sentAt: new Date().toISOString(),
      user: { id: req.user?.id ?? null, name: req.user?.name || req.user?.email || null },
      ipAddress: resolveRequestIp(req),
      relatedId: alert.id || id,
      details: {
        handlingType: "mandatory",
        handlingNotes: payload.notes || null,
        handlingAction: payload.action || null,
        handlingCause: payload.cause || null,
        handlingAuthor: req.user?.name || req.user?.email || null,
        handlingAt: new Date().toISOString(),
      },
    });
    return res.json({ data: alert, ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/alerts/:id/handlings",
  authorizePermission({
    menuKey: "primary",
    pageKey: "monitoring",
    subKey: "alerts",
  }),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: false });
    if (req.mirrorContext?.ownerClientId) {
      const access = await getAccessibleVehicles({
        user: req.user,
        clientId,
        includeMirrorsForNonReceivers: false,
        mirrorContext: req.mirrorContext,
      });
      const effectiveVehicleIds = getEffectiveVehicleIds(req);
      const allowedVehicleIds = new Set(
        effectiveVehicleIds ?? access.vehicles.map((vehicle) => String(vehicle.id)),
      );
      const existing = listAlerts({ clientId }).find(
        (alert) => String(alert.id) === String(id) || String(alert.eventId) === String(id),
      );
      if (!existing) {
        return res.status(404).json({ message: "Alerta não encontrado" });
      }
      if (!existing?.vehicleId || !allowedVehicleIds.has(String(existing.vehicleId))) {
        return res.status(404).json({ message: resolveMirrorVehicleNotFoundMessage(req) });
      }
    }

    const payload = {
      notes: req.body?.notes || req.body?.handling || req.body?.comment || "",
    };

    const alert = addManualHandling({
      clientId,
      alertId: id,
      payload,
      handledBy: req.user?.id ?? null,
      handledByName: req.user?.name || req.user?.email || null,
    });
    if (!alert) {
      return res.status(404).json({ message: "Alerta não encontrado" });
    }

    recordAuditEvent({
      clientId,
      vehicleId: alert.vehicleId || null,
      deviceId: alert.deviceId || null,
      category: "alert-handling",
      action: "TRATATIVA MANUAL",
      status: "Concluído",
      sentAt: new Date().toISOString(),
      user: { id: req.user?.id ?? null, name: req.user?.name || req.user?.email || null },
      ipAddress: resolveRequestIp(req),
      relatedId: alert.id || id,
      details: {
        handlingType: "manual",
        handlingNotes: payload.notes || null,
        handlingAuthor: req.user?.name || req.user?.email || null,
        handlingAt: new Date().toISOString(),
      },
    });

    return res.json({ data: alert, ok: true });
  } catch (error) {
    return next(error);
  }
  },
);

router.post(
  "/alerts/manual",
  authorizePermission({
    menuKey: "primary",
    pageKey: "monitoring",
    subKey: "alerts",
  }),
  async (req, res, next) => {
  try {
    const vehicleId = req.body?.vehicleId || req.body?.vehicle?.id || null;
    if (!vehicleId) {
      return res.status(400).json({ message: "vehicleId é obrigatório" });
    }
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ message: "Veículo não encontrado" });
    }
    const clientId = resolveClientId(req, req.body?.clientId || req.query?.clientId, { required: false });
    const resolvedClientId = clientId || vehicle.clientId || null;
    if (clientId && vehicle.clientId && String(vehicle.clientId) !== String(clientId)) {
      return res.status(403).json({ message: "Veículo não pertence a este cliente" });
    }
    if (req.mirrorContext?.ownerClientId) {
      const access = await getAccessibleVehicles({
        user: req.user,
        clientId: resolvedClientId,
        includeMirrorsForNonReceivers: false,
        mirrorContext: req.mirrorContext,
      });
      const effectiveVehicleIds = getEffectiveVehicleIds(req);
      const allowedVehicleIds = new Set(
        effectiveVehicleIds ?? access.vehicles.map((item) => String(item.id)),
      );
      if (!allowedVehicleIds.has(String(vehicle.id))) {
        return res.status(404).json({ message: resolveMirrorVehicleNotFoundMessage(req) });
      }
    }

    const payload = {
      notes: req.body?.notes || req.body?.handling || req.body?.comment || "",
    };
    if (!String(payload.notes || "").trim()) {
      return res.status(400).json({ message: "Observação é obrigatória" });
    }
    const entry = addVehicleManualHandling({
      clientId: resolvedClientId,
      vehicleId: vehicle.id,
      eventId: req.body?.eventId ?? null,
      payload,
      handledBy: req.user?.id ?? null,
      handledByName: req.user?.name || req.user?.email || null,
      ipAddress: resolveRequestIp(req),
    });
    if (!entry) {
      return res.status(500).json({ message: "Falha ao registrar tratativa manual" });
    }

    recordAuditEvent({
      clientId: resolvedClientId,
      vehicleId: vehicle.id || null,
      deviceId: null,
      category: "alert-handling",
      action: "TRATATIVA MANUAL",
      status: "Concluído",
      sentAt: new Date().toISOString(),
      user: { id: req.user?.id ?? null, name: req.user?.name || req.user?.email || null },
      ipAddress: resolveRequestIp(req),
      relatedId: entry.id,
      details: {
        handlingType: "manual",
        handlingNotes: payload.notes || null,
        handlingAuthor: req.user?.name || req.user?.email || null,
        handlingAt: entry.createdAt || new Date().toISOString(),
        eventId: entry.eventId || null,
      },
    });

    return res.json({ data: entry, ok: true });
  } catch (error) {
    return next(error);
  }
  },
);

router.get(
  "/alerts/conjugated",
  authorizePermission({
    menuKey: "primary",
    pageKey: "monitoring",
    subKey: "alerts-conjugated",
  }),
  async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const windowHours = parsePositiveNumber(req.query?.windowHours, 5);
    const includeResolved = String(req.query?.includeResolved || "").toLowerCase() === "true";
    const limit = Math.min(2000, Math.floor(parsePositiveNumber(req.query?.limit, 500)));

    const access = await getAccessibleVehicles({
      user: req.user,
      clientId,
      includeMirrorsForNonReceivers: false,
      mirrorContext: req.mirrorContext,
    });
    const effectiveVehicleIds = getEffectiveVehicleIds(req);
    const allowedVehicleIds = new Set(
      effectiveVehicleIds ?? access.vehicles.map((vehicle) => String(vehicle.id)),
    );
    const allowedDeviceIds = req.mirrorContext?.deviceIds?.length
      ? new Set(req.mirrorContext.deviceIds.map(String))
      : null;
    let devices = listDevices({ clientId });
    if (access.mirrorOwnerIds.length) {
      const extraDevices = access.mirrorOwnerIds.flatMap((ownerId) => listDevices({ clientId: ownerId }));
      devices = mergeById(devices, extraDevices);
    }
    devices = devices.filter(
      (device) =>
        device?.vehicleId &&
        allowedVehicleIds.has(String(device.vehicleId)) &&
        (!allowedDeviceIds || allowedDeviceIds.has(String(device.id))),
    );
    const deviceByTraccarId = new Map(
      devices
        .filter((device) => device?.traccarId != null)
        .map((device) => [String(device.traccarId), device]),
    );
    const deviceIds = Array.from(deviceByTraccarId.keys());
    if (process.env.DEBUG_MIRROR === "true") {
      console.info("[alerts/conjugated] request", {
        clientIdReceived: req.query?.clientId ?? null,
        clientIdResolved: clientId ?? null,
        mirrorContext: req.mirrorContext
          ? { ownerClientId: req.mirrorContext.ownerClientId, vehicleIds: req.mirrorContext.vehicleIds || [] }
          : null,
        deviceCount: deviceIds.length,
      });
    }
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
        const resolution = getEventResolution(event.id, { clientId });
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
          resolved: Boolean(resolution),
          resolvedAt: resolution?.resolvedAt || null,
          resolvedBy: resolution?.resolvedBy || null,
          resolvedByName: resolution?.resolvedByName || null,
          resolvedNotes: resolution?.notes || null,
          eventTime: event.eventTime ?? event.serverTime ?? event.deviceTime ?? null,
          address: event.address ?? event?.attributes?.address ?? null,
          protocol,
        };
      })
      .filter((event) => {
        if (!event.active) return false;
        if (!includeResolved && event.resolved) return false;
        const normalized = String(event.severity || "").trim().toLowerCase();
        return ["grave", "critica", "crítica", "critical", "critico", "crítico"].includes(normalized);
      });

    return res.json({ data: filtered, total: filtered.length });
  } catch (error) {
    return next(error);
  }
  },
);

export default router;
