import { matchesTenant } from "./tenancy.js";

export function toKey(value) {
  if (value === null || value === undefined) return null;
  try {
    return String(value);
  } catch (error) {
    return null;
  }
}

export function getDeviceKey(device) {
  return (
    toKey(device?.deviceId) ??
    toKey(device?.traccarId) ??
    toKey(device?.device_id) ??
    toKey(device?.id) ??
    toKey(device?.uniqueId) ??
    toKey(device?.unique_id) ??
    toKey(device?.identifier)
  );
}

function getLinkedVehicleId(entity) {
  if (!entity) return null;

  const direct = entity.vehicleId ?? entity.vehicle_id ?? null;
  const fromVehicle =
    entity.vehicle && !entity.vehicle.__synthetic
      ? entity.vehicle.id ?? entity.vehicle.vehicleId ?? entity.vehicle.vehicle_id
      : null;

  return direct ?? fromVehicle ?? null;
}

export function isLinkedToVehicle({ device, source, vehicle } = {}) {
  const fromDevice = getLinkedVehicleId(device);
  const fromSource = getLinkedVehicleId(source);
  const fromNestedDevice = Array.isArray(source?.devices)
    ? source.devices.map(getLinkedVehicleId).find(Boolean)
    : null;
  const fromVehicle =
    vehicle && !vehicle.__synthetic
      ? vehicle.id ?? vehicle.vehicleId ?? vehicle.vehicle_id
      : null;

  return Boolean(fromDevice ?? fromSource ?? fromNestedDevice ?? fromVehicle);
}

export function matchesAnyTenant(entry, tenantIds) {
  if (!Array.isArray(tenantIds) || tenantIds.length === 0) return true;
  return tenantIds.some(
    (tenantId) =>
      matchesTenant(entry?.device, tenantId) ||
      matchesTenant(entry?.vehicle, tenantId) ||
      matchesTenant(entry?.source, tenantId),
  );
}

export function pickCoordinate(values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

export function pickSpeed(position) {
  const candidates = [position?.speed, position?.attributes?.speed];
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number)) {
      return Math.round(number * 3.6);
    }
  }
  return null;
}

export function getIgnition(position, device) {
  const attributes = position?.attributes || {};
  const deviceAttributes = device?.attributes || {};
  const candidates = [
    attributes.ignition,
    attributes.acc,
    attributes.ign,
    attributes.io1,
    attributes.di1,
    attributes.digitalInput1,
    attributes.digitalInput,
    attributes.input1,
    position?.ignition,
    deviceAttributes.ignition,
    deviceAttributes.acc,
    deviceAttributes.ign,
  ];

  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
  }

  return null;
}

export function getLastUpdate(position) {
  if (!position) return null;
  const candidates = [
    position.serverTime,
    position.time,
    position.fixTime,
    position.server_time,
    position.fixtime,
    position.lastUpdate,
    position.deviceTime,
  ];

  for (const value of candidates) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }

  return null;
}

function parseTimestamp(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function resolveEventSeverity(position) {
  if (!position) return null;
  const attributes = position?.attributes || {};
  return (
    position?.eventSeverity ||
    position?.criticality ||
    position?.severity ||
    attributes?.eventSeverity ||
    attributes?.criticality ||
    attributes?.severity ||
    null
  );
}

export function resolveEventActive(position) {
  if (!position) return null;
  const attributes = position?.attributes || {};
  if (position?.eventActive === false || attributes?.eventActive === false) return false;
  if (position?.eventActive === true || attributes?.eventActive === true) return true;
  return null;
}

export function getEventTime(position) {
  if (!position) return null;
  const attributes = position?.attributes || {};
  const candidates = [
    position?.eventTime,
    position?.eventTimestamp,
    position?.eventDate,
    attributes?.eventTime,
    attributes?.eventTimestamp,
    attributes?.eventDate,
    attributes?.event_time,
    attributes?.event_datetime,
  ];
  for (const value of candidates) {
    const parsed = parseTimestamp(value);
    if (parsed) return parsed;
  }
  return getLastUpdate(position);
}

export function isCriticalSeverity(severity) {
  if (!severity) return false;
  const normalized = String(severity).trim().toLowerCase();
  return ["grave", "critica", "crítica", "critico", "crítico", "critical"].includes(normalized);
}

export function hasRecentCriticalAlert(position, windowHours = 5) {
  if (!position) return false;
  if (!isCriticalSeverity(resolveEventSeverity(position))) return false;
  const active = resolveEventActive(position);
  if (active === false) return false;
  const eventTime = getEventTime(position);
  if (!eventTime) return false;
  const diffMs = Date.now() - eventTime.getTime();
  return diffMs >= 0 && diffMs <= windowHours * 60 * 60 * 1000;
}

export function formatDateTime(value, locale) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "—";
  }
  try {
    return value.toLocaleString(locale ?? undefined);
  } catch (error) {
    return value.toISOString();
  }
}

export function isOnline(position, offlineThresholdMinutes = 5) {
  const lastUpdate = getLastUpdate(position);
  if (!lastUpdate) return false;
  const diffMinutes = (Date.now() - lastUpdate.getTime()) / 1000 / 60;
  return diffMinutes <= offlineThresholdMinutes;
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return "";
}

function pickFirstString(sources, keys) {
  const list = Array.isArray(sources) ? sources : [sources];
  for (const source of list) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      const candidate = normalizeText(source[key]);
      if (candidate) return candidate;
    }
  }
  return "";
}

function isLikelyInternalCode(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (text.includes(" ")) return false;
  if (text.length > 6) return false;
  const hasLetters = /[A-Za-z]/.test(text);
  const hasDigits = /\d/.test(text);
  return hasLetters && hasDigits;
}

export function resolveVehicleInfo({ vehicle, device, attributes } = {}) {
  const vehicleRecord = vehicle || {};
  const deviceRecord = device || {};
  const attributeRecord = attributes || {};
  const sources = [
    vehicleRecord,
    vehicleRecord.vehicle,
    vehicleRecord.attributes,
    deviceRecord.vehicle,
    deviceRecord,
    deviceRecord.attributes,
    attributeRecord,
  ];

  const brand = pickFirstString(sources, ["brand", "marca", "make", "manufacturer", "fabricante"]);
  const model = pickFirstString(sources, ["model", "modelo", "modelName", "model_name", "vehicleModel"]);
  const description = pickFirstString(sources, [
    "description",
    "makeModel",
    "make_model",
    "modelDescription",
    "vehicleDescription",
  ]);
  const item = pickFirstString(sources, ["item", "vehicleName", "name", "label"]);
  const plate = pickFirstString(sources, ["plate", "registrationNumber", "placa"]);
  const deviceModel = pickFirstString([deviceRecord, deviceRecord.attributes], [
    "model",
    "modelName",
    "model_name",
    "deviceModel",
  ]);

  return {
    brand: brand || null,
    model: model || null,
    description: description || null,
    item: item || null,
    plate: plate || null,
    deviceModel: deviceModel || null,
  };
}

export function resolveVehicleDisplayName(info = {}) {
  const brand = normalizeText(info.brand);
  const model = normalizeText(info.model);
  const description = normalizeText(info.description);
  const item = normalizeText(info.item);
  const deviceModel = normalizeText(info.deviceModel);
  const plate = normalizeText(info.plate);
  const modelIsCode = isLikelyInternalCode(model);

  if (brand && model) {
    const modelLower = model.toLowerCase();
    const brandLower = brand.toLowerCase();
    if (modelLower.includes(brandLower)) {
      return model;
    }
    if (modelIsCode && description) {
      return description;
    }
    return `${brand} ${model}`.trim();
  }

  if (description) return description;

  if (brand) return brand;

  if (model && !modelIsCode) return model;

  if (item && item.toLowerCase() !== plate.toLowerCase()) return item;

  if (deviceModel && !isLikelyInternalCode(deviceModel)) return deviceModel;

  return "—";
}

export function deriveStatus(position) {
  if (!position) return "offline";
  if (!isOnline(position)) return "offline";
  if (position?.attributes?.blocked || position?.blocked) return "blocked";
  if (position?.attributes?.alarm || position?.alarm) return "alert";
  return "online";
}

export function getLastActivity(position, device) {
  const byPosition = getLastUpdate(position);
  if (byPosition) return byPosition;

  const candidates = [
    device?.lastUpdate,
    device?.lastPositionTime,
    device?.lastCommunication,
    device?.lastUpdateTime,
  ];

  for (const value of candidates) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }

  return null;
}

export function minutesSince(date) {
  if (!(date instanceof Date)) return Infinity;
  return (Date.now() - date.getTime()) / 1000 / 60;
}

export function distanceInKm(a, b) {
  if (!a || !b) return Infinity;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng), 1);
  return R * c;
}

export default {
  toKey,
  getDeviceKey,
  pickCoordinate,
  pickSpeed,
  getIgnition,
  getLastUpdate,
  getLastActivity,
  formatDateTime,
  isOnline,
  deriveStatus,
  minutesSince,
  distanceInKm,
};
