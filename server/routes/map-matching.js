import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { createTtlCache } from "../utils/ttl-cache.js";

const router = express.Router();
const cache = createTtlCache(5 * 60 * 1000);
const routeCache = createTtlCache(5 * 60 * 1000);
const DEFAULT_MAX_POINTS = 250;
const DEFAULT_CHUNK = 90;

function normalizePoint(point) {
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.lon ?? point?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const originalIndex = Number.isInteger(point?.originalIndex) ? Number(point.originalIndex) : null;
  const timestamp = Number(point?.timestamp ?? point?.t ?? point?.time ?? point?.ts) || null;
  return { lat, lng, originalIndex, timestamp };
}

function samplePoints(points = [], maxPoints = DEFAULT_MAX_POINTS) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points.filter(Boolean);
  const keep = [];
  const step = Math.ceil(points.length / maxPoints);
  for (let index = 0; index < points.length; index += step) {
    keep.push(points[index]);
  }
  if (points.length && keep[keep.length - 1] !== points[points.length - 1]) {
    keep.push(points[points.length - 1]);
  }
  return keep.filter(Boolean);
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
    throw createError(response.status, "Falha ao solicitar map matching");
  }
  const data = await response.json();
  return data;
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
    throw createError(response.status, "Falha ao solicitar rota lógica (OSRM route)");
  }
  const data = await response.json();
  return data;
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
      baseUrl = process.env.OSRM_BASE_URL || process.env.MAP_MATCH_BASE_URL || null,
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

    const sampled = samplePoints(normalized, maxPoints);
    const chunks = [];
    for (let index = 0; index < sampled.length; index += chunkSize) {
      chunks.push({ offset: index, points: sampled.slice(index, index + chunkSize) });
    }

    if (!baseUrl) {
      const fallback = { geometry: sampled, tracepoints: sampled, provider: "passthrough" };
      if (cacheKey) cache.set(cacheKey, fallback);
      return res.json(fallback);
    }

    const aggregatedGeometry = [];
    const tracepoints = Array(sampled.length).fill(null);

    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      const response = await requestOsrmMatch({ baseUrl, profile, points: chunk.points });
      const geometry = response?.matchings?.[0]?.geometry?.coordinates || [];
      aggregatedGeometry.push(...geometry);
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
      baseUrl = process.env.OSRM_BASE_URL || process.env.MAP_MATCH_BASE_URL || null,
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
      const fallback = { geometry: endpoints, provider: "passthrough" };
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
