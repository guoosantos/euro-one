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
  const candidates = [position?.attributes?.ignition, position?.ignition, device?.attributes?.ignition];

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
