import { resolveAuthorizationHeader } from "../lib/api.js";
import { formatGeocodeAddress } from "../utils/formatGeocodeAddress.js";

const REVERSE_URL = "/api/geocode/reverse";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL = 15 * 1000;
const RATE_LIMIT_MS = 450;
const REQUEST_TIMEOUT_MS = 4500;
const RETRY_DELAY_MS = 500;

const cache = new Map();
const failureCache = new Map();
const inFlight = new Map();
let lastRequestAt = 0;
let rateLimitQueue = Promise.resolve();

const buildKey = (lat, lng, precision = 5) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `${Number(lat).toFixed(precision)},${Number(lng).toFixed(precision)}`;
};

const isRetryableStatus = (status) => status === 429 || status >= 500;

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeoutId);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    }
  });

const getCachedFailure = (key) => {
  const entry = failureCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > FAILURE_CACHE_TTL) {
    failureCache.delete(key);
    return null;
  }
  return entry.value;
};

const setCachedFailure = (key, value) => {
  failureCache.set(key, { value, timestamp: Date.now() });
};

const setCachedReverse = (key, value) => {
  cache.set(key, { value, timestamp: Date.now() });
};

export function getCachedReverse(lat, lng) {
  const key = buildKey(lat, lng);
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

async function fetchJson(url, { headers, signal, credentials = "include" } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, { credentials, headers, signal: controller.signal });
    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }
    return { response, payload };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithRetry(fetcher, { signal } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await fetcher();
      if (result?.response?.ok) return result;
      const status = result?.response?.status;
      if (!isRetryableStatus(status)) return result;
      lastError = new Error(`Reverse geocode HTTP ${status}`);
      lastError.status = status;
    } catch (error) {
      lastError = error;
      if (signal?.aborted || error?.name === "AbortError") throw error;
      if (error?.status !== undefined && error?.status !== null && !isRetryableStatus(error?.status)) {
        throw error;
      }
    }

    if (attempt === 0) {
      await wait(RETRY_DELAY_MS, signal);
    }
  }

  if (lastError) throw lastError;
  throw new Error("Falha ao executar geocode reverso.");
}

function runWithRateLimit(fn, { signal } = {}) {
  const execute = async () => {
    const now = Date.now();
    const waitMs = Math.max(0, RATE_LIMIT_MS - (now - lastRequestAt));
    if (waitMs) {
      await wait(waitMs, signal);
    }
    lastRequestAt = Date.now();
    return fn();
  };

  rateLimitQueue = rateLimitQueue.catch(() => {}).then(execute);
  return rateLimitQueue;
}

async function resolveFromApi(lat, lng, { signal } = {}) {
  const url = `${REVERSE_URL}?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
  const headers = new Headers({ Accept: "application/json" });
  const authorization = resolveAuthorizationHeader();
  if (authorization) headers.set("Authorization", authorization);

  const { response, payload } = await fetchWithRetry(() => fetchJson(url, { headers, signal }), { signal });
  if (!response.ok) {
    const error = new Error(`Reverse geocode HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function resolveFromPublic(lat, lng, { signal } = {}) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "pt-BR");
  url.searchParams.set("countrycodes", "br");

  const { response, payload } = await fetchWithRetry(
    () => fetchJson(url.toString(), { headers: { Accept: "application/json" }, signal, credentials: "omit" }),
    { signal },
  );

  if (!response.ok) {
    const error = new Error(`Reverse geocode HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function reverseGeocode(lat, lng, { signal, force = false } = {}) {
  const normalizedLat = Number(lat);
  const normalizedLng = Number(lng);
  if (!Number.isFinite(normalizedLat) || !Number.isFinite(normalizedLng)) return null;

  const key = buildKey(normalizedLat, normalizedLng);
  if (!key) return null;

  if (!force) {
    const cachedFailure = getCachedFailure(key);
    if (cachedFailure) return null;
    const cached = getCachedReverse(normalizedLat, normalizedLng);
    if (cached) return cached;
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    try {
      const data = await runWithRateLimit(() => resolveFromApi(normalizedLat, normalizedLng, { signal }), { signal });
      if (data?.status === "fallback") {
        setCachedFailure(key, true);
        return null;
      }
      const address = formatGeocodeAddress(data);
      if (address) {
        setCachedReverse(key, address);
        return address;
      }
      setCachedFailure(key, true);
      return null;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      try {
        const fallbackData = await runWithRateLimit(
          () => resolveFromPublic(normalizedLat, normalizedLng, { signal }),
          { signal },
        );
        const fallbackAddress = formatGeocodeAddress(fallbackData);
        if (fallbackAddress) {
          setCachedReverse(key, fallbackAddress);
          return fallbackAddress;
        }
      } catch (_fallbackError) {
        // ignore fallback errors
      }
      setCachedFailure(key, true);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

export default reverseGeocode;
