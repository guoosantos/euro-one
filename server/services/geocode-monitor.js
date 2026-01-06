import { enqueueGeocodeJob } from "../jobs/geocode.queue.js";
import { getGeocoderProviderName } from "./geocode-provider.js";
import { fetchPositionsMissingAddresses, markPositionGeocodePending } from "./traccar-db.js";

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isRecentUpdate(updatedAt, backoffMinutes) {
  if (!updatedAt || !backoffMinutes) return false;
  const cutoff = Date.now() - backoffMinutes * 60_000;
  return updatedAt.getTime() >= cutoff;
}

async function enqueuePosition(position, { reason, priority, provider }) {
  if (!position) return null;
  const lat = position.latitude ?? position.lat ?? null;
  const lng = position.longitude ?? position.lng ?? null;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  if (Number(lat) === 0 && Number(lng) === 0) return null;

  await markPositionGeocodePending(position.id, { provider });
  return enqueueGeocodeJob({
    lat,
    lng,
    positionId: position.id,
    deviceId: position.deviceId ?? position.deviceid ?? null,
    reason,
    priority,
  });
}

async function scanMissingAddresses({
  includeFailed = true,
  includePending = true,
  includeNullStatus = true,
  reason = "auto_scan",
  priority = "normal",
  lookbackMinutes = 120,
  limit = 500,
  failedBackoffMinutes = 60,
  pendingBackoffMinutes = 2,
} = {}) {
  const positions = await fetchPositionsMissingAddresses({
    lookbackMinutes,
    limit,
    includeFailed,
    includePending,
    includeNullStatus,
  });

  const provider = getGeocoderProviderName();
  const tasks = positions.map(async (position) => {
    const updatedAt = parseDate(position.addressUpdatedAt);
    if (position.addressStatus === "FAILED" && isRecentUpdate(updatedAt, failedBackoffMinutes)) {
      return null;
    }
    if (position.addressStatus === "PENDING" && isRecentUpdate(updatedAt, pendingBackoffMinutes)) {
      return null;
    }
    return enqueuePosition(position, { reason, priority, provider });
  });

  const results = await Promise.allSettled(tasks);
  const queued = results.filter((item) => item.status === "fulfilled" && item.value).length;
  return { scanned: positions.length, queued };
}

export function startGeocodeMonitor() {
  const scanIntervalMs = toNumber(process.env.GEOCODE_SCAN_INTERVAL_MS, 60_000);
  const lookbackMinutes = toNumber(process.env.GEOCODE_SCAN_LOOKBACK_MINUTES, 120);
  const batch = toNumber(process.env.GEOCODE_SCAN_BATCH, 500);
  const retryIntervalMs = toNumber(process.env.GEOCODE_RETRY_INTERVAL_MS, 6 * 60 * 60 * 1000);
  const failedBackoffMinutes = toNumber(process.env.GEOCODE_RETRY_BACKOFF_MINUTES, 60);
  const pendingBackoffMinutes = toNumber(process.env.GEOCODE_PENDING_BACKOFF_MINUTES, 2);

  let scanTimer = null;
  let retryTimer = null;

  const runScan = async () => {
    try {
      const result = await scanMissingAddresses({
        includeFailed: false,
        includePending: false,
        includeNullStatus: true,
        reason: "auto_scan",
        priority: "normal",
        lookbackMinutes,
        limit: batch,
        failedBackoffMinutes,
        pendingBackoffMinutes,
      });
      console.info("[geocode-monitor] scan_missing", result);
    } catch (error) {
      console.warn("[geocode-monitor] falha ao escanear posições pendentes", error?.message || error);
    }
  };

  const runRetry = async () => {
    try {
      const result = await scanMissingAddresses({
        includeFailed: true,
        includePending: true,
        includeNullStatus: false,
        reason: "retry_failed",
        priority: "high",
        lookbackMinutes: 24 * 60,
        limit: batch,
        failedBackoffMinutes,
        pendingBackoffMinutes,
      });
      console.info("[geocode-monitor] retry_failed", result);
    } catch (error) {
      console.warn("[geocode-monitor] falha ao reprocessar FAILED", error?.message || error);
    }
  };

  if (scanIntervalMs > 0) {
    scanTimer = setInterval(runScan, scanIntervalMs);
    runScan();
  }
  if (retryIntervalMs > 0) {
    retryTimer = setInterval(runRetry, retryIntervalMs);
    runRetry();
  }

  return () => {
    if (scanTimer) clearInterval(scanTimer);
    if (retryTimer) clearInterval(retryTimer);
  };
}

export default startGeocodeMonitor;
