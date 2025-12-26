import { resolveAuthorizationHeader } from "./api.js";

const REVERSE_URL = "/api/geocode/reverse";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 dias
const ACCEPT_LANGUAGE = "pt-BR";
const COUNTRY_BIAS = "br";
const cache = new Map();
let useGuestReverse = false;
const STORAGE_KEY = "reverseGeocodeCache:v1";
let storageHydrated = false;
let loggedFallbackOnce = false;
const FALLBACK_ADDRESS = "Endereço indisponível";

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
  const cached = getCachedReverse(lat, lng);
  if (cached) return cached;

  try {
    const resolveFromApi = async () => {
      const url = `${REVERSE_URL}?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
      const headers = new Headers({ Accept: "application/json" });
      const authorization = resolveAuthorizationHeader();
      if (authorization) headers.set("Authorization", authorization);

      const response = await fetch(url, { credentials: "include", headers });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(`Reverse geocode HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
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

      const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (!response.ok) {
        const error = new Error(`Reverse geocode HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    };

    const data = useGuestReverse ? await resolveFromPublic() : await resolveFromApi();
    const address =
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

    const resolved = address || FALLBACK_ADDRESS;

    if (!address && !loggedFallbackOnce) {
      loggedFallbackOnce = true;
      console.info("Geocode reverso sem endereço. Usando fallback.");
    }

    setCachedReverse(key, resolved);
    return resolved;
  } catch (error) {
    const isUnauthorized = error?.status === 401 || error?.status === 403;
    if (isUnauthorized && !useGuestReverse) {
      useGuestReverse = true;
      try {
        const guest = await reverseGeocode(lat, lng);
        setCachedReverse(key, guest);
        return guest;
      } catch (_guestError) {
        // fall through to fallback
      }
    }

    if (!loggedFallbackOnce) {
      loggedFallbackOnce = true;
      console.info("Geocode reverso falhou. Usando fallback.");
    }
    setCachedReverse(key, FALLBACK_ADDRESS);
    return FALLBACK_ADDRESS;
  }
}
