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

function normalizeAddressPayload(rawAddress) {
  if (rawAddress && typeof rawAddress === "object" && !Array.isArray(rawAddress)) {
    return rawAddress;
  }
  if (rawAddress) {
    return { formatted: String(rawAddress) };
  }
  return {};
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function coalesce(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
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

function formatShortAddressFromParts(parts = {}) {
  const street = parts.street || coalesce(parts.road, parts.streetName, parts.route);
  const houseNumber = parts.houseNumber || coalesce(parts.house_number, parts.house);
  const neighbourhood = parts.neighbourhood || coalesce(parts.neighbourhood, parts.suburb, parts.quarter);
  const city = parts.city || coalesce(parts.city, parts.town, parts.village, parts.municipality);
  const state = parts.state || coalesce(parts.state, parts.region, parts.state_district);
  const postalCode = parts.postalCode || coalesce(parts.postcode, parts.zipcode);

  const firstLine = [street, houseNumber].filter(Boolean).join(", ");
  const locality = [neighbourhood, city].filter(Boolean).join(", ");
  const region = [state, postalCode].filter(Boolean).join(", ");

  const suffix = [locality, region].filter(Boolean).join(" - ");
  const compact = [firstLine, suffix].filter(Boolean).join(" - ");
  if (compact) return compact;

  const fallback = [street, neighbourhood, city, state, postalCode].filter(Boolean).join(", ");
  return fallback || null;
}

function buildCacheKey(lat, lng) {
  const normalizedLat = normalizeCoordinate(lat);
  const normalizedLng = normalizeCoordinate(lng);
  if (normalizedLat === null || normalizedLng === null) return null;
  return `${normalizedLat},${normalizedLng}`;
}

function normalizeGeocodePayload(payload, lat, lng) {
  const displayName = collapseWhitespace(payload?.display_name) || null;
  const details = payload?.address || {};

  const street = coalesce(
    details.road,
    details.residential,
    details.cycleway,
    details.pedestrian,
    details.highway,
    details.footway,
  );

  const parts = {
    street,
    houseNumber: details.house_number || details.house,
    neighbourhood: coalesce(details.neighbourhood, details.suburb, details.quarter),
    city: coalesce(details.city, details.town, details.village, details.municipality),
    state: coalesce(details.state, details.region, details.state_district),
    postalCode: details.postcode || details.zipcode,
  };

  const shortAddress = formatShortAddressFromParts(parts) || formatAddress(displayName);

  return {
    address: displayName,
    formattedAddress: formatAddress(displayName),
    shortAddress,
    parts,
    lat,
    lng,
  };
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
  return normalizeGeocodePayload(payload, lat, lng);
}

async function lookupGeocode(lat, lng) {
  const key = buildCacheKey(lat, lng);
  if (!key) return null;

  const cached = cache.get(key);
  if (cached?.address || cached?.shortAddress) {
    return cached;
  }

  if (pendingLookups.has(key)) {
    return pendingLookups.get(key);
  }

  const promise = (async () => {
    try {
      const address = await fetchGeocode(lat, lng);
      if (address) {
        cache.set(key, { key, lat, lng, ...address, updatedAt: new Date().toISOString() });
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
  const rawAddress = position.address || position.formattedAddress || position.attributes?.address;
  const normalizedAddress = normalizeAddressPayload(rawAddress);
  const baseFormatted = rawAddress ? formatAddress(rawAddress) : null;
  const formattedAddress = baseFormatted || position.formattedAddress || normalizedAddress.formatted || null;
  const shortAddress = position.shortAddress || normalizedAddress.short || null;

  if (baseFormatted || shortAddress) {
    return { ...position, address: normalizedAddress, formattedAddress: formattedAddress || shortAddress, shortAddress };
  }

  const lat = position.latitude ?? position.lat;
  const lng = position.longitude ?? position.lon ?? position.lng;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return { ...position, address: normalizedAddress, formattedAddress: formattedAddress || null, shortAddress: shortAddress || null };
  }

  const resolved = await lookupGeocode(lat, lng);
  if (!resolved) {
    return { ...position, address: normalizedAddress, formattedAddress: formattedAddress || null, shortAddress: shortAddress || null };
  }
  const resolvedAddress = normalizeAddressPayload(resolved.address || resolved.formattedAddress);
  return {
    ...position,
    address: Object.keys(resolvedAddress).length ? resolvedAddress : normalizedAddress,
    formattedAddress: resolved.formattedAddress || formattedAddress || null,
    shortAddress: resolved.shortAddress || shortAddress || null,
    addressParts: resolved.parts,
  };
}

export async function enrichPositionsWithAddresses(collection) {
  if (!Array.isArray(collection)) return collection;
  const enriched = await Promise.all(collection.map((item) => ensurePositionAddress(item)));
  return enriched;
}

export async function resolveShortAddress(lat, lng, fallbackAddress = null) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return fallbackAddress
      ? { shortAddress: formatAddress(fallbackAddress), formattedAddress: formatAddress(fallbackAddress) }
      : null;
  }

  const resolved = await lookupGeocode(lat, lng);
  if (resolved) {
    return {
      ...resolved,
    };
  }

  if (fallbackAddress) {
    const formatted = formatAddress(fallbackAddress);
    return { shortAddress: formatted, formattedAddress: formatted, address: fallbackAddress };
  }

  return null;
}

export default {
  formatAddress,
  ensurePositionAddress,
  enrichPositionsWithAddresses,
  resolveShortAddress,
};
