import { matchesTenant } from "./tenancy";
import { formatAddress } from "./format-address.js";

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutos
const ALERT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hora

const TRUE_VALUES = new Set(["true", "1", "on", "yes", "sim"]);
const FALSE_VALUES = new Set(["false", "0", "off", "no", "não", "nao"]);

export function buildFleetState(devices = [], positions = [], { tenantId } = {}) {
  const filteredDevices = Array.isArray(devices)
    ? devices.filter((device) => matchesTenant(device, tenantId))
    : [];
  const filteredPositions = Array.isArray(positions)
    ? positions.filter((position) => matchesTenant(position, tenantId))
    : [];

  const now = Date.now();
  const stats = { total: 0, online: 0, alert: 0, offline: 0, blocked: 0 };
  const rows = [];

  const positionByDevice = new Map();
  for (const position of filteredPositions) {
    const key = toKey(
      position?.deviceId ??
        position?.device?.id ??
        position?.uniqueId ??
        position?.id,
    );
    if (!key) continue;
    positionByDevice.set(key, position);
  }

  const seen = new Set();

  for (const device of filteredDevices) {
    const key = toKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.name);
    if (!key || seen.has(key)) continue;
    const position = positionByDevice.get(key) ?? null;
    const row = buildRow(key, device, position, now);
    rows.push(row);
    accumulate(stats, row.status);
    seen.add(key);
  }

  for (const [key, position] of positionByDevice.entries()) {
    if (seen.has(key)) continue;
    const row = buildRow(key, null, position, now);
    rows.push(row);
    accumulate(stats, row.status);
    seen.add(key);
  }

  stats.total = rows.length;
  return { rows, stats };
}

export function parsePositionTime(position) {
  if (!position) return null;
  const value =
    position.fixTime ||
    position.deviceTime ||
    position.serverTime ||
    position.timestamp ||
    position.time;
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

/**
 * Helper genérico para formatar datas em texto.
 * Usado pelas telas (ex: Tasks) para exibir datas de forma consistente.
 */
export function formatDate(value, locale = "pt-BR", extraOptions = {}) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    // se não for uma data válida, devolve o valor original como string
    return String(value);
  }

  const baseOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };

  const options = { ...baseOptions, ...extraOptions };

  try {
    return new Intl.DateTimeFormat(locale, options).format(d);
  } catch {
    // fallback bem defensivo
    return d.toISOString();
  }
}

function buildRow(key, device, position, now) {
  const attributes = position?.attributes ?? {};
  const timestamp = parsePositionTime(position);
  const lat = coerceNumber(position?.latitude ?? position?.lat);
  const lng = coerceNumber(position?.longitude ?? position?.lon);
  const status = resolveStatus(device, timestamp, now);

  return {
    id: key,
    device,
    position,
    status,
    name: device?.name ?? position?.deviceName ?? `Dispositivo ${key}`,
    plate:
      device?.plate ??
      device?.vehiclePlate ??
      device?.attributes?.plate ??
      attributes?.plate ??
      device?.uniqueId ??
      key,
    lastUpdate: timestamp ? new Date(timestamp).toISOString() : null,
    address: formatAddress(position?.shortAddress || position?.formattedAddress || position?.address || device?.address || ""),
    speed: coerceSpeed(position?.speed),
    ignition: coerceBoolean(attributes, ["ignition", "acc", "switchOn", "ign"], null),
    battery: coerceNumberAttribute(attributes, ["batteryLevel", "battery", "batteryPercent", "power"]),
    signal: coerceNumberAttribute(attributes, ["rssi", "csq", "signalStrength", "gsm", "signal"]),
    alerts: normaliseAlerts(attributes),
    lat,
    lng,
  };
}

function resolveStatus(device, timestamp, now) {
  const deviceStatus = String(device?.status ?? "").toLowerCase();
  if (deviceStatus.includes("block")) return "blocked";
  if (deviceStatus.includes("bloque")) return "blocked";
  if (deviceStatus.includes("disable")) return "blocked";
  if (deviceStatus.includes("offline")) return "offline";

  if (!timestamp) return "offline";
  const age = now - timestamp;
  if (age <= ONLINE_THRESHOLD_MS) return "online";
  if (age <= ALERT_THRESHOLD_MS) return "alert";
  return "offline";
}

function accumulate(stats, status) {
  if (status === "blocked") {
    stats.blocked += 1;
    return;
  }
  if (status === "online") {
    stats.online += 1;
    return;
  }
  if (status === "alert") {
    stats.alert += 1;
    return;
  }
  stats.offline += 1;
}

function coerceNumber(value) {
  if (value === null || value === undefined) return undefined;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function coerceSpeed(speedKnots) {
  if (!Number.isFinite(speedKnots)) return null;
  const kmh = speedKnots * 1.852;
  const rounded = Math.round(kmh * 10) / 10;
  return Number.isFinite(rounded) ? rounded : null;
}

function coerceBoolean(attributes, keys, fallback = null) {
  for (const key of keys) {
    if (!(key in attributes)) continue;
    const value = attributes[key];
    if (typeof value === "boolean") return value;
    if (value === null || value === undefined) continue;
    const normalized = String(value).toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
  }
  return fallback;
}

function coerceNumberAttribute(attributes, keys) {
  for (const key of keys) {
    if (!(key in attributes)) continue;
    const value = attributes[key];
    if (typeof value === "number") return value;
    if (value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normaliseAlerts(attributes) {
  if (!attributes) return [];
  const alarm = attributes.alarm ?? attributes.alarms;
  if (!alarm) return [];
  if (Array.isArray(alarm)) return alarm.map(String).filter(Boolean);
  if (typeof alarm === "string") {
    return alarm
      .split(/[,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof alarm === "object") {
    return Object.entries(alarm)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key);
  }
  return [];
}

function toKey(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}
