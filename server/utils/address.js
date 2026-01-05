import prisma, { isPrismaAvailable } from "../services/prisma.js";
import { buildGridKey, enqueueGeocodeJob } from "../jobs/geocode.queue.js";
import { loadCollection, saveCollection } from "../services/storage.js";

const STORAGE_KEY = "geocodeCache";
const cache = new Map();
let cacheReady = false;

const NORMALIZED_PRECISION = 5;
const LEGACY_PRECISION = 4;

function hydrateCacheFromStorage() {
  const stored = loadCollection(STORAGE_KEY, []);
  stored.forEach((entry) => {
    if (!entry?.key) return;
    cache.set(entry.key, entry);
  });
}

function isDbAvailable() {
  return isPrismaAvailable() && Boolean(prisma?.geocodeCache);
}

async function hydrateCacheFromDatabase() {
  if (!isDbAvailable()) return;
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
  if (raw.addressParts) return raw.addressParts;
  if (raw.parts) return raw.parts;
  if (raw.attributes?.addressParts) return raw.attributes.addressParts;
  if (raw.address && typeof raw.address === "object") return raw.address;
  return null;
}

function normalizeCep(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) return value ? String(value).trim() : "";
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function formatFullAddressFromParts(parts = {}) {
  if (!parts || typeof parts !== "object") return null;

  const street = parts.street || parts.road || parts.streetName || parts.route;
  const houseNumber =
    parts.houseNumber || parts.house_number || parts.house || parts.number || parts.numero || (street ? "s/n" : "");
  const neighbourhood = parts.neighbourhood || parts.suburb || parts.quarter || parts.bairro;
  const city = parts.city || parts.town || parts.village || parts.municipality || parts.cidade;
  const stateCode = (parts.stateCode || parts.state_code || parts.uf || "").toString().toUpperCase();
  const state = stateCode || (parts.state || parts.region || parts.state_district || "").toString().toUpperCase();
  const postalCode = normalizeCep(parts.postalCode || parts.postcode || parts.zipcode || parts.cep);

  const streetLine = [street, houseNumber].filter(Boolean).join(", ");
  const neighbourhoodBlock = neighbourhood ? ` - ${neighbourhood}` : "";
  const cityState = [city, state].filter(Boolean).join("-");
  const cityStateBlock = cityState ? ` ${cityState}` : "";
  const postalBlock = postalCode ? `, ${postalCode}` : "";

  const formatted = `${streetLine}${neighbourhoodBlock}${cityStateBlock}${postalBlock}`
    .replace(/\s+-\s+-/g, " - ")
    .replace(/,\s+,/g, ", ")
    .trim();
  return formatted || null;
}

export function formatFullAddress(rawAddress) {
  if (!rawAddress) return "—";
  if (typeof rawAddress === "object" && !Array.isArray(rawAddress)) {
    const parts = resolveParts(rawAddress);
    const formattedFromParts = formatFullAddressFromParts(parts);
    if (formattedFromParts) return sanitiseBrazilianFormatting(formattedFromParts);
    const formatted =
      rawAddress.formattedAddress ||
      rawAddress.formatted ||
      rawAddress.formatted_address ||
      rawAddress.address ||
      rawAddress.display_name ||
      null;
    if (formatted) return sanitiseBrazilianFormatting(formatted);
  }
  if (typeof rawAddress === "string") {
    const cleaned = sanitiseBrazilianFormatting(rawAddress);
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

  if (!isDbAvailable()) return entry;
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

export async function initGeocodeCache() {
  if (cacheReady) return;
  hydrateCacheFromStorage();
  await hydrateCacheFromDatabase();
  cacheReady = true;
}

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

function sanitiseBrazilianFormatting(value) {
  if (!value) return "";
  let cleaned = collapseWhitespace(value);
  cleaned = cleaned.replace(/,\s*(brasil|brazil)$/i, "");
  cleaned = cleaned.replace(/\s+-\s+(brasil|brazil)$/i, "");
  cleaned = cleaned.replace(/\s*,\s*,+/g, ", ");
  cleaned = cleaned.replace(/\s+-\s+-/g, " - ");
  cleaned = cleaned.replace(/\s+-\s*,/g, " - ");
  cleaned = cleaned.replace(/-\s*,/g, "- ");
  cleaned = cleaned.replace(/\s+-\s*([A-Z]{2}),\s*([A-Z]{2})$/i, " - $1");
  cleaned = cleaned.replace(/,\s*-\s*/g, " - ");
  const ufTail = cleaned.match(/^(.*)-\s*([A-Z]{2})$/);
  if (ufTail) {
    const [, before, uf] = ufTail;
    const trimmedBefore = before.trim();
    cleaned = trimmedBefore.includes("-") ? `${trimmedBefore} ${uf}` : `${trimmedBefore}-${uf}`;
  }
  return collapseWhitespace(cleaned);
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

export function formatShortAddressFromParts(parts = {}) {
  const street = parts.street || coalesce(parts.road, parts.streetName, parts.route);
  const houseNumber = parts.houseNumber || coalesce(parts.house_number, parts.house, parts.number, parts.numero);
  const neighbourhood = parts.neighbourhood || coalesce(parts.neighbourhood, parts.suburb, parts.quarter);
  const city = parts.city || coalesce(parts.city, parts.town, parts.village, parts.municipality);
  const stateCode = coalesce(parts.stateCode, parts.state_code, parts.state);
  const state = stateCode ? stateCode.toUpperCase() : "";
  const postalCode = normalizeCep(parts.postalCode || coalesce(parts.postcode, parts.zipcode, parts.cep));
  const country = parts.country || coalesce(parts.country, parts.countryName) || "Brasil";

  const streetLine = street ? [street, houseNumber].filter(Boolean).join(", ") : "";
  const cityState = [city, state].filter(Boolean).join("-").trim();
  const locality = [neighbourhood, cityState].filter(Boolean).join(" ").trim();
  const base = [streetLine, locality].filter(Boolean).join(" - ");
  const suffix = [postalCode, country].filter(Boolean).join(", ");

  const formatted = [base || locality, suffix || country].filter(Boolean).join(", ").replace(/\s+,/g, ", ").trim();
  if (formatted) return formatted.endsWith(country) ? formatted : `${formatted}, ${country}`.replace(/,\s*,/g, ", ").trim();

  const fallback = [street, neighbourhood, cityState || state, postalCode, country].filter(Boolean).join(", ");
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

export function normalizeGeocodePayload(payload, lat, lng) {
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

function isPlaceholderAddress(value = "") {
  const text = collapseWhitespace(value).toLowerCase();
  if (!text) return true;
  return text.startsWith("sem endereço") || text.startsWith("resolvendo endereço");
}

function shouldQueueGeocode({ formattedAddress, shortAddress, geocodeStatus }) {
  const hasShort = collapseWhitespace(shortAddress || "");
  const hasFormatted = collapseWhitespace(formattedAddress || "");
  const statusOk = geocodeStatus === "ok";
  const missingShort = !hasShort || isPlaceholderAddress(shortAddress);
  const missingFormatted = !hasFormatted || isPlaceholderAddress(formattedAddress);
  return missingShort || missingFormatted || !statusOk;
}

function queueGeocodeForCoordinates({
  lat,
  lng,
  positionId = null,
  deviceId = null,
  priority = "normal",
  reason = "warm_fill",
} = {}) {
  const normalizedLat = normalizeCoordinate(lat);
  const normalizedLng = normalizeCoordinate(lng);
  if (!Number.isFinite(normalizedLat) || !Number.isFinite(normalizedLng)) return null;
  if (normalizedLat === 0 && normalizedLng === 0) return null;

  return enqueueGeocodeJob({
    lat: normalizedLat,
    lng: normalizedLng,
    positionId,
    deviceId,
    priority,
    reason,
  });
}

export async function enqueueWarmGeocodeFromPositions(
  list = [],
  { priority = "normal", reason = "warm_fill", minIntervalMs = 75 } = {},
) {
  const positions = Array.isArray(list) ? list : [];
  const seen = new Set();

  const queueable = positions
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const lat = item.latitude ?? item.lat ?? item.latFrom ?? item.startLat ?? null;
      const lng = item.longitude ?? item.lon ?? item.lng ?? item.lonFrom ?? item.startLng ?? null;
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
      const gridKey = buildGridKey(lat, lng);
      if (!gridKey || seen.has(gridKey)) return null;

      const needsQueue = shouldQueueGeocode({
        formattedAddress: item.formattedAddress || item.fullAddress || "",
        shortAddress: item.shortAddress || "",
        geocodeStatus: item.geocodeStatus,
      });
      if (!needsQueue) return null;

      seen.add(gridKey);
      return {
        lat,
        lng,
        positionId: item.id ?? item.positionid ?? null,
        deviceId: item.deviceId ?? item.deviceid ?? null,
        priority,
        reason,
      };
    })
    .filter(Boolean);

  let chain = Promise.resolve();
  queueable.forEach((payload, index) => {
    chain = chain.then(async () => {
      await queueGeocodeForCoordinates(payload);
      if (index < queueable.length - 1 && minIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, minIntervalMs));
      }
    });
  });

  return chain;
}

export async function ensurePositionAddress(position, { priority = "normal", reason = "warm_fill" } = {}) {
  if (!position || typeof position !== "object") return position;
  const rawAddress =
    position.fullAddress || position.address || position.formattedAddress || position.attributes?.fullAddress || position.attributes?.address;
  const normalizedAddress = normalizeAddressPayload(rawAddress);
  const baseFormatted = rawAddress ? formatFullAddress(rawAddress) : null;
  const formattedAddress = baseFormatted || position.formattedAddress || normalizedAddress.formatted || null;
  const shortAddress = position.shortAddress || normalizedAddress.short || null;
  const lat = position.latitude ?? position.lat;
  const lng = position.longitude ?? position.lon ?? position.lng;
  const coordinateFallback = buildCoordinateFallback(lat, lng);
  const placeholderShort = buildPlaceholderShortAddress(lat, lng);
  const fallbackFormatted =
    formattedAddress || formatFullAddress(normalizedAddress.formatted || normalizedAddress.short || "") || coordinateFallback;

  const cached = getCachedGeocode(lat, lng);
  const hasProvidedAddress = Boolean(baseFormatted || shortAddress);
  const finalFormatted =
    cached?.formattedAddress || formattedAddress || shortAddress || fallbackFormatted || coordinateFallback || "—";
  const preliminaryShort =
    cached?.shortAddress || shortAddress || finalFormatted || coordinateFallback || placeholderShort || "—";
  const baseStatus = position.geocodeStatus || (cached || hasProvidedAddress ? "ok" : "pending");
  const shouldEnqueue = shouldQueueGeocode({
    formattedAddress: finalFormatted,
    shortAddress: preliminaryShort,
    geocodeStatus: baseStatus,
  });
  const finalShort =
    cached?.shortAddress ||
    (shouldEnqueue ? "Resolvendo endereço..." : null) ||
    shortAddress ||
    finalFormatted ||
    coordinateFallback ||
    placeholderShort ||
    "—";
  const geocodeStatus = cached ? "ok" : shouldEnqueue ? "pending" : "ok";
  const geocodedAt = cached?.cachedAt || (shouldEnqueue ? new Date().toISOString() : position.geocodedAt || null);

  if (shouldEnqueue && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    queueGeocodeForCoordinates({
      lat,
      lng,
      positionId: position.id ?? position.positionid ?? null,
      deviceId: position.deviceId ?? position.deviceid ?? null,
      priority,
      reason,
    });
  }

  return {
    ...position,
    address: cached?.address ? normalizeAddressPayload(cached.address) : normalizedAddress,
    formattedAddress: finalFormatted || placeholderShort,
    fullAddress: finalFormatted || position.fullAddress || placeholderShort || null,
    shortAddress: finalShort || placeholderShort,
    addressParts: cached?.parts || position.addressParts,
    geocodeStatus,
    geocodedAt,
  };
}

export async function enrichPositionsWithAddresses(collection) {
  if (!Array.isArray(collection)) return collection;
  const enriched = await Promise.all(collection.map((item) => ensurePositionAddress(item)));
  void enqueueWarmGeocodeFromPositions(enriched, { priority: "normal", reason: "warm_fill" });
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
    const cached = getCachedGeocode(lat, lng);
    const shouldQueue = shouldQueueGeocode({
      formattedAddress: cached?.formattedAddress || item.formattedAddress,
      shortAddress: cached?.shortAddress || item.shortAddress,
      geocodeStatus: item.geocodeStatus,
    });
    if (!shouldQueue) return;
    queueGeocodeForCoordinates({
      lat,
      lng,
      positionId: item.id ?? item.positionid ?? null,
      deviceId: item.deviceId ?? item.deviceid ?? null,
      priority: "normal",
      reason: "warm_fill",
    });
  });
}

export async function resolveShortAddress(lat, lng, fallbackAddress = null) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return fallbackAddress
      ? { shortAddress: formatAddress(fallbackAddress), formattedAddress: formatAddress(fallbackAddress) }
      : null;
  }

  const cached = getCachedGeocode(lat, lng);
  if (cached) return { ...cached };

  queueGeocodeForCoordinates({ lat, lng, priority: "high", reason: "warm_fill" });

  if (fallbackAddress) {
    const formatted = formatAddress(fallbackAddress);
    return { shortAddress: formatted, formattedAddress: formatted, address: fallbackAddress };
  }

  return null;
}

function normalizeShortAddressInput(value) {
  if (!value) return "";
  if (typeof value === "string") return collapseWhitespace(value);
  if (typeof value === "object") {
    return (
      value.shortAddress ||
      value.formattedAddress ||
      value.address ||
      value.formatted ||
      value.formatted_address ||
      ""
    );
  }
  return String(value || "").trim();
}

function buildPlaceholderShortAddress(lat, lng) {
  const coordinate = buildCoordinateFallback(lat, lng);
  return coordinate ? `Sem endereço (${coordinate})` : "Sem endereço";
}

export function ensureCachedPositionAddress(
  position,
  { warm = true, placeholder = true, placeholderText = null, priority = "normal" } = {},
) {
  if (!position || typeof position !== "object") return position;
  const lat = position.latitude ?? position.lat;
  const lng = position.longitude ?? position.lon ?? position.lng;
  const cached = getCachedGeocode(lat, lng);
  const normalizedShort = normalizeShortAddressInput(position.shortAddress || position.fullAddress || position.address);
  const formattedAddress =
    cached?.formattedAddress ||
    formatFullAddress(position.formattedAddress || position.fullAddress || normalizedShort || position.address);

  let shortAddress = cached?.shortAddress || formatAddress(normalizedShort);
  if (shortAddress === "—") shortAddress = "";
  const tentativeFormatted =
    (formattedAddress && formattedAddress !== "—" ? formattedAddress : "") || buildCoordinateFallback(lat, lng) || "";
  const fallbackTextCandidate = buildPlaceholderShortAddress(lat, lng);
  const preliminaryShort = shortAddress || fallbackTextCandidate;
  const finalFormattedBase = tentativeFormatted || preliminaryShort;
  const needsQueue = shouldQueueGeocode({
    formattedAddress: finalFormattedBase,
    shortAddress: preliminaryShort,
    geocodeStatus: position.geocodeStatus || (cached ? "ok" : "pending"),
  });
  const fallbackText = placeholderText || (needsQueue ? "Resolvendo endereço..." : buildPlaceholderShortAddress(lat, lng));
  const finalShort = shortAddress || (placeholder ? fallbackText : "");
  const finalFormatted =
    (formattedAddress && formattedAddress !== "—" ? formattedAddress : "") ||
    finalFormattedBase ||
    finalShort ||
    buildCoordinateFallback(lat, lng) ||
    "";

  if (warm && needsQueue && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    queueGeocodeForCoordinates({
      lat,
      lng,
      positionId: position.id ?? position.positionid ?? null,
      deviceId: position.deviceId ?? position.deviceid ?? null,
      priority,
      reason: "warm_fill",
    });
  }

  return {
    ...position,
    formattedAddress: finalFormatted,
    fullAddress: position.fullAddress || finalFormatted,
    shortAddress: finalShort,
    geocodeStatus: cached ? "ok" : needsQueue ? "pending" : position.geocodeStatus || "pending",
    geocodedAt: cached?.cachedAt || (needsQueue ? new Date().toISOString() : position.geocodedAt || null),
  };
}

export function ensureCachedAddresses(collection, options = {}) {
  if (!Array.isArray(collection)) return [];
  const mapped = collection.map((item) => ensureCachedPositionAddress(item, options));
  void enqueueWarmGeocodeFromPositions(mapped, { priority: options.priority || "normal", reason: "warm_fill" });
  return mapped;
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
  enqueueGeocodeJob,
  ensureCachedPositionAddress,
  ensureCachedAddresses,
  formatShortAddressFromParts,
  normalizeGeocodePayload,
};
