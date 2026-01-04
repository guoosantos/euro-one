import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "geocodeCache";
const cache = new Map();
const pendingLookups = new Map();
const dbAvailable = isPrismaAvailable() && Boolean(prisma?.geocodeCache);

const NORMALIZED_PRECISION = 4;
const LEGACY_PRECISION = 5;

function hydrateCacheFromStorage() {
  const stored = loadCollection(STORAGE_KEY, []);
  stored.forEach((entry) => {
    if (!entry?.key) return;
    cache.set(entry.key, entry);
  });
}

async function hydrateCacheFromDatabase() {
  if (!dbAvailable) return;
  try {
    const stored = await prisma.geocodeCache.findMany();
    stored.forEach((entry) => {
      if (!entry?.key || !entry?.data) return;
      cache.set(entry.key, { key: entry.key, ...entry.data, createdAt: entry.createdAt, updatedAt: entry.updatedAt });
    });
  } catch (error) {
    console.warn("[geocode] Falha ao hidratar cache do banco", error?.message || error);
  }
}

function persistCacheToStorage() {
  saveCollection(STORAGE_KEY, Array.from(cache.values()));
}

function resolveParts(raw) {
  if (!raw || typeof raw !== "object") return null;
  return raw.addressParts || raw.parts || raw.attributes?.addressParts || null;
}

function formatFullAddressFromParts(parts = {}) {
  if (!parts || typeof parts !== "object") return null;
  const street = parts.street || parts.road || parts.streetName || parts.route;
  const houseNumber =
    parts.houseNumber || parts.house_number || parts.house || (street ? "s/n" : null);
  const neighbourhood = parts.neighbourhood || parts.suburb || parts.quarter;
  const city = parts.city || parts.town || parts.village || parts.municipality;
  const state = parts.state || parts.region || parts.state_district || parts.stateCode;
  const countryCode = parts.countryCode || parts.country_code || parts.countryCodeIso;
  const postalCode = parts.postalCode || parts.postcode || parts.zipcode;

  const firstLine = [street, houseNumber].filter(Boolean).join(", ");
  const locality = [neighbourhood, city].filter(Boolean).join(", ");
  const region = [state, countryCode, postalCode].filter(Boolean).join(", ");

  const formatted = [firstLine, locality, region].filter(Boolean).join(" - ");
  return formatted || null;
}

export function formatFullAddress(rawAddress) {
  if (!rawAddress) return "—";
  if (typeof rawAddress === "object" && !Array.isArray(rawAddress)) {
    const parts = resolveParts(rawAddress);
    const formattedFromParts = formatFullAddressFromParts(parts);
    if (formattedFromParts) return formattedFromParts;
    const formatted =
      rawAddress.formattedAddress ||
      rawAddress.formatted ||
      rawAddress.formatted_address ||
      rawAddress.address ||
      rawAddress.display_name ||
      null;
    if (formatted) return collapseWhitespace(formatted);
  }
  if (typeof rawAddress === "string") {
    const cleaned = collapseWhitespace(rawAddress);
    return cleaned || "—";
  }
  return "—";
}

function buildCacheEntry(lat, lng, payload = {}) {
  const { primary } = resolveCacheKeys(lat, lng);
  if (!primary) return null;

  const parts = resolveParts(payload) || null;
  const houseNumberFallback = parts?.houseNumber || parts?.house_number || parts?.house || (parts?.street ? "s/n" : null);
  const formattedFromParts = parts ? formatShortAddressFromParts({ ...parts, houseNumber: houseNumberFallback || parts?.houseNumber }) : null;
  const fullFromParts = parts ? formatFullAddressFromParts({ ...parts, houseNumber: houseNumberFallback || parts?.houseNumber }) : null;

  const formatted = formatFullAddress(
    fullFromParts ||
      payload.formattedAddress ||
      payload.formatted ||
      payload.shortAddress ||
      formattedFromParts ||
      payload.address ||
      payload.display_name ||
      null,
  );
  const safeFormatted = formatted && formatted !== "—" ? formatted : null;
  const shortAddress = payload.shortAddress || formattedFromParts || safeFormatted;
  const address = safeFormatted || payload.address || shortAddress || null;

  return {
    key: primary,
    lat: Number(lat),
    lng: Number(lng),
    address,
    formattedAddress: safeFormatted || address || shortAddress || null,
    shortAddress: shortAddress || safeFormatted || address || null,
    parts: parts || null,
    createdAt: payload.createdAt || payload.updatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function persistCacheEntry(entry) {
  if (!entry?.key) return entry;
  cache.set(entry.key, entry);
  persistCacheToStorage();

  if (!dbAvailable) return entry;
  try {
    await prisma.geocodeCache.upsert({
      where: { key: entry.key },
      update: { data: entry, updatedAt: new Date() },
      create: { key: entry.key, data: entry },
    });
  } catch (error) {
    console.warn("[geocode] Falha ao persistir cache no banco", error?.message || error);
  }
  return entry;
}

hydrateCacheFromStorage();
await hydrateCacheFromDatabase();

export async function persistGeocode(lat, lng, payload) {
  const entry = buildCacheEntry(lat, lng, payload);
  if (!entry) return null;
  await persistCacheEntry(entry);
  return entry;
}

function buildCoordinateFallback(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

function normalizeCoordinate(value, precision = NORMALIZED_PRECISION) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(precision));
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
  const houseNumber = parts.houseNumber || coalesce(parts.house_number, parts.house) || (street ? "s/n" : "");
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

function buildCacheKey(lat, lng, precision = NORMALIZED_PRECISION) {
  const normalizedLat = normalizeCoordinate(lat, precision);
  const normalizedLng = normalizeCoordinate(lng, precision);
  if (normalizedLat === null || normalizedLng === null) return null;
  return `${normalizedLat},${normalizedLng}`;
}

function resolveCacheKeys(lat, lng) {
  const primary = buildCacheKey(lat, lng, NORMALIZED_PRECISION);
  const legacy = buildCacheKey(lat, lng, LEGACY_PRECISION);
  return { primary, legacy, changedPrecision: primary !== legacy };
}

export function getCachedGeocode(lat, lng) {
  const { primary, legacy } = resolveCacheKeys(lat, lng);
  const key = primary || legacy;
  if (!key) return null;
  const cached = cache.get(primary) || cache.get(legacy);
  if (!cached) return null;
  const formattedAddress = cached.formattedAddress || formatAddress(cached.address || cached.shortAddress || "");
  return {
    lat: cached.lat ?? lat,
    lng: cached.lng ?? lng,
    address: cached.address || formattedAddress || cached.shortAddress || null,
    formattedAddress,
    shortAddress: cached.shortAddress || formattedAddress || cached.address || null,
    cachedAt: cached.updatedAt || cached.createdAt || null,
  };
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
    country: details.country,
    countryCode: details.country_code ? String(details.country_code).toUpperCase() : null,
    stateCode: details.state_code ? String(details.state_code).toUpperCase() : null,
  };

  const shortAddress = formatShortAddressFromParts(parts) || formatAddress(displayName);
  const fullAddress = formatFullAddressFromParts(parts) || formatFullAddress(displayName);

  return {
    address: displayName,
    formattedAddress: fullAddress || formatAddress(displayName),
    shortAddress,
    parts,
    lat,
    lng,
  };
}

const MAX_CONCURRENT_LOOKUPS = 3;
const lookupQueue = [];
let activeLookups = 0;

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

async function runNextLookup() {
  if (activeLookups >= MAX_CONCURRENT_LOOKUPS) return;
  const task = lookupQueue.shift();
  if (!task) return;
  activeLookups += 1;
  try {
    await task();
  } finally {
    activeLookups -= 1;
    if (lookupQueue.length) {
      setTimeout(runNextLookup, 100);
    }
  }
}

function scheduleLookup(lat, lng) {
  const { primary } = resolveCacheKeys(lat, lng);
  const key = primary;
  if (!key) return Promise.resolve(null);

  if (pendingLookups.has(key)) {
    return pendingLookups.get(key);
  }

  const promise = new Promise((resolve) => {
    const task = async () => {
      try {
        const address = await fetchGeocode(lat, lng);
        if (address) {
          const entry = buildCacheEntry(lat, lng, address);
          await persistCacheEntry(entry);
          resolve(entry);
          return;
        }
        resolve(address);
      } catch (_error) {
        resolve(null);
      } finally {
        pendingLookups.delete(key);
      }
    };
    lookupQueue.push(task);
    runNextLookup();
  });

  pendingLookups.set(key, promise);
  return promise;
}

async function lookupGeocode(lat, lng, { blocking = true } = {}) {
  const { primary, legacy } = resolveCacheKeys(lat, lng);
  const key = primary || legacy;
  if (!key) return null;

  const cached = cache.get(primary) || cache.get(legacy);
  if (cached?.address || cached?.shortAddress) {
    return cached;
  }

  if (pendingLookups.has(primary)) {
    return pendingLookups.get(primary);
  }

  const promise = scheduleLookup(lat, lng);
  if (!blocking) return null;
  return promise;
}

export async function ensurePositionAddress(position) {
  if (!position || typeof position !== "object") return position;
  const rawAddress = position.address || position.formattedAddress || position.attributes?.address;
  const normalizedAddress = normalizeAddressPayload(rawAddress);
  const baseFormatted = rawAddress ? formatFullAddress(rawAddress) : null;
  const formattedAddress = baseFormatted || position.formattedAddress || normalizedAddress.formatted || null;
  const shortAddress = position.shortAddress || normalizedAddress.short || null;
  const lat = position.latitude ?? position.lat;
  const lng = position.longitude ?? position.lon ?? position.lng;
  const coordinateFallback = buildCoordinateFallback(lat, lng);
  const fallbackFormatted =
    formattedAddress || formatFullAddress(normalizedAddress.formatted || normalizedAddress.short || "") || coordinateFallback;

  if (baseFormatted || shortAddress) {
    return {
      ...position,
      address: normalizedAddress,
      formattedAddress: formattedAddress || shortAddress || fallbackFormatted || "—",
      shortAddress: shortAddress || formattedAddress || fallbackFormatted || "—",
    };
  }

  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return { ...position, address: normalizedAddress, formattedAddress: formattedAddress || null, shortAddress: shortAddress || null };
  }

  const resolved = await lookupGeocode(lat, lng);
  if (!resolved) {
    const finalFormatted = formattedAddress || fallbackFormatted || coordinateFallback || "—";
    return {
      ...position,
      address: normalizedAddress,
      formattedAddress: finalFormatted,
      shortAddress: shortAddress || finalFormatted,
    };
  }
  const resolvedAddress = normalizeAddressPayload(resolved.address || resolved.formattedAddress);
  const finalFormatted =
    resolved.formattedAddress || formattedAddress || resolved.shortAddress || fallbackFormatted || coordinateFallback || "—";
  return {
    ...position,
    address: Object.keys(resolvedAddress).length ? resolvedAddress : normalizedAddress || { formatted: finalFormatted },
    formattedAddress: finalFormatted,
    shortAddress: resolved.shortAddress || shortAddress || finalFormatted,
    addressParts: resolved.parts,
  };
}

export async function enrichPositionsWithAddresses(collection) {
  if (!Array.isArray(collection)) return collection;
  const enriched = await Promise.all(collection.map((item) => ensurePositionAddress(item)));
  return enriched;
}

export function prefetchPositionAddresses(collection) {
  if (!Array.isArray(collection)) return;
  collection.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const hasAddress = item.address || item.formattedAddress || item.shortAddress;
    if (hasAddress) return;
    const lat = item.latitude ?? item.lat;
    const lng = item.longitude ?? item.lon ?? item.lng;
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
    lookupGeocode(lat, lng, { blocking: false });
  });
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
  formatFullAddress,
  ensurePositionAddress,
  enrichPositionsWithAddresses,
  resolveShortAddress,
  getCachedGeocode,
  prefetchPositionAddresses,
  persistGeocode,
};
