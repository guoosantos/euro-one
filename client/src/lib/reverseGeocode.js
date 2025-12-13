const REVERSE_URL = "/api/geocode/reverse";
const CACHE_TTL = 30 * 60 * 1000; // 30 minutos
const cache = new Map();

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
    const url = `${REVERSE_URL}?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
    const response = await fetch(url, { credentials: "include" });

    if (!response.ok) throw new Error(`Reverse geocode HTTP ${response.status}`);
    const data = await response.json();

    const value = data?.shortAddress || data?.formattedAddress || data?.address;
    const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const resolved = value || fallback;

    cache.set(key, { value: resolved, timestamp: Date.now() });
    return resolved;
  } catch (error) {
    const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    cache.set(key, { value: fallback, timestamp: Date.now() });
    return fallback;
  }
}
