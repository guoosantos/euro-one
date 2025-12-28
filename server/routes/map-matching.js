import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { config } from "../config.js";
import { createTtlCache } from "../utils/ttl-cache.js";

const router = express.Router();
const cache = createTtlCache(5 * 60 * 1000);
const routeCache = createTtlCache(5 * 60 * 1000);
const DEFAULT_MAX_POINTS = 250;
const DEFAULT_CHUNK = 90;
const MAX_CHUNK = 100;
const DEFAULT_MIN_DISTANCE = 25;
const DEFAULT_BEARING_DELTA = 35;
let loggedMissingOsrm = false;

function normalizePoint(point) {
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.lon ?? point?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const originalIndex = Number.isInteger(point?.originalIndex) ? Number(point.originalIndex) : null;
  const timestamp = Number(point?.timestamp ?? point?.t ?? point?.time ?? point?.ts) || null;
  const heading = Number(point?.heading ?? point?.course ?? point?.attributes?.course ?? point?.attributes?.heading);
  const ignition =
    typeof point?.ignition === "boolean"
      ? point.ignition
      : typeof point?.attributes?.ignition === "boolean"
        ? point.attributes.ignition
        : null;
  const motion =
    typeof point?.motion === "boolean"
      ? point.motion
      : typeof point?.attributes?.motion === "boolean"
        ? point.attributes.motion
        : null;
  const eventKey =
    point?.event ||
    point?.type ||
    point?.label ||
    point?.attributes?.event ||
    point?.attributes?.alarm ||
    null;
  return { lat, lng, originalIndex, timestamp, heading, ignition, motion, eventKey };
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineDistance(a, b) {
  if (!a || !b) return Number.NaN;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(b.lng - a.lng);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const base = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const distance = 2 * Math.atan2(Math.sqrt(base), Math.sqrt(1 - base));
  return 6371000 * distance;
}

function computeBearing(a, b) {
  if (!a || !b) return null;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

function bearingDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function isEventPoint(point, previous) {
  if (!point) return false;
  if (point.eventKey) return true;
  if (typeof point.ignition === "boolean" && point.ignition !== previous?.ignition) return true;
  if (typeof point.motion === "boolean" && point.motion !== previous?.motion) return true;
  return false;
}

function samplePoints(
  points = [],
  {
    maxPoints = DEFAULT_MAX_POINTS,
    minDistanceMeters = DEFAULT_MIN_DISTANCE,
    bearingDeltaThreshold = DEFAULT_BEARING_DELTA,
  } = {},
) {
  if (!Array.isArray(points) || points.length <= 2) return points.filter(Boolean);

  const filtered = [];
  const priorityIndexes = new Set();
  let lastKept = null;
  let lastBearing = null;

  points.forEach((point, index) => {
    if (!point) return;
    const isFirst = index === 0;
    const isLast = index === points.length - 1;
    const hasEvent = isEventPoint(point, lastKept);
    let keep = isFirst || isLast || hasEvent;

    if (!keep && lastKept) {
      const distance = haversineDistance(lastKept, point);
      if (Number.isFinite(distance) && distance >= minDistanceMeters) {
        keep = true;
      }
    }

    if (!keep && lastKept) {
      const bearing = computeBearing(lastKept, point);
      if (Number.isFinite(bearing) && bearingDelta(lastBearing ?? bearing, bearing) >= bearingDeltaThreshold) {
        keep = true;
      }
    }

    if (keep) {
      filtered.push(point);
      if (hasEvent) {
        priorityIndexes.add(filtered.length - 1);
      }
      const referenceBearing = Number.isFinite(point.heading)
        ? point.heading
        : lastKept
          ? computeBearing(lastKept, point)
          : null;
      if (Number.isFinite(referenceBearing)) {
        lastBearing = referenceBearing;
      }
      lastKept = point;
    }
  });

  if (filtered.length <= maxPoints) return filtered;

  const keepIndexes = new Set([0, filtered.length - 1, ...priorityIndexes]);
  const remaining = [];
  for (let index = 1; index < filtered.length - 1; index += 1) {
    if (!keepIndexes.has(index)) remaining.push(index);
  }

  const available = Math.max(0, maxPoints - keepIndexes.size);
  const step = Math.max(1, Math.ceil(remaining.length / Math.max(1, available)));
  remaining.forEach((index, idx) => {
    if (keepIndexes.size < maxPoints && idx % step === 0) {
      keepIndexes.add(index);
    }
  });

  return filtered.filter((_point, index) => keepIndexes.has(index));
}

function mergeGeometry(aggregated, nextChunk = []) {
  if (!Array.isArray(nextChunk) || nextChunk.length === 0) return aggregated;
  if (!Array.isArray(aggregated) || aggregated.length === 0) return [...nextChunk];
  const last = aggregated[aggregated.length - 1];
  const first = nextChunk[0];
  const lastLat = Number(last?.[1]);
  const lastLng = Number(last?.[0]);
  const firstLat = Number(first?.[1]);
  const firstLng = Number(first?.[0]);
  const isDuplicate =
    Number.isFinite(lastLat) &&
    Number.isFinite(lastLng) &&
    Number.isFinite(firstLat) &&
    Number.isFinite(firstLng) &&
    Math.abs(lastLat - firstLat) < 1e-6 &&
    Math.abs(lastLng - firstLng) < 1e-6;
  return isDuplicate ? [...aggregated, ...nextChunk.slice(1)] : [...aggregated, ...nextChunk];
}

async function requestOsrmMatch({ baseUrl, profile = "driving", points = [] }) {
  if (!baseUrl) return null;
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw createError(400, "Configuração OSRM inválida");
  }

  const sanitizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  const coords = points.map((point) => `${point.lng},${point.lat}`).join(";");
  const timestamps = points
    .map((point) => (Number.isFinite(point.timestamp) ? Math.floor(point.timestamp / 1000) : null))
    .map((value) => (value === null ? "" : value))
    .join(";");
  let url;
  try {
    url = new URL(`${sanitizedBaseUrl}/match/v1/${profile}/${coords}`);
  } catch (error) {
    throw createError(400, "Configuração OSRM inválida");
  }
  url.searchParams.set("annotations", "false");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  if (timestamps.trim()) {
    url.searchParams.set("timestamps", timestamps);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.text();
    } catch (_error) {
      payload = null;
    }
    console.warn("[map-matching] Falha ao solicitar OSRM /match", {
      status: response.status,
      payload,
    });
    throw createError(response.status, "Falha ao solicitar map matching");
  }
  return response.json();
}

async function requestOsrmRoute({ baseUrl, profile = "driving", points = [] }) {
  if (!baseUrl) return null;
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw createError(400, "Configuração OSRM inválida");
  }
  const sanitizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  const [start, end] = points;
  const coords = `${start.lng},${start.lat};${end.lng},${end.lat}`;
  let url;
  try {
    url = new URL(`${sanitizedBaseUrl}/route/v1/${profile}/${coords}`);
  } catch (error) {
    throw createError(400, "Configuração OSRM inválida");
  }
  url.searchParams.set("annotations", "false");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");

  const response = await fetch(url.toString());
  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.text();
    } catch (_error) {
      payload = null;
    }
    console.warn("[map-matching] Falha ao solicitar OSRM /route", {
      status: response.status,
      payload,
    });
    throw createError(response.status, "Falha ao solicitar rota lógica (OSRM route)");
  }
  return response.json();
}

router.use(authenticate);

router.post("/map-matching", async (req, res, next) => {
  try {
    const {
      points: rawPoints = [],
      cacheKey = null,
      maxPoints = DEFAULT_MAX_POINTS,
      chunkSize = DEFAULT_CHUNK,
      profile = "driving",
      minDistanceMeters = DEFAULT_MIN_DISTANCE,
      bearingDeltaThreshold = DEFAULT_BEARING_DELTA,
      baseUrl = config.osrm?.baseUrl || process.env.OSRM_BASE_URL || process.env.MAP_MATCH_BASE_URL || null,
    } = req.body || {};

    const normalized = Array.isArray(rawPoints) ? rawPoints.map(normalizePoint).filter(Boolean) : [];
    if (normalized.length < 2) {
      return res.json({ geometry: normalized, tracepoints: normalized, provider: "passthrough" });
    }

    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return res.json({ ...cached, cached: true });
      }
    }

    const sampled = samplePoints(normalized, { maxPoints, minDistanceMeters, bearingDeltaThreshold });
    const safeChunkSize = Math.max(2, Math.min(Number(chunkSize) || DEFAULT_CHUNK, MAX_CHUNK));
    const chunks = [];
    for (let index = 0; index < sampled.length; index += safeChunkSize) {
      chunks.push({ offset: index, points: sampled.slice(index, index + safeChunkSize) });
    }

    if (!baseUrl) {
      if (!loggedMissingOsrm) {
        loggedMissingOsrm = true;
        console.warn("[map-matching] OSRM_BASE_URL não configurado -> sem map matching.");
      }
      const fallback = {
        geometry: sampled,
        tracepoints: sampled,
        provider: "passthrough",
        notice: "OSRM não configurado -> sem map matching.",
      };
      if (cacheKey) cache.set(cacheKey, fallback);
      return res.json(fallback);
    }

    let aggregatedGeometry = [];
    const tracepoints = Array(sampled.length).fill(null);

    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      const response = await requestOsrmMatch({ baseUrl, profile, points: chunk.points });
      const geometry = response?.matchings?.[0]?.geometry?.coordinates || [];
      aggregatedGeometry = mergeGeometry(aggregatedGeometry, geometry);
      const matchedTracepoints = response?.tracepoints || [];
      matchedTracepoints.forEach((point, index) => {
        const lat = Number(point?.location?.[1]);
        const lng = Number(point?.location?.[0]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const targetIndex = chunk.offset + index;
        tracepoints[targetIndex] = { lat, lng, originalIndex: sampled[targetIndex]?.originalIndex ?? targetIndex };
      });
    }

    const geometry = aggregatedGeometry
      .map((pair) => ({ lng: Number(pair?.[0]), lat: Number(pair?.[1]) }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    const resolved = {
      geometry,
      tracepoints: tracepoints.filter(Boolean),
      provider: "osrm",
      matched: true,
      originalPoints: normalized.length,
      sampledPoints: sampled.length,
      chunkSize: safeChunkSize,
    };
    if (cacheKey) cache.set(cacheKey, resolved);
    return res.json(resolved);
  } catch (error) {
    return next(error);
  }
});

router.post("/map-route", async (req, res, next) => {
  try {
    const {
      points: rawPoints = [],
      cacheKey = null,
      profile = "driving",
      baseUrl = config.osrm?.baseUrl || process.env.OSRM_BASE_URL || process.env.MAP_MATCH_BASE_URL || null,
    } = req.body || {};

    const normalized = Array.isArray(rawPoints) ? rawPoints.map(normalizePoint).filter(Boolean) : [];
    const endpoints = normalized.length >= 2 ? [normalized[0], normalized[normalized.length - 1]] : normalized;

    if (endpoints.length < 2) {
      return res.json({ geometry: endpoints, provider: "passthrough" });
    }

    if (cacheKey) {
      const cached = routeCache.get(cacheKey);
      if (cached) {
        return res.json({ ...cached, cached: true });
      }
    }

    if (!baseUrl) {
      if (!loggedMissingOsrm) {
        loggedMissingOsrm = true;
        console.warn("[map-matching] OSRM_BASE_URL não configurado -> sem map matching.");
      }
      const fallback = { geometry: endpoints, provider: "passthrough", notice: "OSRM não configurado -> sem map matching." };
      if (cacheKey) routeCache.set(cacheKey, fallback);
      return res.json(fallback);
    }

    const response = await requestOsrmRoute({ baseUrl, profile, points: endpoints });
    const route = response?.routes?.[0];
    const geometry = (route?.geometry?.coordinates || [])
      .map((pair) => ({ lng: Number(pair?.[0]), lat: Number(pair?.[1]) }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    const payload = {
      geometry: geometry.length ? geometry : endpoints,
      provider: "osrm-route",
      distance: Number.isFinite(route?.distance) ? route.distance : undefined,
      duration: Number.isFinite(route?.duration) ? route.duration : undefined,
    };

    if (cacheKey) routeCache.set(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
