const DEFAULT_NAME_MAX_LEN = 120;
const DEFAULT_GEOZONE_NAME_MODE = "client_geofence";
const DEFAULT_FRIENDLY_NAMES = true;

function parseBooleanEnv(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return fallback;
}

function parseMaxLen(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseGeozoneNameMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return DEFAULT_GEOZONE_NAME_MODE;
  if (normalized === "client_itinerary_geofence") return "client_itinerary_geofence";
  return DEFAULT_GEOZONE_NAME_MODE;
}

export function resolveXdmNameConfig() {
  const isProduction = process.env.NODE_ENV === "production";
  const friendlyFromEnv = parseBooleanEnv(process.env.XDM_FRIENDLY_NAMES, DEFAULT_FRIENDLY_NAMES);
  const geozoneNameMode = isProduction
    ? DEFAULT_GEOZONE_NAME_MODE
    : parseGeozoneNameMode(process.env.XDM_GEOZONE_NAME_MODE);
  return {
    friendlyNamesEnabled: isProduction ? true : friendlyFromEnv,
    maxNameLength: parseMaxLen(process.env.XDM_NAME_MAX_LEN, DEFAULT_NAME_MAX_LEN),
    geozoneNameMode,
  };
}

export function sanitizeFriendlyName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
}

export function truncateName(value, maxLen) {
  const normalized = String(value || "");
  if (!normalized) return "";
  if (!Number.isFinite(maxLen) || maxLen <= 0) return normalized;
  if (normalized.length <= maxLen) return normalized;
  return normalized.slice(0, maxLen).trimEnd();
}

export function buildShortIdSuffix(value, { length = 5 } = {}) {
  const trimmed = String(value || "").replace(/-/g, "").trim();
  if (!trimmed) return "";
  const safeLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 5;
  return trimmed.slice(Math.max(0, trimmed.length - safeLength));
}

export function buildFriendlyName(parts = [], { maxLen } = {}) {
  const cleaned = (Array.isArray(parts) ? parts : [])
    .map((part) => sanitizeFriendlyName(part))
    .filter(Boolean);
  if (!cleaned.length) return "";
  return truncateName(cleaned.join(" - "), maxLen);
}

export function buildFriendlyNameWithSuffix(parts = [], { maxLen, suffix } = {}) {
  const base = buildFriendlyName(parts, { maxLen: Infinity });
  const trimmedSuffix = String(suffix || "").trim();
  if (!trimmedSuffix) return truncateName(base, maxLen);
  const suffixToken = ` (${trimmedSuffix})`;
  if (!Number.isFinite(maxLen) || maxLen <= 0) {
    return `${base}${suffixToken}`;
  }
  if (base.length + suffixToken.length <= maxLen) {
    return `${base}${suffixToken}`;
  }
  const ellipsis = "…";
  const available = maxLen - suffixToken.length - ellipsis.length;
  if (available <= 0) {
    return truncateName(`${ellipsis}${suffixToken}`, maxLen);
  }
  const truncatedBase = base.slice(0, available).trimEnd();
  return `${truncatedBase}${ellipsis}${suffixToken}`;
}

export function fallbackClientDisplayName(clientId) {
  const raw = String(clientId || "").trim();
  if (!raw) return "CLIENT";
  return raw.slice(0, 8);
}

export function resolveClientDisplayName({ clientDisplayName, clientId } = {}) {
  const cleaned = sanitizeFriendlyName(clientDisplayName);
  if (cleaned) return cleaned;
  return fallbackClientDisplayName(clientId);
}

export default {
  resolveXdmNameConfig,
  sanitizeFriendlyName,
  truncateName,
  buildFriendlyName,
  buildFriendlyNameWithSuffix,
  buildShortIdSuffix,
  resolveClientDisplayName,
  fallbackClientDisplayName,
};
