import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { resolveClientIdMiddleware } from "../middleware/resolve-client.js";
import { resolveClientId } from "../middleware/client.js";
import { findDeviceByTraccarIdInDb, listDevices, listDevicesFromDb } from "../models/device.js";
import {
  fetchEventsWithFallback,
  fetchPositions,
  fetchTrips,
  isTraccarDbConfigured,
} from "../services/traccar-db.js";
import { buildTraccarUnavailableError, traccarProxy } from "../services/traccar.js";

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

async function requestTraccarReport(path, params) {
  const accept = "application/json";
  try {
    return await traccarProxy("get", path, { params, asAdmin: true, context: { headers: { Accept: accept } } });
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status);
    const shouldFallback = status === 404 || status === 405 || status === 415;
    if (!shouldFallback) throw error;
    return traccarProxy("post", path, {
      data: params,
      asAdmin: true,
      context: { headers: { Accept: accept } },
    });
  }
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
      return res.status(400).json({
        data: null,
        error: {
          message: "Informe um dispositivo para gerar o relatório de viagens.",
          code: "DEVICE_REQUIRED",
        },
      });
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
 * Rotas (Route) – fonte: banco do Traccar, com fallback para API HTTP
 */
router.get("/traccar/reports/route", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    ensureDbReady();

    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const deviceId = req.query.deviceId;
    if (!deviceId) {
      return res.status(400).json({
        data: null,
        error: { message: "Informe um dispositivo para gerar o relatório de rotas.", code: "DEVICE_REQUIRED" },
      });
    }

    await ensureDeviceAllowed(deviceId, clientId);

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (!from || !to) {
      throw createError(400, "Período obrigatório: from e to");
    }

    const positions = await fetchPositions([deviceId], from, to);
    if (positions.length) {
      return res.json({ data: { deviceId: String(deviceId), from, to, positions }, error: null });
    }

    // fallback para API HTTP do Traccar se não houver dados no banco
    const response = await requestTraccarReport("/reports/route", { deviceId, from, to });
    const payload = Array.isArray(response?.data) ? response.data : response?.data?.data || response?.data || [];
    return res.json({ data: { deviceId: String(deviceId), from, to, positions: payload }, error: null });
  } catch (error) {
    next(error);
  }
});

/**
 * Paradas (Stops) – prioridade DB, fallback HTTP
 */
router.get("/traccar/reports/stops", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    ensureDbReady();

    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const deviceId = req.query.deviceId;
    if (!deviceId) {
      return res.status(400).json({
        data: null,
        error: { message: "Informe um dispositivo para gerar o relatório de paradas.", code: "DEVICE_REQUIRED" },
      });
    }

    await ensureDeviceAllowed(deviceId, clientId);

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (!from || !to) {
      throw createError(400, "Período obrigatório: from e to");
    }

    const response = await requestTraccarReport("/reports/stops", { deviceId, from, to });
    const payload = Array.isArray(response?.data) ? response.data : response?.data?.data || response?.data || [];
    return res.json({ data: { deviceId: String(deviceId), from, to, stops: payload }, error: null });
  } catch (error) {
    next(error);
  }
});

/**
 * Resumo (Summary) – prioridade DB, fallback HTTP
 */
router.get("/traccar/reports/summary", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    ensureDbReady();

    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const deviceId = req.query.deviceId;
    if (!deviceId) {
      return res.status(400).json({
        data: null,
        error: { message: "Informe um dispositivo para gerar o relatório de resumo.", code: "DEVICE_REQUIRED" },
      });
    }

    await ensureDeviceAllowed(deviceId, clientId);

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (!from || !to) {
      throw createError(400, "Período obrigatório: from e to");
    }

    const response = await requestTraccarReport("/reports/summary", { deviceId, from, to });
    const payload = Array.isArray(response?.data) ? response.data : response?.data?.data || response?.data || [];
    return res.json({ data: { deviceId: String(deviceId), from, to, summary: payload }, error: null });
  } catch (error) {
    next(error);
  }
});

/**
 * Eventos – prioriza banco do Traccar com fallback via API HTTP quando necessário
 */
router.get("/traccar/events", resolveClientIdMiddleware, async (req, res, next) => {
  try {
    const dbConfigured = isTraccarDbConfigured();
    if (dbConfigured) {
      ensureDbReady();
    }
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

    const storedDevices = listDevices({ clientId });
    const persistedDevices = await listDevicesFromDb({ clientId });

    const allowedDevices = [...storedDevices, ...persistedDevices].reduce((list, device) => {
      if (!device?.traccarId) return list;
      const traccarId = String(device.traccarId);
      if (!list.some((item) => String(item.traccarId) === traccarId)) {
        list.push(device);
      }
      return list;
    }, []);

    const allowedIds = allowedDevices.map((device) => String(device.traccarId));

    const deviceIdsToQuery = deviceIds.length ? deviceIds.filter((id) => allowedIds.includes(id)) : allowedIds;

    if (!deviceIdsToQuery.length) {
      throw createError(404, "Dispositivo não encontrado para este cliente");
    }

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    const limit = Number(req.query.limit) || 50;

    const events = await fetchEventsWithFallback(deviceIdsToQuery, from, to, limit);
    res.json({
      data: { deviceIds: deviceIdsToQuery, from, to, events },
      error: null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
