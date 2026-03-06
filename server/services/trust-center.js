import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const TRUST_CENTER_STATES = {
  TRYING: "TENTANDO",
  ONLINE: "ONLINE",
  ACCESS_REGISTERED: "ACESSO_REGISTRADO",
};

export const TRUST_CENTER_COUNTER_STATUS = {
  ACTIVE: "ATIVA",
  EXPIRED: "EXPIRADA",
  CANCELED: "CANCELADA",
  USED: "USADA",
};

const DEFAULT_COUNTER_TTL_MINUTES = 30;
const DEFAULT_COUNTER_MAX_USES = 1;
const DEFAULT_COUNTER_SIZE = 6;
const DEFAULT_CHALLENGE_SIZE = 8;

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function toSafeString(value) {
  return String(value || "").trim();
}

export function normalizeSixDigitPassword(value) {
  const normalized = toSafeString(value);
  return /^\d{6}$/.test(normalized) ? normalized : null;
}

export function maskPasswordLast6(value) {
  const normalized = normalizeSixDigitPassword(value);
  if (!normalized) return null;
  return normalized.slice(-6);
}

export function resolveTrustCenterConfig() {
  return {
    counterKeyTtlMinutes: toPositiveInt(process.env.TRUST_CENTER_COUNTER_KEY_TTL_MINUTES, DEFAULT_COUNTER_TTL_MINUTES),
    counterKeyMaxUses: toPositiveInt(process.env.TRUST_CENTER_COUNTER_KEY_MAX_USES, DEFAULT_COUNTER_MAX_USES),
    challengeSize: toPositiveInt(process.env.TRUST_CENTER_CHALLENGE_SIZE, DEFAULT_CHALLENGE_SIZE),
    counterDigits: toPositiveInt(process.env.TRUST_CENTER_COUNTER_KEY_DIGITS, DEFAULT_COUNTER_SIZE),
    secret: toSafeString(process.env.TRUST_CENTER_SECRET) || "trust-center-default-secret-change-me",
  };
}

export function generateChallenge(size = DEFAULT_CHALLENGE_SIZE) {
  const targetSize = Math.max(4, toPositiveInt(size, DEFAULT_CHALLENGE_SIZE));
  const raw = randomBytes(Math.ceil(targetSize / 2)).toString("hex").toUpperCase();
  return raw.slice(0, targetSize);
}

function deriveNumericCodeFromHex(hex, digits = DEFAULT_COUNTER_SIZE) {
  const chunk = String(hex || "").slice(0, 12) || "0";
  const value = Number.parseInt(chunk, 16);
  const modulo = 10 ** Math.max(4, digits);
  const numeric = Number.isFinite(value) ? value % modulo : 0;
  return String(numeric).padStart(Math.max(4, digits), "0");
}

export function generateCounterKey({
  clientId,
  userId,
  vehicleId,
  esp32DeviceId,
  challenge,
  basePassword,
  secret,
  digits = DEFAULT_COUNTER_SIZE,
}) {
  const payload = [
    toSafeString(clientId),
    toSafeString(userId),
    toSafeString(vehicleId),
    toSafeString(esp32DeviceId),
    toSafeString(challenge),
    toSafeString(basePassword),
  ].join("|");

  const hmac = createHmac("sha256", String(secret || ""));
  hmac.update(payload);
  const digest = hmac.digest("hex");
  return deriveNumericCodeFromHex(digest, digits);
}

export function hashBasePassword(basePassword) {
  const normalized = normalizeSixDigitPassword(basePassword);
  if (!normalized) {
    return null;
  }

  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(normalized, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyBasePassword(basePassword, { salt, hash } = {}) {
  const normalized = normalizeSixDigitPassword(basePassword);
  if (!normalized || !salt || !hash) return false;
  const current = scryptSync(normalized, String(salt), 64);
  const expected = Buffer.from(String(hash), "hex");
  if (current.length !== expected.length) return false;
  return timingSafeEqual(current, expected);
}

export function computeExpiresAt(createdAt = new Date(), ttlMinutes = DEFAULT_COUNTER_TTL_MINUTES) {
  const baseDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const ttl = toPositiveInt(ttlMinutes, DEFAULT_COUNTER_TTL_MINUTES);
  return new Date(baseDate.getTime() + ttl * 60 * 1000);
}

export function isCounterKeyExpired(record, now = new Date()) {
  if (!record) return true;
  const currentDate = now instanceof Date ? now : new Date(now);
  const expiresAt = record.expires_at || record.expiresAt || null;
  if (expiresAt) {
    const expiresDate = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (!Number.isNaN(expiresDate.getTime()) && expiresDate.getTime() <= currentDate.getTime()) {
      return true;
    }
  }

  const usesCount = Number(record.uses_count ?? record.usesCount ?? 0);
  const maxUses = Number(record.max_uses ?? record.maxUses ?? DEFAULT_COUNTER_MAX_USES);
  if (Number.isFinite(maxUses) && maxUses > 0 && usesCount >= maxUses) {
    return true;
  }

  return false;
}

export function resolveEsp32Columns(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  const output = {};
  Object.keys(metadata).forEach((key) => {
    if (key.toLowerCase().startsWith("esp32_")) {
      output[key] = metadata[key];
    }
  });
  return output;
}

export function sha256Fingerprint(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}
