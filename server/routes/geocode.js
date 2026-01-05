import express from "express";
import createError from "http-errors";

import { createTtlCache } from "../utils/ttl-cache.js";
import { config } from "../config.js";
import {
  formatAddress,
  getCachedGeocode,
} from "../utils/address.js";
import { enqueueGeocodeJob } from "../jobs/geocode.queue.js";

const router = express.Router();

const DEFAULT_GEOCODER_URL = "https://nominatim.openstreetmap.org";
const GEOCODER_BASE_URL = config.geocoder?.baseUrl || DEFAULT_GEOCODER_URL;
const cache = createTtlCache(10 * 60 * 1000);
const reverseCache = createTtlCache(30 * 60 * 1000);
const pending = new Map();

function sanitizeTerm(term) {
  if (typeof term !== "string") return "";
  return term.replace(/\s+/g, " ").trim();
}

function buildGeocoderUrl(pathname = "search") {
  try {
    const url = new URL(GEOCODER_BASE_URL);
    const basePath = url.pathname.replace(/\/+$/, "");
    const targetPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    if (basePath.toLowerCase().endsWith(`/${targetPath.toLowerCase()}`)) {
      url.pathname = basePath;
    } else {
      url.pathname = `${basePath}/${targetPath}`.replace(/\/{2,}/g, "/");
    }
    return url;
  } catch (_error) {
    const fallback = new URL(DEFAULT_GEOCODER_URL);
    fallback.pathname = `${fallback.pathname.replace(/\/+$/, "")}/${pathname}`;
    return fallback;
  }
}

function normalizeResult(item, fallbackLabel) {
  const lat = Number(item?.lat);
  const lng = Number(item?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const address = item?.address || {};
  const conciseAddress = [
    address.road,
    address.neighbourhood,
    address.city || address.town || address.village,
    address.state,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    id: String(item?.place_id ?? `${lat},${lng}`),
    lat,
    lng,
    label: item?.display_name || fallbackLabel,
    concise: conciseAddress || formatAddress(item?.display_name || fallbackLabel),
    boundingBox: item?.boundingbox,
    raw: item,
  };
}

function buildReverseKey(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function normalizeResponse(entry, status = "ok") {
  const toString = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    return String(value);
  };

  if (!entry) {
    return { shortAddress: "", formattedAddress: "", address: "", status };
  }

  return {
    ...entry,
    address: toString(entry.address),
    formattedAddress: toString(entry.formattedAddress || entry.address),
    shortAddress: toString(entry.shortAddress || entry.formattedAddress || entry.address),
    geocodeStatus: status,
    geocodedAt: entry.geocodedAt || null,
    status,
  };
}

async function queryProvider(term, limit = 5) {
  const url = buildGeocoderUrl("search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", term);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("polygon_geojson", "0");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Euro-One Monitoring Server",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const err = createError(response.status, "Falha ao buscar endereços");
    throw err;
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

router.get("/geocode/search", async (req, res) => {
  const query = sanitizeTerm(req.query.q ?? req.query.query ?? "");
  if (!query || query.length < 3) {
    return res.json({ data: [] });
  }

  const limit = Math.max(1, Math.min(Number(req.query.limit) || 5, 10));
  const cacheKey = `${query.toLowerCase()}|${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ data: cached });
  }

  if (pending.has(cacheKey)) {
    const shared = await pending.get(cacheKey).catch(() => []);
    return res.json({ data: shared });
  }

  const promise = (async () => {
    const rawResults = await queryProvider(query, limit);
    const normalized = rawResults
      .map((item) => normalizeResult(item, query))
      .filter(Boolean)
      .slice(0, limit);
    cache.set(cacheKey, normalized);
    return normalized;
  })();

  pending.set(cacheKey, promise);

  try {
    const results = await promise;
    return res.json({ data: results, status: "ok" });
  } catch (error) {
    const message =
      error?.status === 429
        ? "Limite de consultas atingido. Tente novamente em instantes."
        : "Não foi possível buscar endereços agora. Tente novamente em instantes.";
    return res.status(200).json({
      data: [],
      status: "fallback",
      error: { message, reason: error?.message || String(error), code: error?.status },
    });
  } finally {
    pending.delete(cacheKey);
  }
});

router.get("/geocode/reverse", async (req, res) => {
  const lat = Number(req.query.lat ?? req.query.latitude);
  const lng = Number(req.query.lng ?? req.query.lon ?? req.query.longitude);
  const force = ["1", "true"].includes(String(req.query?.force ?? "").toLowerCase());

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: { message: "Coordenadas inválidas." } });
  }

  const key = buildReverseKey(lat, lng);
  const cached = !force && key ? reverseCache.get(key) : null;
  if (cached?.status === "ok") {
    return res.json(cached);
  }

  const persisted = getCachedGeocode(lat, lng);
  if (persisted) {
    const payload = normalizeResponse({ ...persisted, cached: true, source: "geocodeCache" }, "ok");
    if (key) reverseCache.set(key, payload);
    return res.json(payload);
  }

  const reason = typeof req.query?.reason === "string" ? req.query.reason : "user_action";
  const priority = req.query?.priority === "high" ? "high" : "normal";
  let enqueued = null;
  try {
    enqueued = await enqueueGeocodeJob({
      lat,
      lng,
      positionId: req.query?.positionId || null,
      deviceId: req.query?.deviceId || null,
      priority,
      reason,
    });
  } catch (error) {
    console.warn("[geocode:reverse] Falha ao enfileirar geocode", error?.message || error);
  }

  const responsePayload = normalizeResponse(
    {
      lat,
      lng,
      queued: Boolean(enqueued),
      jobId: enqueued?.id || null,
      gridKey: enqueued?.data?.gridKey,
      geocodeStatus: enqueued ? "pending" : "fallback",
    },
    enqueued ? "pending" : "fallback",
  );
  return res.json(responsePayload);
});

export default router;
