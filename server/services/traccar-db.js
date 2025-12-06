// Este módulo é a FONTE PRINCIPAL de telemetria do Traccar no Euro One.
// Utilize as funções abaixo para ler posições, eventos e viagens diretamente do banco do Traccar.
// A API HTTP do Traccar fica reservada para comandos e operações administrativas.
import createError from "http-errors";

import { config } from "../config.js";
import { buildTraccarUnavailableError } from "./traccar.js";

const TRACCAR_UNAVAILABLE_MESSAGE = "Banco do Traccar indisponível";
const POSITION_TABLE = "tc_positions";
const EVENT_TABLE = "tc_events";
const DEVICE_TABLE = "tc_devices";

let dbPool = null;
let testOverrides = null;

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

function normalisePositionRow(row) {
  if (!row) return null;
  const attributes = parseJson(row.attributes);
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
    address: row.address ? String(row.address) : "",
    attributes,
  };
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
      time: start.fixTime || start.serverTime || start.deviceTime,
      latitude: start.latitude,
      longitude: start.longitude,
      address: start.address || {},
    },
    end: {
      time: end.fixTime || end.serverTime || end.deviceTime,
      latitude: end.latitude,
      longitude: end.longitude,
      address: end.address || {},
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
    SELECT id, deviceid, servertime, devicetime, fixtime, latitude, longitude, speed, course, address, attributes
    FROM ${POSITION_TABLE}
    WHERE deviceid = ${dialect.placeholder(1)}
      AND fixtime BETWEEN ${dialect.placeholder(2)} AND ${dialect.placeholder(3)}
    ORDER BY fixtime ASC
  `;

  const rows = await queryTraccarDb(sql, [deviceId, from, to]);
  return buildTripsFromPositions(rows);
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
      latest.address,
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

  const rows = await queryTraccarDb(sql, params);
  return rows
    .map(normalisePositionRow)
    .filter((position) => position && position.deviceId !== null && position.fixTime);
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
    SELECT id, type, eventtime, servertime, deviceid, positionid, geofenceid, attributes
    FROM ${EVENT_TABLE}
    WHERE ${conditions.join(" AND ")}
    ORDER BY eventtime DESC
    LIMIT ${Number(limit) || 50}
  `;

  const rows = await queryTraccarDb(sql, params);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    eventTime: normaliseDate(row.eventtime ?? row.eventTime),
    serverTime: normaliseDate(row.servertime ?? row.serverTime),
    deviceId: row.deviceid ?? row.deviceId ?? null,
    positionId: row.positionid ?? row.positionId ?? null,
    geofenceId: row.geofenceid ?? row.geofenceId ?? null,
    attributes: parseJson(row.attributes),
  }));
}

export async function fetchDevicesMetadata() {
  const sql = `
    SELECT id, uniqueid, name, lastupdate, disabled, status
    FROM ${DEVICE_TABLE}
  `;

  const rows = await queryTraccarDb(sql);
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
