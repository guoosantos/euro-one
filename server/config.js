import { loadEnv } from "./utils/env.js";

await loadEnv();

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
};

export { normaliseTraccarBaseUrl };

export default config;
