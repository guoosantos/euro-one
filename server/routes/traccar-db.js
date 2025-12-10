import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { resolveClientIdMiddleware } from "../middleware/resolve-client.js";
import { resolveClientId } from "../middleware/client.js";
import { findDeviceByTraccarIdInDb, listDevices } from "../models/device.js";
import { fetchEvents, fetchTrips, isTraccarDbConfigured } from "../services/traccar-db.js";
import { buildTraccarUnavailableError } from "../services/traccar.js";

const router = express.Router();

router.use(authenticate);

function ensureDbReady() {
  if (!isTraccarDbConfigured()) {
    throw buildTraccarUnavailableError(createError(503, "Banco do Traccar não configurado"), {
      stage: "db-config",
    });
  }
}

async function ensureDeviceAllowed(deviceId, clientId) {
  const devices = listDevices({ clientId });
  const match = devices.find((item) => item.traccarId && String(item.traccarId) === String(deviceId));
  if (match) return match;

  const dbRecord = await findDeviceByTraccarIdInDb(deviceId, { clientId });
  if (dbRecord) return dbRecord;

  throw createError(404, "Dispositivo não encontrado para este cliente");
}

function parseDate(value, label) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createError(400, `Data inválida em ${label}`);
  }
  return parsed.toISOString();
}

function normaliseTripPayload(trip, deviceId, device = null) {
  if (!trip) return null;

  const startTime = trip.start?.time || null;
  const endTime = trip.end?.time || null;

  return {
    id: trip.id || `${deviceId}-${startTime || ""}-${endTime || ""}`,
    deviceId: deviceId != null ? String(deviceId) : null,
    deviceName: device?.name || device?.uniqueId || null,
    distance: Number.isFinite(trip.distanceKm) ? trip.distanceKm * 1000 : null,
    averageSpeed: trip.averageSpeedKmh ?? null,
    maxSpeed: trip.maxSpeedKmh ?? null,
    startOdometer: trip.start?.attributes?.totalDistance ?? null,
    endOdometer: trip.end?.attributes?.totalDistance ?? null,
    startTime,
    endTime,
    startPositionId: trip.start?.id ?? null,
    endPositionId: trip.end?.id ?? null,
    startLat: trip.start?.latitude ?? null,
    startLon: trip.start?.longitude ?? null,
    endLat: trip.end?.latitude ?? null,
    endLon: trip.end?.longitude ?? null,
    startAddress: trip.start?.address || null,
    endAddress: trip.end?.address || null,
    duration: Number.isFinite(trip.durationMinutes) ? Math.round(trip.durationMinutes * 60) : null,
  };
}

/**
 * Relatórios de viagens (Trips) – fonte: banco do Traccar
 */
router.get("/traccar/reports/trips", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    ensureDbReady();

    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const deviceId = req.query.deviceId;
    if (!deviceId) {
      throw createError(400, "deviceId é obrigatório");
    }

    const device = await ensureDeviceAllowed(deviceId, clientId);

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (!from || !to) {
      throw createError(400, "Período obrigatório: from e to");
    }

    const trips = await fetchTrips(deviceId, from, to);
    const normalisedTrips = trips
      .map((trip) => normaliseTripPayload(trip, deviceId, device))
      .filter(Boolean);

    res.json({
      data: {
        deviceId: String(deviceId),
        from,
        to,
        trips: normalisedTrips,
      },
      error: null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Eventos – continuam usando o serviço baseado no banco do Traccar
 */
router.get("/traccar/events", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    ensureDbReady();
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const requestedDevices = Array.isArray(req.query.deviceIds)
      ? req.query.deviceIds
      : typeof req.query.deviceIds === "string"
      ? req.query.deviceIds.split(",")
      : req.query.deviceId
      ? [req.query.deviceId]
      : [];

    const deviceIds = requestedDevices
      .map((value) => String(value).trim())
      .filter(Boolean)
      .filter((value) => /^\d+$/.test(value));

    const allowedDevices = listDevices({ clientId });
    const allowedIds = allowedDevices
      .map((device) => (device?.traccarId != null ? String(device.traccarId) : null))
      .filter(Boolean);

    const deviceIdsToQuery = deviceIds.length ? deviceIds.filter((id) => allowedIds.includes(id)) : allowedIds;

    if (!deviceIdsToQuery.length) {
      throw createError(404, "Dispositivo não encontrado para este cliente");
    }

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    const limit = Number(req.query.limit) || 50;

    const events = await fetchEvents(deviceIdsToQuery, from, to, limit);
    res.json({
      data: { deviceIds: deviceIdsToQuery, from, to, events },
      error: null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
