import express from "express";
import createError from "http-errors";

import { createTtlCache } from "../utils/ttl-cache.js";
import { config } from "../config.js";
import {
  formatAddress,
  formatShortAddressFromParts,
  getCachedGeocode,
  persistGeocode,
  resolveShortAddress,
} from "../utils/address.js";

const router = express.Router();

const DEFAULT_GEOCODER_URL = "https://nominatim.openstreetmap.org";
const GEOCODER_BASE_URL = config.geocoder?.baseUrl || DEFAULT_GEOCODER_URL;
const cache = createTtlCache(10 * 60 * 1000);
const reverseCache = createTtlCache(30 * 60 * 1000);
const pending = new Map();
const reversePending = new Map();
const RETRY_DELAYS_MS = [300, 800, 1500];

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

function buildShortAddress(payload) {
  const details = payload?.address || {};
  const formatted = formatShortAddressFromParts({
    ...details,
    country: details.country || payload?.address?.country,
    stateCode: details.state_code || details.stateCode,
  });
  return formatted || formatAddress(payload?.display_name || "");
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
    status,
  };
}

async function fetchReverse(lat, lng) {
  const url = buildGeocoderUrl("reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Euro-One Monitoring Server",
      Accept: "application/json",
    },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const error = createError(response.status, "Falha ao buscar endereço reverso");
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function fetchReverseWithRetry(lat, lng) {
  let lastError;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchReverse(lat, lng);
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.statusCode;
      if (status !== 429 && status !== 503) {
        throw error;
      }
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || createError(502, "Falha ao buscar endereço reverso");
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
    return res
      .status(200)
      .json({ data: [], status: "fallback", error: { message, reason: error?.message, code: error?.status } });
  } finally {
    pending.delete(cacheKey);
  }
});

router.get("/geocode/reverse", async (req, res) => {
  const lat = Number(req.query.lat ?? req.query.latitude);
  const lng = Number(req.query.lng ?? req.query.lon ?? req.query.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: { message: "Coordenadas inválidas." } });
  }

  const key = buildReverseKey(lat, lng);
  const cached = key ? reverseCache.get(key) : null;
  if (cached) {
    return res.json(normalizeResponse({ ...cached, cached: true }, cached.shortAddress ? "ok" : "pending"));
  }

  const persisted = getCachedGeocode(lat, lng);
  if (persisted) {
    const payload = normalizeResponse({ ...persisted, cached: true, source: "geocodeCache" }, "ok");
    if (key) reverseCache.set(key, payload);
    return res.json(payload);
  }

  if (key && reversePending.has(key)) {
    const shared = await reversePending.get(key).catch(() => null);
    if (shared) return res.json(shared);
  }

  const promise = (async () => {
    try {
      const payload = await fetchReverseWithRetry(lat, lng);
      const shortAddress = buildShortAddress(payload);
      const formattedAddress = formatAddress(payload?.display_name || shortAddress);
      const resolved = {
        lat,
        lng,
        address: payload?.display_name || shortAddress || null,
        formattedAddress,
        shortAddress,
      };
      const entry = await persistGeocode(lat, lng, {
        address: payload?.display_name || shortAddress || null,
        formattedAddress,
        shortAddress,
        addressParts: payload?.address || payload?.addressdetails || payload?.address_details,
        updatedAt: new Date().toISOString(),
      });
      if (key) reverseCache.set(key, entry || resolved);
      return entry || resolved;
    } catch (error) {
      console.warn("[geocode:reverse] Falha ao resolver endereço", {
        status: error?.status || error?.statusCode,
        message: error?.message,
        payload: error?.payload,
      });
      return null;
    } finally {
      if (key) reversePending.delete(key);
    }
  })();

  if (key) reversePending.set(key, promise);

  const resolved = await promise;
  if (!resolved) {
    const fallback = await resolveShortAddress(lat, lng);
    if (fallback) {
      const payload = normalizeResponse(
        {
          lat,
          lng,
          address: fallback.address || fallback.formattedAddress || fallback.shortAddress,
          formattedAddress: fallback.formattedAddress || fallback.address || fallback.shortAddress,
          shortAddress: fallback.shortAddress || fallback.formattedAddress || fallback.address,
          status: "fallback",
        },
        "fallback",
      );
      if (key) reverseCache.set(key, payload);
      return res.json(payload);
    }

    return res
      .status(200)
      .json(normalizeResponse({ lat, lng, shortAddress: "", formattedAddress: "", reason: "provider_unavailable" }, "fallback"));
  }

  const responsePayload = normalizeResponse(resolved, "ok");
  if (key) reverseCache.set(key, responsePayload);
  return res.json(responsePayload);
});

export default router;
