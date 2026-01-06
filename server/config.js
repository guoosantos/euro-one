import { loadEnv } from "./utils/env.js";

export async function initConfigEnv() {
  try {
    await loadEnv();
  } catch (error) {
    console.warn("[startup] Falha ao carregar variáveis de ambiente do config.", error?.message || error);
  }
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  if (!value) return [];
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normaliseTraccarBaseUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  const withoutApiSuffix = withoutTrailingSlash.replace(/\/api$/i, "");
  const finalUrl = withoutApiSuffix.replace(/\/+$/, "");
  return finalUrl || null;
}

function normaliseBaseUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "") || null;
}

export const config = {
  port: toNumber(process.env.PORT, 3001),
  traccar: {
    baseUrl: normaliseTraccarBaseUrl(process.env.TRACCAR_BASE_URL),
    adminUser: process.env.TRACCAR_ADMIN_USER || null,
    adminPassword: process.env.TRACCAR_ADMIN_PASSWORD || null,
    adminToken: process.env.TRACCAR_ADMIN_TOKEN || null,
    syncIntervalMs: toNumber(process.env.TRACCAR_SYNC_INTERVAL_MS, 300_000),
    db: {
      client: process.env.TRACCAR_DB_CLIENT || null,
      host: process.env.TRACCAR_DB_HOST || null,
      port: toNumber(process.env.TRACCAR_DB_PORT, null),
      user: process.env.TRACCAR_DB_USER || null,
      password: process.env.TRACCAR_DB_PASSWORD || null,
      name: process.env.TRACCAR_DB_NAME || null,
    },
  },
  jwt: {
    secret: process.env.JWT_SECRET || "change-me",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  cors: {
    origins: toArray(process.env.ALLOWED_ORIGINS || "http://localhost:5173"),
  },
  osrm: {
    baseUrl: normaliseBaseUrl(process.env.OSRM_BASE_URL || process.env.MAP_MATCH_BASE_URL),
  },
  geocoder: {
    provider: process.env.GEOCODER_PROVIDER || "nominatim",
    baseUrl: normaliseBaseUrl(process.env.GEOCODER_URL || process.env.NOMINATIM_URL),
    apiKey: process.env.GEOCODER_API_KEY || null,
    timeoutMs: toNumber(process.env.GEOCODER_TIMEOUT_MS, 8000),
    qpsLimit: toNumber(process.env.GEOCODER_QPS_LIMIT, 1),
    userAgent: process.env.GEOCODER_USER_AGENT || "Euro-One Geocode Worker",
    gridPrecision: toNumber(process.env.GEOCODER_GRID_PRECISION, 4),
    reuseDistanceMeters: toNumber(process.env.GEOCODER_REUSE_DISTANCE_METERS, 25),
    maxConcurrent: toNumber(process.env.GEOCODER_MAX_CONCURRENT, 3),
  },
};

export { normaliseTraccarBaseUrl, normaliseBaseUrl };

export default config;
