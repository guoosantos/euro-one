import express from "express";
import createError from "http-errors";

import { createTtlCache } from "../utils/ttl-cache.js";
import { config } from "../config.js";
import { formatAddress, formatFullAddress, getCachedGeocode, persistGeocode, resolveShortAddress } from "../utils/address.js";

const router = express.Router();

const DEFAULT_GEOCODER_URL = "https://nominatim.openstreetmap.org";
const GEOCODER_BASE_URL = config.geocoder?.baseUrl || DEFAULT_GEOCODER_URL;
const cache = createTtlCache(10 * 60 * 1000);
const reverseCache = createTtlCache(30 * 60 * 1000);
const pending = new Map();
const reversePending = new Map();
const RETRY_DELAYS_MS = [300];
const REQUEST_TIMEOUT_MS = 3500;
const ACCEPT_LANGUAGE = "pt-BR,pt;q=0.9";
const COUNTRY_BIAS = "br";

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

function formatCountry(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (text.toLowerCase() === "brazil") return "Brasil";
  return text;
}

function buildShortAddress(payload) {
  const details = payload?.address || {};
  const street =
    details.road ||
    details.residential ||
    details.cycleway ||
    details.pedestrian ||
    details.highway ||
    details.footway ||
    null;
  const neighbourhood = details.neighbourhood || details.suburb || details.quarter || null;
  const city = details.city || details.town || details.village || details.municipality || null;
  const state = details.state || details.region || details.state_district || null;
  const postalCode = details.postcode || details.zipcode || details.cep || null;
  const country = formatCountry(details.country);

  const main = [street, neighbourhood].filter(Boolean).join(", ");
  const tail = [city, state].filter(Boolean).join(" - ");
  const combined = [main, tail].filter(Boolean).join(" - ");
  const full = [combined, postalCode, country].filter(Boolean).join(", ");
  return full || formatAddress(payload?.display_name || "");
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchReverse(lat, lng) {
  const url = buildGeocoderUrl("reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", ACCEPT_LANGUAGE);
  url.searchParams.set("countrycodes", COUNTRY_BIAS);

  let response;
  try {
    response = await fetchWithTimeout(url.toString(), {
      headers: {
        "User-Agent": "Euro-One Monitoring Server",
        Accept: "application/json",
        "Accept-Language": ACCEPT_LANGUAGE,
      },
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createError(504, "Timeout ao buscar endereço reverso");
    }
    throw error;
  }

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
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchReverse(lat, lng);
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.statusCode;
      if (![429, 503, 504].includes(status)) {
        throw error;
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || createError(504, "Falha ao buscar endereço reverso");
}

async function queryProvider(term, limit = 5) {
  const url = buildGeocoderUrl("search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", term);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("polygon_geojson", "0");
  url.searchParams.set("accept-language", ACCEPT_LANGUAGE);
  url.searchParams.set("countrycodes", COUNTRY_BIAS);

  let response;
  try {
    response = await fetchWithTimeout(url.toString(), {
      headers: {
        "User-Agent": "Euro-One Monitoring Server",
        Accept: "application/json",
        "Accept-Language": ACCEPT_LANGUAGE,
      },
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createError(504, "Timeout ao buscar endereços");
    }
    throw error;
  }

  if (!response.ok) {
    const err = createError(response.status, "Falha ao buscar endereços");
    throw err;
  }

  const payload = await response.json().catch(() => []);
  return Array.isArray(payload) ? payload : [];
}

async function queryProviderWithRetry(term, limit) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await queryProvider(term, limit);
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.statusCode;
      if (![429, 503, 504].includes(status)) {
        throw error;
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError || createError(504, "Falha ao buscar endereços");
}

router.get("/geocode/search", async (req, res) => {
  const query = sanitizeTerm(req.query.q ?? req.query.query ?? "");
  if (!query || query.length < 3) {
    return res.json({ ok: true, data: [] });
  }

  const limit = Math.max(1, Math.min(Number(req.query.limit) || 5, 10));
  const cacheKey = `${query.toLowerCase()}|${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ ok: true, data: cached });
  }

  if (pending.has(cacheKey)) {
    const shared = await pending.get(cacheKey).catch(() => []);
    return res.json({ ok: true, data: shared });
  }

  const promise = (async () => {
    const rawResults = await queryProviderWithRetry(query, limit);
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
    return res.json({ ok: true, data: results });
  } catch (error) {
    console.warn("[geocode:search] Falha ao buscar endereços", {
      status: error?.status || error?.statusCode,
      message: error?.message,
    });
    const message =
      error?.status === 429
        ? "Limite de consultas atingido. Tente novamente em instantes."
        : "Não foi possível buscar endereços agora. Tente novamente.";
    return res.json({ ok: true, data: [], error: { message } });
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
    return res.json({ ok: true, ...cached, cached: true });
  }

  const persisted = getCachedGeocode(lat, lng);
  if (persisted) {
    const payload = {
      ok: true,
      lat: persisted.lat ?? lat,
      lng: persisted.lng ?? lng,
      shortAddress: persisted.shortAddress || persisted.formattedAddress || persisted.address || null,
      formattedAddress: persisted.formattedAddress || persisted.shortAddress || persisted.address || null,
      cached: true,
      source: "geocodeCache",
    };
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
      const formattedAddress = formatFullAddress(payload?.display_name || shortAddress);
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
      const payload = {
        ok: true,
        lat,
        lng,
        shortAddress: fallback.shortAddress || fallback.formattedAddress || fallback.address,
        formattedAddress: fallback.formattedAddress || fallback.address || fallback.shortAddress,
      };
      if (key) reverseCache.set(key, payload);
      return res.json(payload);
    }

    const safeFallback = `Sem endereço (${lat.toFixed(5)},${lng.toFixed(5)})`;
    return res.json({
      ok: true,
      lat,
      lng,
      shortAddress: safeFallback,
      formattedAddress: safeFallback,
    });
  }

  return res.json({ ok: true, ...resolved });
});

export default router;
