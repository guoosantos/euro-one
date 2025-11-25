import { normaliseJsonList } from "./report-helpers.js";

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pickNumber(values = []) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function pickSpeedKmH(entry) {
  if (!entry) return null;
  const number = Number(entry.speed ?? entry.attributes?.speed);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 3.6);
}

function pickDistanceMeters(point) {
  const candidates = [point?.totalDistance, point?.distance, point?.attributes?.totalDistance, point?.attributes?.distance];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function computeDistanceKm(points = []) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const startDistance = pickDistanceMeters(first);
  const endDistance = pickDistanceMeters(last);
  if (!Number.isFinite(startDistance) || !Number.isFinite(endDistance)) return null;
  return Math.max(0, (endDistance - startDistance) / 1000);
}

export function computeRouteSummary(payload) {
  const positions = normaliseJsonList(payload, ["positions", "route", "routes", "data", "items"]);
  const summary = payload && typeof payload === "object" ? payload.summary || {} : {};

  const startTime =
    parseDate(summary.startTime || summary.start || summary.from) ||
    parseDate(positions[0]?.fixTime || positions[0]?.deviceTime || positions[0]?.serverTime);
  const endTime =
    parseDate(summary.endTime || summary.end || summary.to) ||
    parseDate(positions[positions.length - 1]?.fixTime || positions[positions.length - 1]?.deviceTime || positions[positions.length - 1]?.serverTime);

  const durationMs = (() => {
    const provided = pickNumber([summary.durationMs, summary.duration]);
    if (Number.isFinite(provided)) return provided;
    if (startTime && endTime) return endTime.getTime() - startTime.getTime();
    return null;
  })();

  const speeds = positions
    .map((point) => pickSpeedKmH(point))
    .filter((value) => value !== null && Number.isFinite(value));

  const averageSpeed = (() => {
    if (Number.isFinite(summary.averageSpeed)) return summary.averageSpeed;
    if (!speeds.length) return null;
    const total = speeds.reduce((acc, value) => acc + value, 0);
    return Math.round(total / speeds.length);
  })();

  const maxSpeed = (() => {
    if (Number.isFinite(summary.maxSpeed)) return summary.maxSpeed;
    if (!speeds.length) return null;
    return Math.max(...speeds);
  })();

  const totalDistanceKm = (() => {
    const provided = pickNumber([summary.totalDistanceKm, summary.distanceKm]);
    if (Number.isFinite(provided)) return provided;
    const meters = pickNumber([summary.totalDistance, summary.distanceMeters, summary.distance]);
    if (Number.isFinite(meters)) return meters / 1000;
    return computeDistanceKm(positions);
  })();

  return {
    startTime: startTime ? startTime.toISOString() : null,
    endTime: endTime ? endTime.toISOString() : null,
    durationMs,
    totalDistanceKm,
    averageSpeed,
    maxSpeed,
    // Tempo parado/em movimento depende do backend Traccar expor agregados prontos.
    movementUnavailable: true,
  };
}

export function computeTripMetrics(trip) {
  if (!trip || typeof trip !== "object") return {};

  const startTime =
    parseDate(trip.startTime || trip.start || trip.from) ||
    parseDate(trip.startTime?.value || trip.startDate);
  const endTime =
    parseDate(trip.endTime || trip.end || trip.to) ||
    parseDate(trip.endTime?.value || trip.endDate);

  const durationSeconds = (() => {
    const provided = pickNumber([trip.duration, trip.durationSeconds]);
    if (Number.isFinite(provided)) return provided;
    if (startTime && endTime) return Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 1000));
    return null;
  })();

  const distanceMeters = (() => {
    const provided = pickNumber([trip.distance, trip.distanceMeters, trip.totalDistance]);
    if (Number.isFinite(provided)) return provided;
    return null;
  })();

  const averageSpeed = (() => {
    const provided = pickNumber([trip.averageSpeed]);
    if (Number.isFinite(provided)) return provided;
    if (Number.isFinite(distanceMeters) && Number.isFinite(durationSeconds) && durationSeconds > 0) {
      return Math.round((distanceMeters / 1000) / (durationSeconds / 3600));
    }
    return null;
  })();

  const maxSpeed = (() => {
    const provided = pickNumber([trip.maxSpeed, trip.topSpeed]);
    if (Number.isFinite(provided)) return provided;
    return null;
  })();

  const normalizeTime = (value) => (value ? new Date(value).toISOString() : null);

  return {
    startTime: normalizeTime(startTime) || trip.startTime || trip.start || null,
    endTime: normalizeTime(endTime) || trip.endTime || trip.end || null,
    duration: durationSeconds,
    distance: distanceMeters,
    averageSpeed,
    maxSpeed,
  };
}

export default {
  computeRouteSummary,
  computeTripMetrics,
};
