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

export const config = {
  port: toNumber(process.env.PORT, 3001),
  traccar: {
    baseUrl: (process.env.TRACCAR_BASE_URL || "http://localhost:8082").replace(/\/$/, ""),
    adminUser: process.env.TRACCAR_ADMIN_USER || null,
    adminPassword: process.env.TRACCAR_ADMIN_PASSWORD || null,
    adminToken: process.env.TRACCAR_ADMIN_TOKEN || null,
  },
  jwt: {
    secret: process.env.JWT_SECRET || "change-me",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  cors: {
    origins: toArray(process.env.ALLOWED_ORIGINS || "http://localhost:5173"),
  },
};

export default config;
