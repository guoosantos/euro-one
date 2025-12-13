const REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
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

  const url = `${REVERSE_URL}?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Euro-One/monitoring-ui",
    },
  });

  if (!response.ok) throw new Error(`Reverse geocode HTTP ${response.status}`);
  const data = await response.json();
  const address = data?.display_name || data?.name;
  const conciseParts = [
    data?.address?.road,
    data?.address?.neighbourhood,
    data?.address?.suburb,
    data?.address?.city || data?.address?.town || data?.address?.village,
    data?.address?.state,
  ].filter(Boolean);
  const shortAddress = conciseParts.length ? conciseParts.join(", ") : address;

  const value = shortAddress || address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  cache.set(key, { value, timestamp: Date.now() });
  return value;
}
