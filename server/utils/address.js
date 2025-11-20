import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "geocodeCache";
const cache = new Map();
const pendingLookups = new Map();

function hydrateCache() {
  const stored = loadCollection(STORAGE_KEY, []);
  stored.forEach((entry) => {
    if (!entry?.key) return;
    cache.set(entry.key, entry);
  });
}

function persistCache() {
  saveCollection(STORAGE_KEY, Array.from(cache.values()));
}

hydrateCache();

function normalizeCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(5));
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function formatAddress(address) {
  if (!address) return "—";
  const cleaned = collapseWhitespace(address);
  if (!cleaned) return "—";

  const [beforeHyphen, ...afterHyphenParts] = cleaned.split(" - ").map((part) => part.trim()).filter(Boolean);
  const commaParts = beforeHyphen.split(",").map((part) => part.trim()).filter(Boolean);

  const main = commaParts.slice(0, 2).join(", ") || beforeHyphen;
  const suffixFromHyphen = afterHyphenParts.join(" - ");
  const tailParts = commaParts.slice(2).concat(afterHyphenParts).filter(Boolean);
  const tail = tailParts.slice(-2).join(" - ") || suffixFromHyphen;

  const compact = [main, tail].filter(Boolean).join(" - ");
  if (compact) return compact;

  const fallback = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
  if (fallback.length <= 2) return fallback.join(", ");
  return `${fallback.slice(0, 2).join(", ")} - ${fallback.slice(-2).join(" - ")}`;
}

function buildCacheKey(lat, lng) {
  const normalizedLat = normalizeCoordinate(lat);
  const normalizedLng = normalizeCoordinate(lng);
  if (normalizedLat === null || normalizedLng === null) return null;
  return `${normalizedLat},${normalizedLng}`;
}

async function fetchGeocode(lat, lng) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "euro-one/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Geocode HTTP ${response.status}`);
  }
  const payload = await response.json();
  return payload?.display_name || null;
}

async function lookupGeocode(lat, lng) {
  const key = buildCacheKey(lat, lng);
  if (!key) return null;

  const cached = cache.get(key);
  if (cached?.address) {
    return cached.address;
  }

  if (pendingLookups.has(key)) {
    return pendingLookups.get(key);
  }

  const promise = (async () => {
    try {
      const address = await fetchGeocode(lat, lng);
      if (address) {
        cache.set(key, { key, lat, lng, address, updatedAt: new Date().toISOString() });
        persistCache();
      }
      return address;
    } catch (_error) {
      return null;
    } finally {
      pendingLookups.delete(key);
    }
  })();

  pendingLookups.set(key, promise);
  return promise;
}

export async function ensurePositionAddress(position) {
  if (!position || typeof position !== "object") return position;
  const address = position.address || position.attributes?.address;
  if (address) {
    const formatted = formatAddress(address);
    return { ...position, formattedAddress: formatted };
  }

  const lat = position.latitude ?? position.lat;
  const lng = position.longitude ?? position.lon ?? position.lng;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return position;
  }

  const resolved = await lookupGeocode(lat, lng);
  if (!resolved) return position;
  const formatted = formatAddress(resolved);
  return { ...position, address: resolved, formattedAddress: formatted };
}

export async function enrichPositionsWithAddresses(collection) {
  if (!Array.isArray(collection)) return collection;
  const enriched = await Promise.all(collection.map((item) => ensurePositionAddress(item)));
  return enriched;
}

export default {
  formatAddress,
  ensurePositionAddress,
  enrichPositionsWithAddresses,
};
