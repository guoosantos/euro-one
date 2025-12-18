// server/routes/proxy.js
import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { resolveClientId } from "../middleware/client.js";
import { getDeviceById, listDevices } from "../models/device.js";
import { buildTraccarUnavailableError, traccarProxy, traccarRequest } from "../services/traccar.js";
import { getGroupIdsForGeofence } from "../models/geofence-group.js";
import {
  fetchDevicesMetadata,
  fetchEventsWithFallback,
  fetchLatestPositions,
  fetchLatestPositionsWithFallback,
  fetchPositions,
  fetchPositionsByIds,
  fetchTrips,
} from "../services/traccar-db.js";
import {
  enforceClientGroupInQuery,
  enforceDeviceFilterInBody,
  enforceDeviceFilterInQuery,
  extractDeviceIds,
  normalizeReportDeviceIds,
  resolveClientGroupId,
  resolveAllowedDeviceIds,
  normaliseJsonList,
} from "../utils/report-helpers.js";
import { enrichPositionsWithAddresses, formatAddress, resolveShortAddress } from "../utils/address.js";
import { stringifyCsv } from "../utils/csv.js";
import { computeRouteSummary, computeTripMetrics } from "../utils/report-metrics.js";
import { createTtlCache } from "../utils/ttl-cache.js";

const router = express.Router();
router.use(authenticate);

function enforceClientGroupInBody(req, target = req.body) {
  const groupId = resolveClientGroupId(req);
  if (!groupId) return;

  const body = target || (req.body = {});
  if (body.groupId === undefined && body.groupIds === undefined) {
    body.groupId = groupId;
  }
}

function resolveTraccarDeviceId(req, allowed = null) {
  const requested = extractDeviceIds(req.body);
  if (!requested.length) return null;

  const allowedIds = allowed ?? resolveAllowedDeviceIds(req);
  const first = String(requested[0]);

  if (/^\d+$/.test(first) && (!allowedIds || allowedIds.includes(first))) {
    return first;
  }

  const direct = getDeviceById(first);
  const devices = direct ? [direct] : listDevices({});
  const match = devices.find((device) =>
    [device?.traccarId, device?.id, device?.uniqueId].some((value) => value && String(value) === first),
  );

  if (!match?.traccarId) {
    throw createError(404, "Equipamento não encontrado");
  }

  if (allowedIds && !allowedIds.includes(String(match.traccarId))) {
    throw createError(403, "Dispositivo não autorizado para este cliente");
  }

  return String(match.traccarId);
}

const TRIP_CSV_COLUMNS = [
  { key: "device", label: "Dispositivo" },
  { key: "startTime", label: "Início" },
  { key: "endTime", label: "Fim" },
  { key: "durationSeconds", label: "Duração (s)" },
  { key: "distanceMeters", label: "Distância (m)" },
  { key: "averageSpeedKmH", label: "Velocidade média (km/h)" },
  { key: "maxSpeedKmH", label: "Velocidade máxima (km/h)" },
  { key: "startAddress", label: "Endereço inicial" },
  { key: "endAddress", label: "Endereço final" },
  { key: "startLat", label: "Lat. inicial" },
  { key: "startLon", label: "Lon. inicial" },
  { key: "endLat", label: "Lat. final" },
  { key: "endLon", label: "Lon. final" },
];

// Estas rotas usam o banco do Traccar como fonte principal de dados (cenário C).
// A API HTTP do Traccar é usada apenas em endpoints específicos (ex.: comandos para o rastreador), não nestas rotas.

const TRACCAR_DB_ERROR_PAYLOAD = {
  data: null,
  error: {
    message: "Serviço de telemetria indisponível no momento. Tente novamente em instantes.",
    code: "TRACCAR_DB_ERROR",
  },
};

function respondBadRequest(res, message = "Parâmetros inválidos.") {
  return res.status(400).json({
    data: null,
    error: { message, code: "BAD_REQUEST" },
  });
}

function respondDeviceNotFound(res) {
  return res.status(404).json({
    data: null,
    error: { message: "Dispositivo não encontrado para este cliente.", code: "DEVICE_NOT_FOUND" },
  });
}

function extractBatteryLevel(attributes = {}) {
  if (!attributes || typeof attributes !== "object") return null;
  const batteryKeys = ["batteryLevel", "battery", "batteryPercent", "battery_percentage", "bateria"];
  for (const key of batteryKeys) {
    if (attributes[key] === undefined || attributes[key] === null) continue;
    const numeric = Number(attributes[key]);
    return Number.isFinite(numeric) ? numeric : attributes[key];
  }
  return null;
}

function extractIgnition(attributes = {}) {
  if (!attributes || typeof attributes !== "object") return null;
  const raw =
    attributes.ignition ?? attributes.Ignition ?? attributes.ign ?? attributes.keyIgnition ?? attributes["Ignition"];
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    return ["true", "1", "on", "yes"].includes(normalized);
  }
  return null;
}

function normalisePosition(position) {
  if (!position) return null;
  const attributes = position.attributes || {};
  const fixTime = position.fixTime || position.deviceTime || position.serverTime || null;
  return {
    deviceId: position.deviceId != null ? String(position.deviceId) : null,
    latitude: position.latitude ?? null,
    longitude: position.longitude ?? null,
    speed: position.speed ?? null,
    course: position.course ?? null,
    timestamp: fixTime || position.serverTime || position.deviceTime || null,
    fixTime: position.fixTime || null,
    deviceTime: position.deviceTime || null,
    serverTime: position.serverTime || null,
    address: position.address || "Endereço não disponível",
    attributes,
    batteryLevel: extractBatteryLevel(attributes),
    ignition: extractIgnition(attributes),
  };
}

function parseDeviceIds(raw) {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
    ? raw.split(",")
    : raw != null
    ? [raw]
    : [];

  return values
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function parseDateOrThrow(value, label) {
  if (!value) {
    throw createError(400, `${label} é obrigatório`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createError(400, `Data inválida em ${label}`);
  }
  return parsed.toISOString();
}

function resolveDeviceIdsToQuery(req) {
  const clientId = resolveClientId(req, req.query?.clientId, { required: false });
  const devices = listDevices({ clientId });
  const allowedDeviceIds = devices
    .map((device) => (device?.traccarId != null ? String(device.traccarId) : null))
    .filter(Boolean);

  const filteredDeviceIds = parseDeviceIds(req.query?.deviceId || req.query?.deviceIds);
  if (filteredDeviceIds.some((value) => !/^\d+$/.test(value))) {
    throw createError(400, "Parâmetros inválidos.");
  }

  const deviceIdsToQuery = filteredDeviceIds.length
    ? filteredDeviceIds.filter((id) => allowedDeviceIds.includes(id))
    : allowedDeviceIds;

  if (filteredDeviceIds.length && deviceIdsToQuery.length === 0) {
    throw createError(404, "Dispositivo não encontrado para este cliente.");
  }

  return { clientId, deviceIdsToQuery };
}

function buildDeviceLookup(clientDevices = [], metadata = []) {
  const metadataById = new Map((metadata || []).map((item) => [String(item.id), item]));
  const devicesByTraccarId = new Map(
    (clientDevices || [])
      .filter((device) => device?.traccarId != null)
      .map((device) => [String(device.traccarId), device]),
  );
  return { metadataById, devicesByTraccarId };
}

function buildDeviceInfo(device, metadata, fallbackId) {
  if (!device && !metadata && !fallbackId) return null;
  const id = device?.traccarId ? String(device.traccarId) : device?.id ? String(device.id) : String(fallbackId || "");
  const uniqueId = metadata?.uniqueId || device?.uniqueId || null;
  const lastUpdate = metadata?.lastUpdate || null;
  return {
    id,
    name: metadata?.name || device?.name || device?.uniqueId || id,
    uniqueId,
    status: metadata?.status || null,
    lastUpdate,
  };
}

function decoratePositionWithDevice(position, lookup) {
  if (!position) return null;
  const { metadataById, devicesByTraccarId } = lookup || {};
  const metadata = metadataById?.get(String(position.deviceId));
  const device = devicesByTraccarId?.get(String(position.deviceId));
  const batteryLevel = extractBatteryLevel(position.attributes);
  const ignition = extractIgnition(position.attributes);
  const lastCommunication =
    position.serverTime || position.deviceTime || position.fixTime || metadata?.lastUpdate || null;

  return {
    ...position,
    device: buildDeviceInfo(device, metadata, position.deviceId),
    lastCommunication,
    batteryLevel,
    ignition,
  };
}

function pickTripAddress(trip, prefix) {
  const short = trip?.[`${prefix}ShortAddress`];
  const formatted = trip?.[`${prefix}FormattedAddress`];
  const raw = trip?.[`${prefix}Address`];
  const value = short || formatted || raw;
  if (!value) return "";
  const compact = formatAddress(value);
  return compact === "—" ? "" : compact;
}

function buildTripsCsv(trips = []) {
  const rows = trips.map((trip) => {
    const distance = Number.isFinite(Number(trip.distance)) ? Number(trip.distance) : null;
    const duration = Number.isFinite(Number(trip.duration)) ? Number(trip.duration) : null;
    const average = Number.isFinite(Number(trip.averageSpeed)) ? Number(trip.averageSpeed) : null;
    const max = Number.isFinite(Number(trip.maxSpeed)) ? Number(trip.maxSpeed) : null;

    return {
      device: trip.deviceName || trip.deviceId || trip.uniqueId || "",
      startTime: trip.startTime || trip.start || "",
      endTime: trip.endTime || trip.end || "",
      durationSeconds: duration ?? "",
      distanceMeters: distance ?? "",
      averageSpeedKmH: average ?? "",
      maxSpeedKmH: max ?? "",
      startAddress: pickTripAddress(trip, "start"),
      endAddress: pickTripAddress(trip, "end"),
      startLat: trip.startLat ?? trip.startLatitude ?? "",
      startLon: trip.startLon ?? trip.startLongitude ?? "",
      endLat: trip.endLat ?? trip.endLatitude ?? "",
      endLon: trip.endLon ?? trip.endLongitude ?? "",
    };
  });

  return stringifyCsv(rows, TRIP_CSV_COLUMNS);
}

/**
 * === Helpers de serialização/headers para a API do Traccar ===
 */

function appendRepeat(search, key, value) {
  if (value === undefined || value === null) return;
  const arr = Array.isArray(value) ? value : String(value).split(",");
  for (const raw of arr) {
    const v = String(raw).trim();
    if (v) search.append(key, v);
  }
}

function toIsoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function buildReportSearch(params = {}) {
  const search = new URLSearchParams();

  // devices
  const ids = extractDeviceIds(params);
  if (ids.length) ids.forEach((id) => search.append("deviceId", String(id)));
  else appendRepeat(search, "deviceId", params.deviceId || params.deviceIds);

  // groups
  appendRepeat(search, "groupId", params.groupId || params.groupIds);

  // types (para events)
  appendRepeat(search, "type", params.type || params.types);

  // datas
  const from = toIsoOrNull(params.from);
  const to = toIsoOrNull(params.to);
  if (from) search.set("from", from);
  if (to) search.set("to", to);

  // extras (limit, etc)
  for (const [k, v] of Object.entries(params)) {
    if (["deviceId", "deviceIds", "groupId", "groupIds", "type", "types", "from", "to", "format"].includes(k)) continue;
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      appendRepeat(search, k, v);
    }
  }

  return search;
}

function pickAccept(format = "") {
  const f = String(format).toLowerCase();
  if (f === "csv") return "text/csv";
  if (f === "gpx") return "application/gpx+xml";
  if (f === "xls") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (f === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/json";
}

async function normalizeReportPayload(path, payload) {
  const isObject = payload && typeof payload === "object" && !Array.isArray(payload);
  const base = isObject ? { ...payload } : {};
  const ensureList = (keys = []) => {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return normaliseJsonList(payload, keys);
  };

  if (path.includes("/route")) {
    const positions = ensureList(["positions", "route", "routes", "data", "items"]);
    base.positions = await enrichPositionsWithAddresses(positions);
    base.summary = computeRouteSummary({ ...base, positions: base.positions });
    return base;
  }

  if (path.includes("/stops")) {
    base.stops = ensureList(["stops", "data", "items"]);
    return base;
  }

  if (path.includes("/summary")) {
    base.summary = ensureList(["summary", "data", "items"]);
    return base;
  }

  if (path.includes("/trips")) {
    const trips = ensureList(["trips", "data", "items"]);
    base.trips = await Promise.all(
      trips.map(async (trip) => {
        const startLat = trip.startLat ?? trip.startLatitude ?? trip.lat ?? trip.latitude;
        const startLng = trip.startLon ?? trip.startLongitude ?? trip.lon ?? trip.longitude;
        const endLat = trip.endLat ?? trip.endLatitude ?? trip.latTo ?? trip.latitudeTo;
        const endLng = trip.endLon ?? trip.endLongitude ?? trip.lonTo ?? trip.longitudeTo;

        const start = await resolveShortAddress(startLat, startLng, trip.startAddress);
        const end = await resolveShortAddress(endLat, endLng, trip.endAddress);

        const metrics = computeTripMetrics(trip);

        return {
          ...trip,
          ...metrics,
          startAddress: start?.address || trip.startAddress,
          endAddress: end?.address || trip.endAddress,
          startShortAddress: start?.shortAddress || start?.formattedAddress || null,
          endShortAddress: end?.shortAddress || end?.formattedAddress || null,
          startFormattedAddress: start?.formattedAddress || null,
          endFormattedAddress: end?.formattedAddress || null,
        };
      }),
    );
    return base;
  }

  return payload ?? {};
}

/**
 * Tenta GET e, se o Traccar responder 404/405/415, faz fallback em POST.
 */
async function requestReportWithFallback(path, params, accept, wantsBinary) {
  const search = buildReportSearch(params);
  const urlGet = `${path}?${search.toString()}`;

  // 1) GET
  try {
    const res = await traccarRequest(
      {
        method: "get",
        url: urlGet,
        responseType: wantsBinary ? "arraybuffer" : "json",
        headers: { Accept: accept },
      },
      null,
      { asAdmin: true },
    );
    return res;
  } catch (err) {
    const status = err?.response?.status;
    const shouldFallback = status === 404 || status === 405 || status === 415;
    if (!shouldFallback) throw err;

    // 2) POST
    const res = await traccarRequest(
      {
        method: "post",
        url: path,
        data: params,
        responseType: wantsBinary ? "arraybuffer" : "json",
        headers: { Accept: accept },
      },
      null,
      { asAdmin: true },
    );
    return res;
  }
}

/**
 * Proxy genérico de relatórios (/reports/*) com:
 *  - filtro de cliente
 *  - conversão de deviceId interno → traccarId
 *  - datas padrão (últimas 24h)
 *  - fallback GET→POST
 */
async function proxyTraccarReportWithParams(req, res, next, path, paramsIn) {
  try {
    let params = { ...(paramsIn || {}) };

    // converte UUID → traccarId ANTES de ir pro Traccar
    params = normalizeReportDeviceIds(params);

    enforceDeviceFilterInQuery(req, params);
    enforceClientGroupInQuery(req, params);

    if (!params.from || !params.to) {
      const now = new Date();
      const to = params.to ? new Date(params.to) : now;
      const from = params.from ? new Date(params.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
      params.from = from.toISOString();
      params.to = to.toISOString();
    }

    const accept = pickAccept(String(params.format || ""));
    const wantsBinary = accept !== "application/json";

    const response = await requestReportWithFallback(path, params, accept, wantsBinary);

    if (wantsBinary) {
      res.setHeader("Content-Type", accept);
      res.send(Buffer.from(response.data));
    } else {
      res.json(await normalizeReportPayload(path, response?.data));
    }
  } catch (error) {
    if (error?.response) {
      console.error(
        "[traccar report error]",
        path,
        error.response.status,
        typeof error.response.data === "string" ? error.response.data : JSON.stringify(error.response.data),
      );
    } else {
      console.error("[traccar report error]", path, error?.message);
    }
    const status = error?.response?.status ?? 500;
    const message =
      error?.response?.data?.message ||
      (typeof error?.response?.data === "string" ? error.response.data : null) ||
      error?.message ||
      "Erro ao gerar relatório";
    next(createError(status, message));
  }
}

async function proxyTraccarReport(req, res, next, path) {
  return proxyTraccarReportWithParams(req, res, next, path, { ...(req.query || {}) });
}

async function handleEventsReport(req, res, next) {
  const accept = pickAccept(String(req.query?.format || ""));
  const wantsBinary = accept !== "application/json";
  if (wantsBinary) {
    // Exportações pesadas continuam usando a API HTTP do Traccar; leitura online usa o banco (traccarDb).
    return proxyTraccarReport(req, res, next || (() => {}), "/reports/events");
  }

  try {
    const { clientId, deviceIdsToQuery } = resolveDeviceIdsToQuery(req);
    const now = new Date();
    const from = parseDateOrThrow(
      req.query?.from ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      "from",
    );
    const to = parseDateOrThrow(req.query?.to ?? now.toISOString(), "to");
    const limit = req.query?.limit ? Number(req.query.limit) : 50;

    const devices = listDevices({ clientId });
    const metadata = await fetchDevicesMetadata();
    const lookup = buildDeviceLookup(devices, metadata);

    const events = await fetchEventsWithFallback(deviceIdsToQuery, from, to, limit);
    const positionIds = Array.from(new Set(events.map((event) => event.positionId).filter(Boolean)));
    const positions = await fetchPositionsByIds(positionIds);
    const positionMap = new Map(positions.map((position) => [position.id, position]));

    const eventsWithAddress = events.map((event) => {
      const position = event.positionId ? positionMap.get(event.positionId) : null;
      const formattedAddress = position ? formatAddress(position.address) : null;
      const decoratedPosition = position ? decoratePositionWithDevice(position, lookup) : null;
      const device = buildDeviceInfo(
        lookup.devicesByTraccarId?.get(String(event.deviceId)),
        lookup.metadataById?.get(String(event.deviceId)),
        event.deviceId,
      );
      const batteryLevel =
        decoratedPosition?.batteryLevel ?? extractBatteryLevel(position?.attributes) ?? extractBatteryLevel(event.attributes);
      const ignition =
        decoratedPosition?.ignition ?? extractIgnition(position?.attributes) ?? extractIgnition(event.attributes);
      const lastCommunication =
        decoratedPosition?.lastCommunication || device?.lastUpdate || position?.serverTime || position?.deviceTime || null;
      return {
        ...event,
        position: decoratedPosition || position,
        latitude: decoratedPosition?.latitude ?? position?.latitude,
        longitude: decoratedPosition?.longitude ?? position?.longitude,
        address: formattedAddress || decoratedPosition?.address || position?.address || event.address || null,
        device,
        lastCommunication,
        batteryLevel,
        ignition,
      };
    });

    const data = { clientId: clientId || null, deviceIds: deviceIdsToQuery, from, to, events: eventsWithAddress };

    return res.status(200).json({ data, events: eventsWithAddress, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }
    if (error?.status === 404) {
      return respondDeviceNotFound(res);
    }
    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
}

/**
 * === Helpers /users ===
 */

function sanitizeUserQuery(query = {}) {
  const nextParams = { ...query };
  delete nextParams.target;
  delete nextParams.scope;
  delete nextParams.provider;
  return nextParams;
}

function isTraccarUserRequest(req) {
  const marker = req.query?.target || req.query?.scope || req.query?.provider;
  return marker === "traccar";
}

/**
 * === Telemetria (banco do Traccar) ===
 */

router.get("/telemetry", async (req, res) => {
  try {
    const { clientId, deviceIdsToQuery } = resolveDeviceIdsToQuery(req);



    const positions = await fetchLatestPositionsWithFallback(deviceIdsToQuery, clientId);


    const data = positions.map((position) => normalisePosition(position)).filter(Boolean);

    return res.status(200).json({ data, positions: data, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }

    if (error?.status === 404) {
      return respondDeviceNotFound(res);
    }

    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
});

/**
 * === Devices ===
 */

router.get("/devices", async (req, res, next) => {
  try {
    const clientId = resolveClientId(req, req.query?.clientId, { required: false });
    const devices = listDevices({ clientId });
    let metadata = [];
    let metadataError = null;
    let fallbackDevicesFromTraccar = null;
    try {
      metadata = await fetchDevicesMetadata();
    } catch (error) {
      metadataError = error;
    }

    if (metadataError) {
      try {
        const response = await traccarProxy("get", "/devices", { asAdmin: true, context: req });
        const list = Array.isArray(response?.devices)
          ? response.devices
          : Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response)
          ? response
          : [];

        if (!Array.isArray(list) || response?.ok === false || response?.error) {
          const error = buildTraccarUnavailableError(response?.error || response, { stage: "devices-fallback" });
          return res
            .status(error.status || error.statusCode || 503)
            .json({ code: error.code, message: error.message });
        }

        fallbackDevicesFromTraccar = list;
        metadata = list.map((item) => ({
          id: item.id,
          uniqueId: item.uniqueId ?? null,
          name: item.name ?? null,
          lastUpdate: item.lastUpdate ?? item.lastCommunication ?? null,
          disabled: Boolean(item.disabled),
          status: item.status || null,
        }));
      } catch (fallbackError) {
        const error = buildTraccarUnavailableError(fallbackError, { stage: "devices-fallback" });
        return res
          .status(error.status || error.statusCode || 503)
          .json({ code: error.code, message: error.message });
      }
    }
    const traccarIds = (devices.length ? devices : metadata)
      .map((device) => (device?.traccarId != null ? String(device.traccarId) : device?.id != null ? String(device.id) : null))
      .filter(Boolean);
    const latestPositions = traccarIds.length ? await fetchLatestPositionsWithFallback(traccarIds, clientId) : [];

    const positionByDevice = new Map((latestPositions || []).map((position) => [String(position.deviceId), position]));

    const traccarById = new Map(metadata.map((item) => [String(item.id), item]));
    const traccarByUniqueId = new Map(metadata.map((item) => [String(item.uniqueId || ""), item]));

    const sourceDevices =
      devices.length || !metadata.length
        ? devices
        : metadata.map((item) => ({
            id: item.id != null ? String(item.id) : null,
            traccarId: item.id != null ? String(item.id) : null,
            name: item.name || item.uniqueId,
            uniqueId: item.uniqueId || null,
          }));

    const data = sourceDevices.map((device) => {
      const metadataMatch =
        (device.traccarId && traccarById.get(String(device.traccarId))) ||
        (device.uniqueId && traccarByUniqueId.get(String(device.uniqueId)));
      const position = positionByDevice.get(String(metadataMatch?.id || device.traccarId));
      const attributes = position?.attributes || {};
      const batteryLevel = extractBatteryLevel(attributes);
      const ignition = extractIgnition(attributes);

      return {
        id: device.traccarId ? String(device.traccarId) : String(device.id),
        name: metadataMatch?.name || device.name || device.uniqueId || String(device.id),
        uniqueId: metadataMatch?.uniqueId || device.uniqueId || null,
        status: metadataMatch?.status || null,
        lastUpdate: metadataMatch?.lastUpdate || null,
        lastCommunication:
          position?.serverTime || position?.deviceTime || position?.fixTime || metadataMatch?.lastUpdate || null,
        lastPosition: (() => {
          if (!position) return null;
          return {
            latitude: position.latitude ?? null,
            longitude: position.longitude ?? null,
            speed: position.speed ?? null,
            course: position.course ?? null,
            fixTime: position.fixTime || null,
            deviceTime: position.deviceTime || null,
            serverTime: position.serverTime || null,
            address: position.address || null,
            attributes,
            batteryLevel,
            ignition,
          };
        })(),
        batteryLevel,
        ignition,
        speed: position?.speed ?? null,
      };
    });

    const responseDevices = !devices.length && metadataError && Array.isArray(fallbackDevicesFromTraccar)
      ? fallbackDevicesFromTraccar
      : data;

    return res.status(200).json({ data, devices: responseDevices, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }

    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
});

router.post("/devices", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/devices", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/devices/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/devices/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/devices/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/devices/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * === Positions ===
 */

router.get("/positions", async (req, res, next) => {
  try {
    const { clientId, deviceIdsToQuery } = resolveDeviceIdsToQuery(req);
    const devices = listDevices({ clientId });
    const metadata = await fetchDevicesMetadata();
    const lookup = buildDeviceLookup(devices, metadata);

    const rawFrom = req.query?.from;
    const rawTo = req.query?.to;
    const hasDeviceFilter = req.query?.deviceId !== undefined || req.query?.deviceIds !== undefined;
    const shouldApplyRange = hasDeviceFilter || rawFrom || rawTo;

    const from = shouldApplyRange
      ? parseDateOrThrow(rawFrom || new Date(Date.now() - 24 * 60 * 60 * 1000), "from")
      : null;
    const to = shouldApplyRange ? parseDateOrThrow(rawTo || new Date(), "to") : null;
    const limit = req.query?.limit ? Number(req.query.limit) : null;

    const positions = await fetchPositions(deviceIdsToQuery, from, to, { limit });
    const data = await enrichPositionsWithAddresses(positions);

    const enriched = data.map((position) => decoratePositionWithDevice(position, lookup)).filter(Boolean);

    return res.status(200).json({ data: enriched, positions: enriched, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }
    if (error?.status === 404) {
      return respondDeviceNotFound(res);
    }
    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
});

// /positions/last (compat)
router.get("/positions/last", async (req, res) => {
  const rawDeviceId = req.query?.deviceId ?? req.query?.deviceIds;
  const requestedIds = parseDeviceIds(rawDeviceId);

  if (requestedIds.length > 1) {
    return respondBadRequest(res, "Parâmetros inválidos.");
  }

  if (requestedIds.some((value) => !/^\d+$/.test(value))) {
    return respondBadRequest(res);
  }

  try {
    const { clientId, deviceIdsToQuery } = resolveDeviceIdsToQuery(req);
    const devices = listDevices({ clientId });
    const metadata = await fetchDevicesMetadata();
    const lookup = buildDeviceLookup(devices, metadata);
    if (requestedIds.length && !deviceIdsToQuery.length) {
      return respondDeviceNotFound(res);
    }

    const positions = await fetchLatestPositionsWithFallback(deviceIdsToQuery, clientId);

    const data = positions
      .map((position) => decoratePositionWithDevice(normalisePosition(position), lookup))
      .filter(Boolean);

    return res.status(200).json({ data, positions: data, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }

    if (error?.status === 404) {
      return respondDeviceNotFound(res);
    }

    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
});

/**
 * === Events (usa /reports/events) ===
 */

router.all("/events", (req, res, next) =>
  handleEventsReport(req, res, next),
);

/**
 * === Groups / Drivers ===
 */

router.get("/groups", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/groups", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/groups", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/groups", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/groups/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/groups/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/groups/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/groups/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/drivers", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/drivers", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/drivers", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/drivers", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/drivers/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/drivers/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/drivers/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/drivers/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * === Commands ===
 */

router.get("/commands", async (req, res, next) => {
  try {
    const params = { ...(req.query || {}) };
    enforceDeviceFilterInQuery(req, params);
    enforceClientGroupInQuery(req, params);
    const data = await traccarProxy("get", "/commands", { params, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/commands", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const allowed = resolveAllowedDeviceIds(req);
    const traccarDeviceId = resolveTraccarDeviceId(req, allowed);
    if (!traccarDeviceId) {
      throw createError(400, "deviceId é obrigatório");
    }

    const payload = {
      type: req.body?.type,
      attributes: req.body?.attributes || {},
      deviceId: Number(traccarDeviceId),
    };

    if (!payload.type) {
      throw createError(400, "type é obrigatório");
    }

    const data = await traccarProxy("post", "/commands", { data: payload, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/commands/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/commands/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/commands/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/commands/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * === Reports (GET no nosso backend, GET→POST no Traccar) ===
 */

router.get("/reports/route",   (req, res, next) => proxyTraccarReport(req, res, next, "/reports/route"));
router.get("/reports/summary", (req, res, next) => proxyTraccarReport(req, res, next, "/reports/summary"));
router.get("/reports/stops",   (req, res, next) => proxyTraccarReport(req, res, next, "/reports/stops"));
router.get("/reports/trips", async (req, res) => {
  const accept = pickAccept(String(req.query?.format || ""));
  const wantsBinary = accept !== "application/json";
  if (wantsBinary) {
    // Exportações pesadas continuam usando a API HTTP do Traccar; leitura online usa o banco (traccarDb).
    return proxyTraccarReport(req, res, () => {}, "/reports/trips");
  }

  try {
    const { clientId, deviceIdsToQuery } = resolveDeviceIdsToQuery(req);
    const from = parseDateOrThrow(req.query?.from, "from");
    const to = parseDateOrThrow(req.query?.to, "to");

    const tripsPerDevice = await Promise.all(
      deviceIdsToQuery.map(async (deviceId) => {
        const trips = await fetchTrips(deviceId, from, to);
        return trips.map((trip) => ({ ...trip, deviceId }));
      }),
    );

    const data = {
      clientId: clientId || null,
      deviceIds: deviceIdsToQuery,
      from,
      to,
      trips: tripsPerDevice.flat(),
    };

    return res.status(200).json({ data, error: null });
  } catch (error) {
    if (error?.status === 400) {
      return respondBadRequest(res, error.message || "Parâmetros inválidos.");
    }
    if (error?.status === 404) {
      return respondDeviceNotFound(res);
    }
    return res.status(503).json(TRACCAR_DB_ERROR_PAYLOAD);
  }
});

router.get("/reports/events", (req, res, next) => handleEventsReport(req, res, next));

/**
 * === Notifications ===
 */

router.get("/notifications", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/notifications", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/notifications", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/notifications", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/notifications/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/notifications/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/notifications/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/notifications/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * === Users (quando target=traccar) ===
 */

router.get("/users", async (req, res, next) => {
  if (!isTraccarUserRequest(req)) return next();
  try {
    const params = sanitizeUserQuery(req.query);
    const data = await traccarProxy("get", "/users", { params, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/users", requireRole("manager", "admin"), async (req, res, next) => {
  if (!isTraccarUserRequest(req)) return next();
  try {
    const data = await traccarProxy("post", "/users", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/users/:id", requireRole("manager", "admin"), async (req, res, next) => {
  if (!isTraccarUserRequest(req)) return next();
  try {
    const data = await traccarProxy("put", `/users/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/users/:id", requireRole("manager", "admin"), async (req, res, next) => {
  if (!isTraccarUserRequest(req)) return next();
  try {
    await traccarProxy("delete", `/users/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * === Geofences ===
 */

router.get("/geofences", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/geofences", { params: req.query, asAdmin: true });
    const withGroups = Array.isArray(data)
      ? data.map((item) => ({
          ...item,
          geofenceGroupIds: getGroupIdsForGeofence(item?.id ?? item?.geofenceId, { clientId: req.user?.clientId }),
        }))
      : data;
    res.json(withGroups);
  } catch (error) {
    next(error);
  }
});

router.post("/geofences", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/geofences", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.put("/geofences/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("put", `/geofences/${req.params.id}`, { data: req.body, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/geofences/:id", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    await traccarProxy("delete", `/geofences/${req.params.id}`, { asAdmin: true });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * === Permissions ===
 */

router.post("/permissions", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    const data = await traccarProxy("post", "/permissions", { data: req.body, asAdmin: true });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * === Compat: POST /api/reports/trips (front antigo) ===
 */

router.post("/reports/trips", requireRole("manager", "admin"), async (req, res, next) => {
  try {
    enforceDeviceFilterInBody(req);
    enforceClientGroupInBody(req);

    let body = { ...(req.body || {}) };
    body = normalizeReportDeviceIds(body);

    if (!body.from || !body.to) {
      const now = new Date();
      const to = body.to ? new Date(body.to) : now;
      const from = body.from ? new Date(body.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
      body.from = from.toISOString();
      body.to = to.toISOString();
    }

    const accept = pickAccept(String(body.format || ""));
    const wantsBinary = accept !== "application/json";

    if (wantsBinary && String(body.format || "").toLowerCase() === "csv") {
      const jsonResponse = await requestReportWithFallback("/reports/trips", body, "application/json", false);
      const normalized = await normalizeReportPayload("/reports/trips", jsonResponse?.data);
      const csv = buildTripsCsv(normalized?.trips || []);
      res.setHeader("Content-Type", "text/csv");
      res.send(csv);
      return;
    }

    const response = await requestReportWithFallback("/reports/trips", body, accept, wantsBinary);

    if (wantsBinary) {
      res.setHeader("Content-Type", accept);
      res.send(Buffer.from(response.data));
    } else {
      res.json(await normalizeReportPayload("/reports/trips", response?.data));
    }
  } catch (error) {
    if (error?.response) {
      console.error(
        "[traccar report error] /reports/trips",
        error.response.status,
        typeof error.response.data === "string" ? error.response.data : JSON.stringify(error.response.data),
      );
    } else {
      console.error("[traccar report error] /reports/trips", error?.message);
    }
    const status = error?.response?.status ?? 500;
    const message =
      error?.response?.data?.message ||
      (typeof error?.response?.data === "string" ? error.response.data : null) ||
      error?.message ||
      "Erro ao gerar relatório";
    next(createError(status, message));
  }
});

export default router;
