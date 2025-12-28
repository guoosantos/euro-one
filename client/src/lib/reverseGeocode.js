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
const RETRY_DELAYS_MS = [300, 800, 1500];
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

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => resolve(), ms);
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
}

function isTransientNetworkError(error) {
  const message = error?.message || "";
  return message.includes("ERR_NETWORK_CHANGED") || message.includes("NetworkChanged") || message.includes("Failed to fetch");
}

const isRetryableStatus = (status) => status === 429 || status >= 500;

async function fetchWithRetry(fetcher, { signal } = {}) {
  let lastError;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetcher();
      if (!response) throw new Error("Reverse geocode empty response");
      if (response.ok) return response;
      if (!isRetryableStatus(response.status)) {
        return response;
      }
      lastError = new Error(`Reverse geocode HTTP ${response.status}`);
      lastError.status = response.status;
    } catch (error) {
      lastError = error;
      if (signal?.aborted || error?.name === "AbortError") {
        throw error;
      }
      const transient = isTransientNetworkError(error);
      if (!transient) {
        if (!isRetryableStatus(error?.status)) throw error;
      }
    }

    const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    await wait(delay, signal);
  }

  if (lastError) throw lastError;
  throw new Error("Excedeu número máximo de tentativas de geocodificação reversa.");
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

export async function reverseGeocode(lat, lng, { signal, force = false } = {}) {
  const normalizedLat = Number(lat);
  const normalizedLng = Number(lng);
  if (!Number.isFinite(normalizedLat) || !Number.isFinite(normalizedLng)) return FALLBACK_ADDRESS;
  const key = buildKey(normalizedLat, normalizedLng);
  if (!key) return FALLBACK_ADDRESS;
  const cachedFailure = force ? null : getCachedFailure(key);
  if (cachedFailure) return cachedFailure;
  const cached = force ? null : getCachedReverse(lat, lng);
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

      const response = await fetchWithRetry(() => fetch(url, { credentials: "include", headers, signal }), { signal });
      let payload = null;
      try {
        payload = await response.json();
      } catch (_error) {
        payload = null;
      }
      if (!response.ok) {
        const error = new Error(`Reverse geocode HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        console.warn("Reverse geocode API falhou", { status: response.status, payload });
        throw error;
      }
      return payload;
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

      const response = await fetchWithRetry(
        () => fetch(url.toString(), { headers: { Accept: "application/json" }, signal }),
        { signal },
      );
      let payload = null;
      try {
        payload = await response.json();
      } catch (_error) {
        payload = null;
      }
      if (!response.ok) {
        const error = new Error(`Reverse geocode HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        console.warn("Reverse geocode público falhou", { status: response.status, payload });
        throw error;
      }
      return payload;
    };

    const runWithRateLimit = (fn) => {
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
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

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
      if (signal?.aborted || error?.name === "AbortError") {
        throw error;
      }

      const isUnauthorized = error?.status === 401 || error?.status === 403;
      const canUsePublic = shouldRetryWithPublic(error);
      const forcePublicAsFallback = !canUsePublic;

      if (isUnauthorized && !useGuestReverse) {
        useGuestReverse = true;
      }

      if (canUsePublic || forcePublicAsFallback) {
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
