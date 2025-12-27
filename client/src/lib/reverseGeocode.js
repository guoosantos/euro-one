import { resolveAuthorizationHeader } from "./api.js";

const REVERSE_URL = "/api/geocode/reverse";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 dias
const ACCEPT_LANGUAGE = "pt-BR";
const COUNTRY_BIAS = "br";
const cache = new Map();
const inFlight = new Map();
let useGuestReverse = false;
const STORAGE_KEY = "reverseGeocodeCache:v1";
let storageHydrated = false;
let loggedFallbackOnce = false;
const FALLBACK_ADDRESS = "Endereço indisponível";
const RATE_LIMIT_MS = 450;
const RETRY_DELAYS = [300, 800, 1500];
const FAILURE_CACHE_TTL = 15 * 1000;
let lastRequestAt = 0;
let rateLimitQueue = Promise.resolve();
const failureCache = new Map();

function buildKey(lat, lng, precision = 5) {
  const factor = 10 ** precision;
  return `${Math.round(lat * factor) / factor},${Math.round(lng * factor) / factor}`;
}

function hydrateFromStorage() {
  if (storageHydrated) return;
  storageHydrated = true;
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.entries)
        ? parsed.entries
        : [];

    entries.forEach(([key, value]) => {
      if (!Array.isArray(value)) return;
      const [cachedValue, timestamp] = value;
      if (!cachedValue || !Number.isFinite(timestamp)) return;
      if (Date.now() - timestamp > CACHE_TTL) return;
      cache.set(key, { value: cachedValue, timestamp });
    });
  } catch (_err) {
    // ignore hydration failures
  }
}

function persistCache() {
  try {
    if (typeof localStorage === "undefined") return;
    const freshEntries = Array.from(cache.entries())
      .filter(([, entry]) => Date.now() - entry.timestamp <= CACHE_TTL)
      .slice(-200)
      .map(([key, entry]) => [key, [entry.value, entry.timestamp]]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: freshEntries }));
  } catch (_err) {
    // ignore persist failures
  }
}

function setCachedReverse(key, value) {
  cache.set(key, { value, timestamp: Date.now() });
  persistCache();
}

function getCachedFailure(key) {
  const entry = failureCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > FAILURE_CACHE_TTL) {
    failureCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedFailure(key, value) {
  failureCache.set(key, { value, timestamp: Date.now() });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 503 || status === 504;
}

async function fetchWithRetry(fetcher, maxRetries = RETRY_DELAYS.length) {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetcher();
      if (!response.ok && isRetryableStatus(response.status) && attempt < maxRetries) {
        await wait(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
        attempt += 1;
        continue;
      }
      return response;
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }
      await wait(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
      attempt += 1;
    }
  }
}

export function getCachedReverse(lat, lng) {
  hydrateFromStorage();
  const key = buildKey(lat, lng);
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.delete(key);
    persistCache();
    return null;
  }
  return cached.value;
}

export async function reverseGeocode(lat, lng) {
  const key = buildKey(lat, lng);
  const cachedFailure = getCachedFailure(key);
  if (cachedFailure) return cachedFailure;
  const cached = getCachedReverse(lat, lng);
  if (cached) return cached;
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    const extractAddress = (data) =>
      data?.shortAddress ||
      data?.formattedAddress ||
      data?.address ||
      data?.display_name ||
      (data?.address
        ? [
            data.address.road,
            data.address.city || data.address.town || data.address.village,
            data.address.state,
          ]
            .filter(Boolean)
            .join(", ")
        : null);

    const resolveFromApi = async () => {
      const url = `${REVERSE_URL}?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
      const headers = new Headers({ Accept: "application/json" });
      const authorization = resolveAuthorizationHeader();
      if (authorization) headers.set("Authorization", authorization);

      const response = await fetchWithRetry(() => fetch(url, { credentials: "include", headers }));
      if (!response.ok) {
        const error = new Error(`Reverse geocode HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    };

    const resolveFromPublic = async () => {
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.searchParams.set("format", "json");
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lng));
      url.searchParams.set("zoom", "18");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("accept-language", ACCEPT_LANGUAGE);
      url.searchParams.set("countrycodes", COUNTRY_BIAS);

      const response = await fetchWithRetry(() =>
        fetch(url.toString(), { headers: { Accept: "application/json" } }),
      );
      if (!response.ok) {
        const error = new Error(`Reverse geocode HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    };

    const runWithRateLimit = (fn) => {
      const execute = async () => {
        const now = Date.now();
        const waitMs = Math.max(0, RATE_LIMIT_MS - (now - lastRequestAt));
        if (waitMs) {
          await wait(waitMs);
        }
        lastRequestAt = Date.now();
        return fn();
      };

      rateLimitQueue = rateLimitQueue.catch(() => {}).then(execute);
      return rateLimitQueue;
    };

    const shouldRetryWithPublic = (error) => {
      const status = error?.status;
      if (status === 401 || status === 403) return true;
      if (status === 429) return true;
      if (status >= 500) return true;
      return !status;
    };

    try {
      const preferPublic = useGuestReverse;
      const resolver = preferPublic ? resolveFromPublic : resolveFromApi;
      const data = await runWithRateLimit(resolver);
      const address = extractAddress(data);
      const resolved = address || FALLBACK_ADDRESS;

      if (!address && !loggedFallbackOnce) {
        loggedFallbackOnce = true;
        console.info("Geocode reverso sem endereço. Usando fallback.");
      }

      setCachedReverse(key, resolved);
      return resolved;
    } catch (error) {
      const isUnauthorized = error?.status === 401 || error?.status === 403;
      const tryPublic = shouldRetryWithPublic(error);

      if (isUnauthorized && !useGuestReverse) {
        useGuestReverse = true;
      }

      if (tryPublic) {
        try {
          const guestData = await runWithRateLimit(resolveFromPublic);
          const guestAddress = extractAddress(guestData);
          const resolvedGuest = guestAddress || FALLBACK_ADDRESS;
          setCachedReverse(key, resolvedGuest);
          return resolvedGuest;
        } catch (_guestError) {
          // Network/5xx: fall through to fallback after public attempt also fails.
          // fall through to fallback
        }
      }

      if (!loggedFallbackOnce) {
        loggedFallbackOnce = true;
        console.info("Geocode reverso falhou. Usando fallback.");
      }
      setCachedFailure(key, FALLBACK_ADDRESS);
      return FALLBACK_ADDRESS;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}
