import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { resolveClientIdMiddleware } from "../middleware/resolve-client.js";
import { resolveClientId } from "../middleware/client.js";
import { listDevices, listDevicesFromDb } from "../models/device.js";
import {
  fetchEventsWithFallback,
  fetchPositions,
  fetchTrips,
  isTraccarDbConfigured,
} from "../services/traccar-db.js";
import { buildTraccarUnavailableError, traccarProxy } from "../services/traccar.js";
import { resolveEventConfiguration } from "../services/event-config.js";
import { getAccessibleVehicles } from "../services/accessible-vehicles.js";

const router = express.Router();

router.use(authenticate);

function ensureDbReady() {
  if (!isTraccarDbConfigured()) {
    throw buildTraccarUnavailableError(createError(503, "Banco do Traccar não configurado"), {
      stage: "db-config",
    });
  }
}

function parseDate(value, label) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createError(400, `Data inválida em ${label}`);
  }
  return parsed.toISOString();
}

function parseIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function extractEventCode(attributes = {}) {
  if (!attributes || typeof attributes !== "object") return null;
  const candidates = [attributes.event, attributes.eventCode, attributes.eventId, attributes.alarm];
  const resolved = candidates.find((value) => value !== undefined && value !== null && String(value).trim());
  return resolved !== undefined && resolved !== null ? String(resolved).trim() : null;
}

function applyEventConfigToPosition(position, clientId) {
  if (!position) return position;
  const attributes = position.attributes || {};
  const eventCode = extractEventCode(attributes);
  if (!eventCode) return position;
  const protocol = position.protocol || attributes.protocol || attributes.deviceProtocol || null;
  const resolved = resolveEventConfiguration({
    clientId,
    protocol,
    eventId: eventCode,
    payload: position,
    deviceId: position.deviceId ?? null,
  });
  if (!resolved) return position;
  return {
    ...position,
    eventLabel: resolved.label,
    eventSeverity: resolved.severity,
    eventActive: resolved.active,
    attributes: {
      ...attributes,
      eventLabel: resolved.label,
      eventSeverity: resolved.severity,
      eventActive: resolved.active,
    },
  };
}

function parsePlates(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

const normalisePlate = (plate) => String(plate || "")
  .trim()
  .toLowerCase()
  .replace(/[-\s]/g, "");

function resolveVehicleIdsFromPlates(plates, vehicles) {
  if (!plates.length) return [];
  const normalised = plates.map(normalisePlate).filter(Boolean);
  if (!normalised.length) return [];
  return vehicles
    .filter((vehicle) => normalised.includes(normalisePlate(vehicle?.plate)))
    .map((vehicle) => String(vehicle.id));
}

function dedupeDevices(devices = []) {
  const seen = new Set();
  const result = [];
  devices.forEach((device) => {
    if (!device?.traccarId) return;
    const key = String(device.traccarId);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(device);
  });
  return result;
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

async function resolveAccessibleContext(req, clientId) {
  const access = await getAccessibleVehicles({
    user: req.user,
    clientId,
    includeMirrorsForNonReceivers: false,
    mirrorContext: req.mirrorContext,
  });
  const vehicles = access.vehicles;
  const vehicleIds = new Set(vehicles.map((vehicle) => String(vehicle.id)));
  let devices = listDevices({ clientId });
  let persistedDevices = await listDevicesFromDb({ clientId });
  if (access.mirrorOwnerIds.length) {
    const extraDevices = access.mirrorOwnerIds.flatMap((ownerId) => listDevices({ clientId: ownerId }));
    const extraPersisted = await Promise.all(
      access.mirrorOwnerIds.map((ownerId) => listDevicesFromDb({ clientId: ownerId })),
    );
    devices = mergeById(devices, extraDevices);
    persistedDevices = mergeById(persistedDevices, extraPersisted.flat());
  }
  const combined = dedupeDevices([...devices, ...persistedDevices]);
  const filteredDevices = combined.filter(
    (device) => device?.vehicleId && vehicleIds.has(String(device.vehicleId)),
  );
  return { vehicles, devices: filteredDevices, access, clientId };
}

async function resolveAllowedDevices(devices, { vehicleIds = [], deviceIds = [] } = {}) {
  const combined = dedupeDevices(devices);

  const byVehicle = vehicleIds.length
    ? combined.filter((device) => device?.vehicleId && vehicleIds.includes(String(device.vehicleId)))
    : combined;

  const filteredByDeviceId = deviceIds.length
    ? byVehicle.filter((device) => deviceIds.includes(String(device.traccarId)))
    : byVehicle;

  const allowedIds = filteredByDeviceId.map((device) => String(device.traccarId));
  return { allowedDevices: filteredByDeviceId, allowedIds };
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

function normaliseTripPayload(trip, deviceId, device = null, vehicle = null) {
  if (!trip) return null;

  const startTime = trip.start?.time || null;
  const endTime = trip.end?.time || null;

  return {
    id: trip.id || `${deviceId}-${startTime || ""}-${endTime || ""}`,
    deviceId: deviceId != null ? String(deviceId) : null,
    deviceName: device?.name || device?.uniqueId || null,
    vehicleId: vehicle?.id || device?.vehicleId || null,
    vehiclePlate: vehicle?.plate || null,
    vehicleName: vehicle?.name || null,
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
    const { vehicles, devices } = await resolveAccessibleContext(req, clientId);
    const vehicleIds = parseIds(req.query.vehicleIds || req.query.vehicleId);
    const plateIds = resolveVehicleIdsFromPlates(parsePlates(req.query.plates || req.query.plate), vehicles);
    const resolvedVehicleIds = Array.from(new Set([...vehicleIds, ...plateIds]));
    const deviceIds = parseIds(req.query.deviceIds || req.query.deviceId).filter((value) => /^\d+$/.test(value));

    if (!resolvedVehicleIds.length && !deviceIds.length) {
      return res.status(400).json({
        data: null,
        error: {
          message: "Informe um veículo ou dispositivo para gerar o relatório de viagens.",
          code: "VEHICLE_REQUIRED",
        },
      });
    }

    const vehicleMap = new Map(vehicles.map((item) => [String(item.id), item]));
    const { allowedDevices, allowedIds } = await resolveAllowedDevices(devices, {
      vehicleIds: resolvedVehicleIds,
      deviceIds,
    });

    if (!allowedIds.length) {
      return res.json({
        data: { vehicleIds: resolvedVehicleIds, deviceIds: [], from: null, to: null, trips: [] },
        error: null,
      });
    }

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (!from || !to) {
      throw createError(400, "Período obrigatório: from e to");
    }

    const normalisedTrips = [];

    for (const device of allowedDevices) {
      const trips = await fetchTrips(device.traccarId, from, to);
      const mapped = trips
        .map((trip) => normaliseTripPayload(trip, device.traccarId, device, vehicleMap.get(String(device.vehicleId))))
        .filter(Boolean);
      normalisedTrips.push(...mapped);
    }

    res.json({
      data: {
        vehicleIds: resolvedVehicleIds,
        deviceIds: allowedIds,
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
    const { vehicles, devices } = await resolveAccessibleContext(req, clientId);
    const vehicleIds = parseIds(req.query.vehicleIds || req.query.vehicleId);
    const plateIds = resolveVehicleIdsFromPlates(parsePlates(req.query.plates || req.query.plate), vehicles);
    const resolvedVehicleIds = Array.from(new Set([...vehicleIds, ...plateIds]));
    const deviceIds = parseIds(req.query.deviceIds || req.query.deviceId).filter((value) => /^\d+$/.test(value));

    if (!resolvedVehicleIds.length && !deviceIds.length) {
      return res.status(400).json({
        data: null,
        error: { message: "Informe um veículo para gerar o relatório de rotas.", code: "VEHICLE_REQUIRED" },
      });
    }

    const { allowedIds } = await resolveAllowedDevices(devices, { vehicleIds: resolvedVehicleIds, deviceIds });

    if (!allowedIds.length) {
      return res.json({ data: { vehicleIds: resolvedVehicleIds, deviceIds: [], from: null, to: null, positions: [] }, error: null });
    }

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (!from || !to) {
      throw createError(400, "Período obrigatório: from e to");
    }

    const positions = await fetchPositions(allowedIds, from, to);
    if (positions.length) {
      const enrichedPositions = positions.map((position) => applyEventConfigToPosition(position, clientId));
      return res.json({ data: { vehicleIds: resolvedVehicleIds, deviceIds: allowedIds, from, to, positions: enrichedPositions }, error: null });
    }

    // fallback para API HTTP do Traccar se não houver dados no banco
    const response = await requestTraccarReport("/reports/route", { deviceId: allowedIds[0], from, to });
    const payload = Array.isArray(response?.data) ? response.data : response?.data?.data || response?.data || [];
    const enrichedPayload = (payload || []).map((position) => applyEventConfigToPosition(position, clientId));
    return res.json({ data: { vehicleIds: resolvedVehicleIds, deviceIds: allowedIds, from, to, positions: enrichedPayload }, error: null });
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
    const { vehicles, devices } = await resolveAccessibleContext(req, clientId);
    const vehicleIds = parseIds(req.query.vehicleIds || req.query.vehicleId);
    const plateIds = resolveVehicleIdsFromPlates(parsePlates(req.query.plates || req.query.plate), vehicles);
    const resolvedVehicleIds = Array.from(new Set([...vehicleIds, ...plateIds]));
    const deviceIds = parseIds(req.query.deviceIds || req.query.deviceId).filter((value) => /^\d+$/.test(value));

    if (!resolvedVehicleIds.length && !deviceIds.length) {
      return res.status(400).json({
        data: null,
        error: { message: "Informe um veículo para gerar o relatório de paradas.", code: "VEHICLE_REQUIRED" },
      });
    }

    const { allowedIds } = await resolveAllowedDevices(devices, { vehicleIds: resolvedVehicleIds, deviceIds });

    if (!allowedIds.length) {
      return res.json({ data: { vehicleIds: resolvedVehicleIds, deviceIds: [], from: null, to: null, stops: [] }, error: null });
    }

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (!from || !to) {
      throw createError(400, "Período obrigatório: from e to");
    }

    const aggregatedStops = [];
    for (const deviceId of allowedIds) {
      const response = await requestTraccarReport("/reports/stops", { deviceId, from, to });
      const payload = Array.isArray(response?.data) ? response.data : response?.data?.data || response?.data || [];
      aggregatedStops.push(...payload);
    }

    return res.json({ data: { vehicleIds: resolvedVehicleIds, deviceIds: allowedIds, from, to, stops: aggregatedStops }, error: null });
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
    const { vehicles, devices } = await resolveAccessibleContext(req, clientId);
    const vehicleIds = parseIds(req.query.vehicleIds || req.query.vehicleId);
    const plateIds = resolveVehicleIdsFromPlates(parsePlates(req.query.plates || req.query.plate), vehicles);
    const resolvedVehicleIds = Array.from(new Set([...vehicleIds, ...plateIds]));
    const deviceIds = parseIds(req.query.deviceIds || req.query.deviceId).filter((value) => /^\d+$/.test(value));

    if (!resolvedVehicleIds.length && !deviceIds.length) {
      return res.status(400).json({
        data: null,
        error: { message: "Informe um veículo para gerar o relatório de resumo.", code: "VEHICLE_REQUIRED" },
      });
    }

    const { allowedIds } = await resolveAllowedDevices(devices, { vehicleIds: resolvedVehicleIds, deviceIds });

    if (!allowedIds.length) {
      return res.json({ data: { vehicleIds: resolvedVehicleIds, deviceIds: [], from: null, to: null, summary: [] }, error: null });
    }

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (!from || !to) {
      throw createError(400, "Período obrigatório: from e to");
    }

    const aggregatedSummary = [];
    for (const deviceId of allowedIds) {
      const response = await requestTraccarReport("/reports/summary", { deviceId, from, to });
      const payload = Array.isArray(response?.data) ? response.data : response?.data?.data || response?.data || [];
      aggregatedSummary.push(...payload);
    }

    return res.json({ data: { vehicleIds: resolvedVehicleIds, deviceIds: allowedIds, from, to, summary: aggregatedSummary }, error: null });
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

    const { vehicles, devices } = await resolveAccessibleContext(req, clientId);
    const requestedVehicles = Array.isArray(req.query.vehicleIds)
      ? req.query.vehicleIds
      : typeof req.query.vehicleIds === "string"
      ? req.query.vehicleIds.split(",")
      : req.query.vehicleId
      ? [req.query.vehicleId]
      : [];
    const plateVehicles = resolveVehicleIdsFromPlates(parsePlates(req.query.plates || req.query.plate), vehicles);

    const deviceIds = requestedDevices
      .map((value) => String(value).trim())
      .filter(Boolean)
      .filter((value) => /^\d+$/.test(value));

    const vehicleIds = Array.from(
      new Set([...requestedVehicles.map((value) => String(value).trim()).filter(Boolean), ...plateVehicles]),
    );

    const filteredByVehicle = vehicleIds.length
      ? devices.filter((device) => device?.vehicleId && vehicleIds.includes(String(device.vehicleId)))
      : devices;

    const allowedIds = filteredByVehicle.map((device) => String(device.traccarId));

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    const limit = Number(req.query.limit) || 50;

    const deviceIdsToQuery = deviceIds.length ? deviceIds.filter((id) => allowedIds.includes(id)) : allowedIds;

    console.info("[traccar/events] request", {
      clientIdReceived: req.query?.clientId ?? null,
      clientIdResolved: clientId ?? null,
      mirrorContext: req.mirrorContext
        ? { ownerClientId: req.mirrorContext.ownerClientId, vehicleIds: req.mirrorContext.vehicleIds || [] }
        : null,
      vehicleIds,
      deviceIdsToQuery,
    });

    if (!deviceIdsToQuery.length) {
      return res.json({ data: { vehicleIds, deviceIds: [], from, to, events: [] }, error: null });
    }

    const events = await fetchEventsWithFallback(deviceIdsToQuery, from, to, limit);
    res.json({
      data: { vehicleIds, deviceIds: deviceIdsToQuery, from, to, events },
      error: null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
