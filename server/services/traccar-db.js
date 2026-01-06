// Este módulo é a FONTE PRINCIPAL de telemetria do Traccar no Euro One.
// Utilize as funções abaixo para ler posições, eventos e viagens diretamente do banco do Traccar.
// A API HTTP do Traccar fica reservada para comandos e operações administrativas.
//
// Arquitetura C: todos os dados de telemetria/devices/eventos devem sair daqui (banco do Traccar),
// deixando a API HTTP do Traccar apenas para comandos e tarefas administrativas.
import createError from "http-errors";

import { config } from "../config.js";
import {
  buildTraccarUnavailableError,
  getLastPositions,
  resolveTraccarApiUrl,
  traccarProxy,
} from "./traccar.js";
import { ensureCachedAddresses, enqueueWarmGeocodeFromPositions, formatFullAddress, getCachedGeocode } from "../utils/address.js";
import { enqueueGeocodeJob } from "../jobs/geocode.queue.js";

const TRACCAR_UNAVAILABLE_MESSAGE = "Banco do Traccar indisponível";
const POSITION_TABLE = "tc_positions";
const EVENT_TABLE = "tc_events";
const DEVICE_TABLE = "tc_devices";
const ADDRESS_STATUS = {
  PENDING: "PENDING",
  RESOLVED: "RESOLVED",
  FAILED: "FAILED",
};

let dbPool = null;
let testOverrides = null;
const fallbackLogThrottle = new Map();

const DIALECTS = {
  mysql: {
    placeholder: (index) => "?",
    createPool: async () => {
      const module = await import("mysql2/promise");
      const mysql = module.default || module;
      return mysql.createPool({
        host: config.traccar.db.host,
        port: config.traccar.db.port,
        user: config.traccar.db.user,
        password: config.traccar.db.password,
        database: config.traccar.db.name,
        timezone: "Z",
        connectionLimit: 10,
        waitForConnections: true,
      });
    },
    query: async (pool, sql, params) => {
      const [rows] = await pool.query(sql, params);
      return rows;
    },
  },
  mariadb: null,
  postgresql: {
    placeholder: (index) => `$${index}`,
    createPool: async () => {
      const module = await import("pg");
      const { Pool } = module.default || module;
      return new Pool({
        host: config.traccar.db.host,
        port: config.traccar.db.port,
        user: config.traccar.db.user,
        password: config.traccar.db.password,
        database: config.traccar.db.name,
        max: 10,
        idleTimeoutMillis: 30_000,
      });
    },
    query: async (pool, sql, params) => {
      const result = await pool.query(sql, params);
      return result.rows;
    },
  },
  postgres: null,
  pg: null,
};

function resolveDialect() {
  if (testOverrides?.dialect) return { key: "test", ...testOverrides.dialect };
  const client = (config.traccar.db.client || "").toLowerCase();
  if (DIALECTS[client]) return { key: client, ...DIALECTS[client] };
  if (["postgres", "pg"].includes(client)) return { key: "postgresql", ...DIALECTS.postgresql };
  return null;
}

function isTraccarDbConfigured() {
  if (testOverrides?.pool || testOverrides?.dialect) return true;
  return Boolean(config.traccar.db.client && config.traccar.db.host && config.traccar.db.name);
}

function logFallback(stage, url, context = {}) {
  const now = Date.now();
  const last = fallbackLogThrottle.get(stage) || 0;
  if (now - last < 5000) return;
  fallbackLogThrottle.set(stage, now);
  console.info(`[traccar-db] fallback ${stage}`, { url, ...context });
}

async function getPool() {
  if (!isTraccarDbConfigured()) {
    throw createError(503, TRACCAR_UNAVAILABLE_MESSAGE);
  }

  if (testOverrides?.pool) return testOverrides.pool;
  if (dbPool) return dbPool;

  const dialect = resolveDialect();
  if (!dialect) {
    throw createError(500, "Cliente do banco do Traccar não suportado");
  }

  try {
    dbPool = await dialect.createPool();
    return dbPool;
  } catch (error) {
    console.error("[traccar-db] falha ao criar pool", error);
    throw buildTraccarUnavailableError(error, { stage: "pool" });
  }
}

function buildPlaceholders(values, startIndex = 1) {
  const dialect = resolveDialect();
  if (!dialect) return values.map(() => "?").join(", ");
  return values.map((_, index) => dialect.placeholder(index + startIndex)).join(", ");
}

export async function getTraccarDbHealth() {
  if (!isTraccarDbConfigured()) {
    return { ok: false, code: 503, message: "Banco do Traccar não configurado" };
  }

  try {
    await queryTraccarDb("SELECT 1");
    return { ok: true, message: "Banco do Traccar acessível." };
  } catch (error) {
    const code = error?.status || error?.statusCode || error?.code || 503;
    return {
      ok: false,
      code,
      message: error?.message || TRACCAR_UNAVAILABLE_MESSAGE,
    };
  }
}

export async function queryTraccarDb(sql, params = []) {
  try {
    const pool = await getPool();
    const dialect = resolveDialect();
    const executor = dialect?.query;
    if (!executor) {
      throw createError(500, "Driver SQL do Traccar não configurado");
    }
    return await executor(pool, sql, params);
  } catch (error) {
    console.error("[traccar-db] erro ao consultar banco", { sql, params, error });
    throw buildTraccarUnavailableError(error, { stage: "db-query", sql });
  }
}

function parseJson(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

function normaliseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw.toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeAddressStatus(status) {
  if (!status) return null;
  const raw = String(status).trim().toUpperCase();
  if (raw === ADDRESS_STATUS.PENDING || raw === ADDRESS_STATUS.RESOLVED || raw === ADDRESS_STATUS.FAILED) {
    return raw;
  }
  return null;
}

function mapGeocodeStatus(addressStatus) {
  const normalized = normalizeAddressStatus(addressStatus);
  if (normalized === ADDRESS_STATUS.RESOLVED) return "ok";
  if (normalized === ADDRESS_STATUS.FAILED) return "failed";
  if (normalized === ADDRESS_STATUS.PENDING) return "pending";
  return null;
}

function normalisePositionRow(row) {
  if (!row) return null;
  const attributes = parseJson(row.attributes);
  const addressStatus = normalizeAddressStatus(row.address_status ?? row.addressStatus ?? null);
  return {
    id: row.id ?? row.positionid ?? null,
    deviceId: row.deviceid ?? row.deviceId ?? null,
    fixTime: normaliseDate(row.fixtime ?? row.fixTime),
    serverTime: normaliseDate(row.servertime ?? row.serverTime),
    deviceTime: normaliseDate(row.devicetime ?? row.deviceTime),
    latitude: Number(row.latitude ?? 0),
    longitude: Number(row.longitude ?? 0),
    speed: Number(row.speed ?? 0),
    course: Number(row.course ?? 0),
    altitude: Number(row.altitude ?? 0),
    accuracy: row.accuracy != null ? Number(row.accuracy) : null,
    valid: row.valid != null ? Boolean(row.valid) : null,
    protocol: row.protocol ?? null,
    network: parseJson(row.network),
    address: row.address ? String(row.address) : null,
    fullAddress: row.full_address ?? row.fullAddress ?? null,
    addressStatus,
    addressProvider: row.address_provider ?? row.addressProvider ?? null,
    addressUpdatedAt: normaliseDate(row.address_updated_at ?? row.addressUpdatedAt),
    addressError: row.address_error ?? row.addressError ?? null,
    attributes,
    geocodeStatus: mapGeocodeStatus(addressStatus),
  };
}

function normaliseEventRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type ?? null,
    eventTime: normaliseDate(row.eventtime ?? row.eventTime),
    serverTime: normaliseDate(row.servertime ?? row.serverTime),
    deviceId: row.deviceid ?? row.deviceId ?? null,
    positionId: row.positionid ?? row.positionId ?? null,
    geofenceId: row.geofenceid ?? row.geofenceId ?? null,
    attributes: parseJson(row.attributes),
  };
}

function decoratePositionsWithGeocode(positions = [], options = {}) {
  const list = Array.isArray(positions) ? positions : [];
  const resolved = ensureCachedAddresses(list, options);
  void enqueueWarmGeocodeFromPositions(resolved, { priority: options.priority || "normal", reason: "warm_fill" });
  return resolved;
}

function calculateDistanceKm(from, to) {
  const toRad = (value) => (value * Math.PI) / 180;
  if (!from || !to) return 0;
  const R = 6371;
  const dLat = toRad((to.latitude ?? 0) - (from.latitude ?? 0));
  const dLon = toRad((to.longitude ?? 0) - (from.longitude ?? 0));
  const lat1 = toRad(from.latitude ?? 0);
  const lat2 = toRad(to.latitude ?? 0);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function extractDistanceMeters(attributes) {
  if (!attributes || typeof attributes !== "object") return null;
  const raw = attributes.totalDistance ?? attributes.distance ?? attributes.odometer ?? null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function buildTripSegment(start, end, accumulator) {
  const durationMs = Math.max(0, (accumulator.lastTimestamp ?? 0) - (accumulator.startTimestamp ?? 0));
  const durationMinutes = durationMs / 1000 / 60;
  const averageSpeed = accumulator.pointCount > 0 ? accumulator.speedSum / accumulator.pointCount : 0;

  return {
    start: {
      id: start.id ?? null,
      time: start.fixTime || start.serverTime || start.deviceTime,
      latitude: start.latitude,
      longitude: start.longitude,
      address: start.address || null,
      attributes: start.attributes || {},
    },
    end: {
      id: end.id ?? null,
      time: end.fixTime || end.serverTime || end.deviceTime,
      latitude: end.latitude,
      longitude: end.longitude,
      address: end.address || null,
      attributes: end.attributes || {},
    },
    distanceKm: Number(accumulator.distanceKm.toFixed(3)),
    durationMinutes: Number(durationMinutes.toFixed(2)),
    averageSpeedKmh: Number((averageSpeed * 1.852).toFixed(2)),
    maxSpeedKmh: Number(accumulator.maxSpeed * 1.852).toFixed(2),
  };
}

function buildTripsFromPositions(positions) {
  if (!positions || positions.length === 0) return [];

  const trips = [];
  let current = null;
  let lastPosition = null;
  let lastDistance = null;
  const gapThresholdMs = 30 * 60 * 1000; // 30 minutos separa viagens

  positions.forEach((raw) => {
    const position = normalisePositionRow(raw);
    const timestamp = Date.parse(position.fixTime || position.serverTime || position.deviceTime || 0);
    if (!Number.isFinite(timestamp)) return;

    if (!current) {
      current = {
        start: position,
        end: position,
        startTimestamp: timestamp,
        lastTimestamp: timestamp,
        distanceKm: 0,
        speedSum: position.speed ?? 0,
        maxSpeed: position.speed ?? 0,
        pointCount: 1,
      };
      lastPosition = position;
      lastDistance = extractDistanceMeters(position.attributes);
      return;
    }

    const distanceMeters = extractDistanceMeters(position.attributes);
    const distanceDeltaKm =
      Number.isFinite(distanceMeters) && Number.isFinite(lastDistance) && distanceMeters >= lastDistance
        ? (distanceMeters - lastDistance) / 1000
        : calculateDistanceKm(lastPosition, position);

    const gap = timestamp - current.lastTimestamp;
    const shouldStartNewTrip = gap > gapThresholdMs;

    if (shouldStartNewTrip) {
      trips.push(buildTripSegment(current.start, current.end, current));
      current = {
        start: position,
        end: position,
        startTimestamp: timestamp,
        lastTimestamp: timestamp,
        distanceKm: 0,
        speedSum: position.speed ?? 0,
        maxSpeed: position.speed ?? 0,
        pointCount: 1,
      };
      lastDistance = distanceMeters;
      lastPosition = position;
      return;
    }

    current.end = position;
    current.lastTimestamp = timestamp;
    current.distanceKm += distanceDeltaKm || 0;
    current.speedSum += position.speed ?? 0;
    current.pointCount += 1;
    current.maxSpeed = Math.max(current.maxSpeed, position.speed ?? 0);

    lastPosition = position;
    lastDistance = distanceMeters ?? lastDistance;
  });

  if (current) {
    trips.push(buildTripSegment(current.start, current.end, current));
  }

  return trips;
}

export async function fetchTrips(deviceId, from, to) {
  if (!deviceId || !from || !to) {
    throw createError(400, "Parâmetros obrigatórios: deviceId, from, to");
  }

  const dialect = resolveDialect();
  if (!dialect) {
    throw createError(500, "Cliente do banco do Traccar não suportado");
  }

  const sql = `
    SELECT id, deviceid, servertime, devicetime, fixtime, latitude, longitude, speed, course, address, full_address, address_status, address_provider, address_updated_at, address_error, attributes
    FROM ${POSITION_TABLE}
    WHERE deviceid = ${dialect.placeholder(1)}
      AND fixtime BETWEEN ${dialect.placeholder(2)} AND ${dialect.placeholder(3)}
    ORDER BY fixtime ASC
  `;

  const rows = await queryTraccarDb(sql, [deviceId, from, to]);
  const decorated = decoratePositionsWithGeocode(rows, { warm: true, priority: "trip" });
  return buildTripsFromPositions(decorated);
}

export async function fetchLatestPositions(deviceIds = [], clientId = null) {
  const filtered = Array.from(new Set((deviceIds || []).filter(Boolean)));
  if (!filtered.length && !clientId) return [];

  const dialect = resolveDialect();
  if (!dialect) {
    throw createError(500, "Cliente do banco do Traccar não suportado");
  }

  const conditions = [];
  const params = [];
  if (filtered.length) {
    conditions.push(`d.id IN (${buildPlaceholders(filtered, params.length + 1)})`);
    params.push(...filtered);
  }
  if (clientId) {
    conditions.push(`d.groupid = ${dialect.placeholder(params.length + 1)}`);
    params.push(clientId);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `
    SELECT
      latest.id,
      latest.deviceid,
      latest.servertime,
      latest.devicetime,
      latest.fixtime,
      latest.latitude,
      latest.longitude,
      latest.speed,
      latest.course,
      latest.altitude,
      latest.accuracy,
      latest.valid,
      latest.protocol,
      latest.network,
      latest.address,
      latest.full_address,
      latest.address_status,
      latest.address_provider,
      latest.address_updated_at,
      latest.address_error,
      latest.attributes
    FROM (
      SELECT
        p.*, ROW_NUMBER() OVER (PARTITION BY p.deviceid ORDER BY p.fixtime DESC) AS row_num
      FROM ${POSITION_TABLE} p
      INNER JOIN ${DEVICE_TABLE} d ON d.id = p.deviceid
      ${whereClause}
    ) latest
    WHERE latest.row_num = 1
    ORDER BY latest.fixtime DESC
  `;

  const rows = (await queryTraccarDb(sql, params)) || [];
  const normalized = rows
    .map(normalisePositionRow)
    .filter((position) => position && position.deviceId !== null && position.fixTime);
  return decoratePositionsWithGeocode(normalized, {
    warm: true,
    priority: "latest",
  });
}



async function fetchLatestPositionsFromApi(deviceIds = [], context = {}) {
  const filtered = Array.from(new Set((deviceIds || []).filter(Boolean)));
  if (!filtered.length) return [];

  const targetUrl = resolveTraccarApiUrl("/positions/last", { deviceId: filtered });
  if (targetUrl) {
    logFallback("http-last-positions", targetUrl, { deviceCount: filtered.length, ...context });
  }

  const response = await getLastPositions(null, filtered, { asAdmin: true });
  const positions = Array.isArray(response?.positions) ? response.positions : response?.data || [];

  if (response?.ok) {
    const normalized = positions
      .map(normalisePositionRow)
      .filter((position) => position && position.deviceId !== null && position.fixTime);
    return decoratePositionsWithGeocode(normalized, {
      warm: true,
      priority: "latest-fallback",
    });
  }

  const status = Number(response?.error?.code || response?.status);
  throw buildTraccarUnavailableError(
    createError(Number.isFinite(status) ? status : 503, response?.error?.message || TRACCAR_UNAVAILABLE_MESSAGE),
    { stage: "http-last-positions", response: response?.error },
  );
}

export async function fetchLatestPositionsWithFallback(deviceIds = [], clientId = null) {
  const filtered = Array.from(new Set((deviceIds || []).filter(Boolean)));
  let lastError = null;

  const dbConfigured = isTraccarDbConfigured();

  if (dbConfigured) {
    try {
      return await fetchLatestPositions(filtered, clientId);
    } catch (error) {
      lastError = error;
    }
  } else {
    if (!filtered.length) {
      return [];
    }
    console.warn("[traccar-db] Banco do Traccar não configurado; usando API HTTP para últimas posições.");
  }

  try {
    return await fetchLatestPositionsFromApi(filtered, { reason: dbConfigured ? "db-error" : "db-not-configured" });
  } catch (fallbackError) {
    if (lastError) {
      fallbackError.cause = lastError;
    }
    throw fallbackError;
  }
}

export async function countPositions(deviceIds = [], from, to) {
  const filtered = Array.from(new Set((deviceIds || []).filter(Boolean)));
  if (!filtered.length) return 0;

  const dialect = resolveDialect();
  if (!dialect) {
    throw createError(500, "Cliente do banco do Traccar não suportado");
  }

  const params = [];
  const conditions = [`deviceid IN (${buildPlaceholders(filtered)})`];
  params.push(...filtered);

  if (from) {
    conditions.push(`fixtime >= ${dialect.placeholder(params.length + 1)}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`fixtime <= ${dialect.placeholder(params.length + 1)}`);
    params.push(to);
  }

  const sql = `SELECT COUNT(*) as total FROM ${POSITION_TABLE} WHERE ${conditions.join(" AND ")}`;
  const rows = await queryTraccarDb(sql, params);
  const total = Number(rows?.[0]?.total ?? rows?.[0]?.count ?? 0);
  return Number.isFinite(total) ? total : 0;
}

export async function fetchPositions(deviceIds = [], from, to, { limit = null, offset = null } = {}) {
  const filtered = Array.from(new Set((deviceIds || []).filter(Boolean)));
  if (!filtered.length) return [];

  const dialect = resolveDialect();
  if (!dialect) {
    throw createError(500, "Cliente do banco do Traccar não suportado");
  }

  const params = [];
  const conditions = [`deviceid IN (${buildPlaceholders(filtered)})`];
  params.push(...filtered);

  if (from) {
    conditions.push(`fixtime >= ${dialect.placeholder(params.length + 1)}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`fixtime <= ${dialect.placeholder(params.length + 1)}`);
    params.push(to);
  }

  const sql = `
    SELECT
      id,
      deviceid,
      servertime,
      devicetime,
      fixtime,
      latitude,
      longitude,
      speed,
      course,
      altitude,
      accuracy,
      valid,
      protocol,
      network,
      address,
      full_address,
      address_status,
      address_provider,
      address_updated_at,
      address_error,
      attributes
    FROM ${POSITION_TABLE}
    WHERE ${conditions.join(" AND ")}
    ORDER BY fixtime ASC
    ${limit ? `LIMIT ${Number(limit)}` : ""}
    ${offset ? `OFFSET ${Number(offset)}` : ""}
  `;

  const rows = await queryTraccarDb(sql, params);
  const normalized = rows
    .map(normalisePositionRow)
    .filter((position) => position && position.deviceId !== null && position.fixTime);
  const decorated = decoratePositionsWithGeocode(normalized, { warm: true, priority: "range" });
  void enqueueWarmGeocodeFromPositions(decorated, { priority: "range", reason: "warm_fill" });
  return decorated;
}

export async function updatePositionAddress(
  positionId,
  { fullAddress = null, status = ADDRESS_STATUS.RESOLVED, provider = null, error = null } = {},
) {
  if (!positionId) return null;
  const dialect = resolveDialect();
  if (!dialect) {
    throw createError(500, "Cliente do banco do Traccar não suportado");
  }

  const fields = [];
  const params = [];

  if (fullAddress) {
    fields.push(`full_address = ${dialect.placeholder(params.length + 1)}`);
    params.push(fullAddress);
  }

  if (status) {
    fields.push(`address_status = ${dialect.placeholder(params.length + 1)}`);
    params.push(status);
  }

  if (provider !== undefined) {
    fields.push(`address_provider = ${dialect.placeholder(params.length + 1)}`);
    params.push(provider);
  }

  if (error !== undefined) {
    fields.push(`address_error = ${dialect.placeholder(params.length + 1)}`);
    params.push(error);
  }

  fields.push(`address_updated_at = ${dialect.placeholder(params.length + 1)}`);
  params.push(new Date());

  if (!fields.length) return null;

  const sql = `
    UPDATE ${POSITION_TABLE}
    SET ${fields.join(", ")}
    WHERE id = ${dialect.placeholder(params.length + 1)}
  `;

  params.push(positionId);
  return await queryTraccarDb(sql, params);
}

export async function updatePositionFullAddress(positionId, fullAddress, options = {}) {
  if (!positionId || !fullAddress) return null;
  return updatePositionAddress(positionId, {
    fullAddress,
    status: options.status || ADDRESS_STATUS.RESOLVED,
    provider: options.provider,
    error: options.error,
  });
}

export async function markPositionGeocodePending(positionId, { provider = null } = {}) {
  return updatePositionAddress(positionId, {
    status: ADDRESS_STATUS.PENDING,
    provider,
    error: null,
  });
}

export async function markPositionGeocodeFailed(positionId, { error = null, provider = null } = {}) {
  return updatePositionAddress(positionId, {
    status: ADDRESS_STATUS.FAILED,
    provider,
    error: error ? String(error).slice(0, 200) : null,
  });
}

function createLimiter(concurrency, minIntervalMs) {
  const queue = [];
  let active = 0;
  let lastStart = 0;

  async function run(task) {
    if (active >= concurrency) {
      await new Promise((resolve) => queue.push(resolve));
    }

    const now = Date.now();
    const elapsed = now - lastStart;
    if (elapsed < minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, minIntervalMs - elapsed));
    }
    lastStart = Date.now();
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    }
  }

  return (task) => run(task);
}

function isCoordinateFallback(value) {
  if (!value) return false;
  const text = String(value).trim();
  if (!text) return false;
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return false;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

export async function ensureFullAddressForPositions(positionIds = [], options = {}) {
  const ids = Array.from(new Set((positionIds || []).filter(Boolean)));
  if (!ids.length) return { resolvedIds: [], pendingIds: [] };

  const {
    positions: providedPositions = [],
    wait = true,
    timeoutMs = 15_000,
    concurrency = 3,
    minIntervalMs = 1_000,
    onProgress = null,
  } = options;

  const positionsById = new Map((providedPositions || []).filter(Boolean).map((item) => [String(item.id), item]));
  const existing = positionsById.size >= ids.length ? providedPositions : await fetchPositionsByIds(ids);
  const missing = (existing || []).filter((item) => item && (!item.fullAddress || String(item.fullAddress).trim() === ""));

  if (!missing.length) {
    return { resolvedIds: [], pendingIds: [] };
  }

  const limiter = createLimiter(Math.max(1, concurrency), Math.max(0, minIntervalMs));
  const pendingIds = new Set();
  const resolvedIds = new Set();

  const tasks = missing.map((item) =>
    limiter(async () => {
      try {
        if (!Number.isFinite(Number(item.latitude)) || !Number.isFinite(Number(item.longitude))) {
          return;
        }

        if (Number(item.latitude) === 0 && Number(item.longitude) === 0) {
          return;
        }

        const cached = getCachedGeocode(item.latitude, item.longitude);
        const formatted = formatFullAddress(
          cached?.formattedAddress || cached?.shortAddress || cached?.address || item.fullAddress || item.address,
        );
        if (formatted && formatted !== "—" && !isCoordinateFallback(formatted)) {
          await updatePositionFullAddress(item.id, formatted, {
            provider: cached?.provider || null,
          });
          item.fullAddress = formatted;
          resolvedIds.add(item.id);
          if (typeof onProgress === "function") {
            onProgress({ id: item.id, fullAddress: formatted });
          }
          return;
        }

        pendingIds.add(item.id);
        await markPositionGeocodePending(item.id);
        await enqueueGeocodeJob({
          lat: item.latitude,
          lng: item.longitude,
          positionId: item.id,
          deviceId: item.deviceId ?? item.deviceid ?? null,
          reason: "warm_fill",
          priority: "high",
        });
      } catch (error) {
        console.warn("[traccar-db] falha ao resolver full_address", item?.id, error?.message || error);
      }
    }),
  );

  if (!wait) {
    missing.forEach((item) => {
      const cached = getCachedGeocode(item.latitude, item.longitude);
      const formatted = formatFullAddress(
        cached?.formattedAddress || cached?.shortAddress || cached?.address || item.fullAddress || item.address,
      );
      if (formatted && formatted !== "—" && !isCoordinateFallback(formatted)) {
        resolvedIds.add(item.id);
      } else {
        pendingIds.add(item.id);
      }
    });
    Promise.allSettled(tasks).catch((error) => {
      console.warn("[traccar-db] backfill assíncrono falhou", error?.message || error);
    });
    return { resolvedIds: Array.from(resolvedIds), pendingIds: Array.from(pendingIds) };
  }

  const all = Promise.allSettled(tasks);
  const timed = new Promise((resolve) => setTimeout(resolve, timeoutMs, "timeout"));
  const result = await Promise.race([all, timed]);
  if (result === "timeout") {
    return { resolvedIds: Array.from(resolvedIds), pendingIds: Array.from(pendingIds) };
  }

  return { resolvedIds: Array.from(resolvedIds), pendingIds: Array.from(pendingIds) };
}

export async function fetchLatestResolvedPositionForDevice(deviceId) {
  if (!deviceId) return null;
  const dialect = resolveDialect();
  if (!dialect) {
    throw createError(500, "Cliente do banco do Traccar não suportado");
  }

  const sql = `
    SELECT
      id,
      deviceid,
      fixtime,
      latitude,
      longitude,
      full_address,
      address_status,
      address_provider,
      address_updated_at,
      address_error,
      attributes
    FROM ${POSITION_TABLE}
    WHERE deviceid = ${dialect.placeholder(1)}
      AND full_address IS NOT NULL
      AND full_address <> ''
      AND address_status = ${dialect.placeholder(2)}
    ORDER BY fixtime DESC
    LIMIT 1
  `;

  const rows = await queryTraccarDb(sql, [deviceId, ADDRESS_STATUS.RESOLVED]);
  const normalized = rows.map(normalisePositionRow).filter(Boolean);
  return normalized[0] || null;
}

export async function fetchPositionsMissingAddresses({
  lookbackMinutes = 120,
  limit = 500,
  includeFailed = true,
  includePending = true,
  includeNullStatus = true,
} = {}) {
  const dialect = resolveDialect();
  if (!dialect) {
    throw createError(500, "Cliente do banco do Traccar não suportado");
  }

  const statuses = [];
  if (includePending) statuses.push(ADDRESS_STATUS.PENDING);
  if (includeFailed) statuses.push(ADDRESS_STATUS.FAILED);

  const params = [];
  const conditions = ["(full_address IS NULL OR full_address = '')"];

  if (lookbackMinutes && Number.isFinite(Number(lookbackMinutes))) {
    const since = new Date(Date.now() - Number(lookbackMinutes) * 60_000);
    conditions.push(`fixtime >= ${dialect.placeholder(params.length + 1)}`);
    params.push(since);
  }

  if (statuses.length) {
    const placeholders = buildPlaceholders(statuses, params.length + 1);
    const statusClause = `address_status IN (${placeholders})`;
    params.push(...statuses);
    if (includeNullStatus) {
      conditions.push(`(${statusClause} OR address_status IS NULL)`);
    } else {
      conditions.push(statusClause);
    }
  } else if (includeNullStatus) {
    conditions.push("address_status IS NULL");
  }

  const sql = `
    SELECT
      id,
      deviceid,
      fixtime,
      latitude,
      longitude,
      address,
      full_address,
      address_status,
      address_provider,
      address_updated_at,
      address_error,
      attributes
    FROM ${POSITION_TABLE}
    WHERE ${conditions.join(" AND ")}
    ORDER BY fixtime DESC
    LIMIT ${Number(limit)}
  `;

  const rows = await queryTraccarDb(sql, params);
  return rows.map(normalisePositionRow).filter(Boolean);
}

export async function fetchEvents(deviceIds = [], from, to, limit = 50) {
  const filtered = Array.from(new Set((deviceIds || []).filter(Boolean)));
  if (!filtered.length) return [];

  const dialect = resolveDialect();
  if (!dialect) {
    throw createError(500, "Cliente do banco do Traccar não suportado");
  }

  const params = [];
  const placeholders = buildPlaceholders(filtered);
  const conditions = [`deviceid IN (${placeholders})`];
  params.push(...filtered);

  if (from) {
    conditions.push(`eventtime >= ${dialect.placeholder(params.length + 1)}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`eventtime <= ${dialect.placeholder(params.length + 1)}`);
    params.push(to);
  }

  const sql = `
    SELECT id, type, eventtime, deviceid, positionid, geofenceid, attributes
    FROM ${EVENT_TABLE}
    WHERE ${conditions.join(" AND ")}
    ORDER BY eventtime DESC
    LIMIT ${Number(limit) || 50}
  `;

  const rows = (await queryTraccarDb(sql, params)) || [];
  return rows.map(normaliseEventRow).filter((event) => event && event.deviceId !== null);
}

async function fetchEventsFromApi(deviceIds = [], from, to, limit = 50, context = {}) {
  const filtered = Array.from(new Set((deviceIds || []).filter(Boolean)));
  if (!filtered.length) return [];

  const params = {};
  if (filtered.length) params.deviceId = filtered;
  if (from) params.from = from;
  if (to) params.to = to;
  if (limit) params.limit = limit;

  const targetUrl = resolveTraccarApiUrl("/events", params);
  if (targetUrl) {
    logFallback("http-events", targetUrl, { deviceCount: filtered.length, ...context });
  }

  const response = await traccarProxy("get", "/events", { params, asAdmin: true });
  if (response?.ok === false) {
    const status = Number(response?.error?.code || response?.status);
    throw buildTraccarUnavailableError(
      createError(Number.isFinite(status) ? status : 503, response?.error?.message || TRACCAR_UNAVAILABLE_MESSAGE),
      { stage: "http-events", response: response?.error },
    );
  }

  const payload = Array.isArray(response) ? response : response?.events || response?.data || [];
  return payload.map(normaliseEventRow).filter(Boolean);
}

export async function fetchEventsWithFallback(deviceIds = [], from, to, limit = 50) {
  const filtered = Array.from(new Set((deviceIds || []).filter(Boolean)));
  let lastError = null;
  const dbConfigured = isTraccarDbConfigured();

  if (dbConfigured) {
    try {
      return await fetchEvents(filtered, from, to, limit);
    } catch (error) {
      lastError = error;
    }
  } else if (!filtered.length) {
    return [];
  } else {
    console.warn("[traccar-db] Banco do Traccar não configurado; usando API HTTP para eventos.");
  }

  try {
    return await fetchEventsFromApi(filtered, from, to, limit, { reason: dbConfigured ? "db-error" : "db-not-configured" });
  } catch (fallbackError) {
    if (lastError) {
      fallbackError.cause = lastError;
    }
    throw fallbackError;
  }
}

export async function fetchPositionsByIds(positionIds = []) {
  const filtered = Array.from(new Set((positionIds || []).filter(Boolean)));
  if (!filtered.length) return [];

  const dialect = resolveDialect();
  if (!dialect) {
    throw createError(500, "Cliente do banco do Traccar não suportado");
  }

  const placeholders = buildPlaceholders(filtered);
  const sql = `
    SELECT
      id,
      deviceid,
      servertime,
      devicetime,
      fixtime,
      latitude,
      longitude,
      speed,
      course,
      altitude,
      accuracy,
      valid,
      protocol,
      network,
      address,
      full_address,
      address_status,
      address_provider,
      address_updated_at,
      address_error,
      attributes
    FROM ${POSITION_TABLE}
    WHERE id IN (${placeholders})
  `;

  const rows = await queryTraccarDb(sql, filtered);
  const normalized = rows.map(normalisePositionRow).filter(Boolean);
  return decoratePositionsWithGeocode(normalized, { warm: true, priority: "by-id" });
}

export async function fetchDevicesMetadata() {
  const sql = `
    SELECT id, uniqueid, name, lastupdate, disabled, status
    FROM ${DEVICE_TABLE}
  `;

  const rows = (await queryTraccarDb(sql)) || [];
  return rows.map((row) => ({
    id: row.id,
    uniqueId: row.uniqueid ?? row.uniqueId ?? null,
    name: row.name ?? null,
    lastUpdate: normaliseDate(row.lastupdate ?? row.lastUpdate),
    disabled: Boolean(row.disabled),
    status: row.status || null,
  }));
}

export function __setTraccarDbTestOverrides(overrides = null) {
  testOverrides = overrides;
  if (!overrides) {
    dbPool = null;
  }
}

export function __resetTraccarDbForTests() {
  testOverrides = null;
  dbPool = null;
}

export { isTraccarDbConfigured };
