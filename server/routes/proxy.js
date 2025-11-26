// server/routes/proxy.js
import express from "express";
import createError from "http-errors";

import { authenticate, requireRole } from "../middleware/auth.js";
import { getDeviceById, listDevices } from "../models/device.js";
import { buildTraccarUnavailableError, traccarProxy, traccarRequest } from "../services/traccar.js";
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

const lastPositionCache = createTtlCache(2_500);

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
 * === Devices ===
 */

router.get("/devices", async (req, res, next) => {
  try {
    const data = await traccarProxy("get", "/devices", { params: req.query, asAdmin: true });
    res.json(data);
  } catch (error) {
    next(error);
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
    const params = { ...(req.query || {}) };

    enforceDeviceFilterInQuery(req, params);

    const hasDeviceId =
      extractDeviceIds(params).length ||
      params.deviceId !== undefined ||
      params.deviceIds !== undefined;

    if (hasDeviceId && (!params.from || !params.to)) {
      const now = new Date();
      const to = params.to ? new Date(params.to) : now;
      const from = params.from ? new Date(params.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
      params.from = from.toISOString();
      params.to = to.toISOString();
    }

    const accept = pickAccept(String(params.format || ""));
    const wantsBinary = accept !== "application/json";

    const search = new URLSearchParams();
    const ids = extractDeviceIds(params);
    if (ids.length) ids.forEach((id) => search.append("deviceId", String(id)));
    appendRepeat(search, "id", params.id);
    if (params.from) search.set("from", toIsoOrNull(params.from));
    if (params.to) search.set("to", toIsoOrNull(params.to));

    const url = `/positions?${search.toString()}`;

    const response = await traccarRequest(
      {
        method: "get",
        url,
        responseType: wantsBinary ? "arraybuffer" : "json",
        headers: { Accept: accept },
      },
      null,
      { asAdmin: true },
    );

    if (wantsBinary) {
      res.setHeader("Content-Type", accept);
      res.send(Buffer.from(response.data));
    } else {
      const body = Array.isArray(response.data)
        ? await enrichPositionsWithAddresses(response.data)
        : response.data?.positions && Array.isArray(response.data.positions)
        ? { ...response.data, positions: await enrichPositionsWithAddresses(response.data.positions) }
        : response.data;
      res.json(body);
    }
  } catch (error) {
    next(error);
  }
});

// /positions/last (compat)
router.get("/positions/last", async (req, res, next) => {
  try {
    const params = { ...(req.query || {}) };
    enforceDeviceFilterInQuery(req, params);

    const hasDeviceId =
      extractDeviceIds(params).length ||
      params.deviceId !== undefined ||
      params.deviceIds !== undefined;

    if (hasDeviceId && (!params.from || !params.to)) {
      const now = new Date();
      const to = params.to ? new Date(params.to) : now;
      const from = params.from ? new Date(params.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
      params.from = from.toISOString();
      params.to = to.toISOString();
    }

    const cacheKey = JSON.stringify(params || {});
    const cached = lastPositionCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const data = await traccarProxy("get", "/positions", { params, asAdmin: true });
    const body = Array.isArray(data)
      ? await enrichPositionsWithAddresses(data)
      : data?.positions && Array.isArray(data.positions)
      ? { ...data, positions: await enrichPositionsWithAddresses(data.positions) }
      : data;
    if (body) {
      lastPositionCache.set(cacheKey, body, 2_500);
    }
    res.json(body);
  } catch (error) {
    next(buildTraccarUnavailableError(error, { url: "/positions", params }));
  }
});

/**
 * === Events (usa /reports/events) ===
 */

router.all("/events", (req, res, next) =>
  proxyTraccarReport(req, res, next, "/reports/events"),
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
router.get("/reports/trips",   (req, res, next) => proxyTraccarReport(req, res, next, "/reports/trips"));
router.get("/reports/events",  (req, res, next) => proxyTraccarReport(req, res, next, "/reports/events"));

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
    res.json(data);
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
