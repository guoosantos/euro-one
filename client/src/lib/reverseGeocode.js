import { resolveAuthorizationHeader } from "./api.js";

const REVERSE_URL = "/api/geocode/reverse";
const CACHE_TTL = 30 * 60 * 1000; // 30 minutos
const ACCEPT_LANGUAGE = "pt-BR";
const COUNTRY_BIAS = "br";
const cache = new Map();
let useGuestReverse = false;

function buildKey(lat, lng, precision = 5) {
  const factor = 10 ** precision;
  return `${Math.round(lat * factor) / factor},${Math.round(lng * factor) / factor}`;
}

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

    const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const resolved = address || fallback;

    cache.set(key, { value: resolved, timestamp: Date.now() });
    return resolved;
  } catch (error) {
    const isUnauthorized = error?.status === 401 || error?.status === 403;
    if (isUnauthorized && !useGuestReverse) {
      useGuestReverse = true;
      try {
        const guest = await reverseGeocode(lat, lng);
        cache.set(key, { value: guest, timestamp: Date.now() });
        return guest;
      } catch (_guestError) {
        // fall through to fallback
      }
    }

    const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    cache.set(key, { value: fallback, timestamp: Date.now() });
    return fallback;
  }
}
