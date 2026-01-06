import { registerGeocodeProcessor } from "../jobs/geocode.queue.js";
import {
  formatFullAddress,
  getCachedGeocode,
  incrementGeocodeCacheHit,
  initGeocodeCache,
  normalizeGeocodePayload,
  persistGeocode,
} from "../utils/address.js";
import { getGeocoderProviderName, resolveReverseGeocode } from "../services/geocode-provider.js";
import {
  fetchLatestResolvedPositionForDevice,
  markPositionGeocodeFailed,
  markPositionGeocodePending,
  updatePositionFullAddress,
} from "../services/traccar-db.js";
import { config } from "../config.js";
import { calculateDistanceMeters } from "../utils/geo.js";

function formatResolvedAddress(payload) {
  if (!payload) return null;
  const formatted = formatFullAddress(payload.formattedAddress || payload.address || payload.shortAddress || null);
  return formatted && formatted !== "—" ? formatted : null;
}

async function persistPositionAddresses(positionIds = [], formattedAddress, { provider = null } = {}) {
  if (!formattedAddress) return;
  const uniqueIds = Array.from(new Set((positionIds || []).filter(Boolean)));
  const tasks = uniqueIds.map((id) =>
    updatePositionFullAddress(id, formattedAddress, { provider }).catch((error) => {
      console.warn("[geocode-worker] Failed to persist position address", { id, error: error?.message || error });
    }),
  );
  await Promise.all(tasks);
}

async function handleGeocodeJob(job) {
  const {
    lat,
    lng,
    positionId = null,
    positionIds = [],
    deviceId = null,
    reason = "warm_fill",
    gridKey = null,
  } = job.data || {};
  const targetIds = new Set((positionIds || []).filter(Boolean));
  if (positionId !== null && positionId !== undefined) targetIds.add(positionId);
  const providerName = getGeocoderProviderName();

  await initGeocodeCache();
  const addressStatusTargets = Array.from(targetIds);
  await Promise.all(
    addressStatusTargets.map((id) => markPositionGeocodePending(id, { provider: providerName }).catch(() => {})),
  );

  const cached = getCachedGeocode(lat, lng);
  if (cached) {
    const formatted = formatResolvedAddress(cached);
    if (formatted && targetIds.size) {
      await incrementGeocodeCacheHit(cached.gridKey || cached.key || gridKey || cached?.gridKey);
      await persistPositionAddresses(Array.from(targetIds), formatted, { provider: cached.provider || providerName });
    }
    console.info("[geocode-worker] geocode_cache_hit", { gridKey, deviceId, reason });
    return {
      status: "cached",
      gridKey,
      deviceId,
      reason,
      cachedAt: cached?.cachedAt || null,
    };
  }

  const reuseDistance = Number.isFinite(config.geocoder?.reuseDistanceMeters)
    ? config.geocoder.reuseDistanceMeters
    : 25;
  if (deviceId && reuseDistance > 0) {
    const latestResolved = await fetchLatestResolvedPositionForDevice(deviceId).catch(() => null);
    if (latestResolved?.fullAddress) {
      const distance = calculateDistanceMeters(
        { latitude: lat, longitude: lng },
        { latitude: latestResolved.latitude, longitude: latestResolved.longitude },
      );
      if (distance <= reuseDistance) {
        const formatted = formatResolvedAddress({ formattedAddress: latestResolved.fullAddress });
        if (formatted && targetIds.size) {
          await persistPositionAddresses(Array.from(targetIds), formatted, {
            provider: latestResolved.addressProvider || providerName,
          });
        }
        console.info("[geocode-worker] geocode_reuse_distance_hit", {
          gridKey,
          deviceId,
          reason,
          distance,
        });
        return {
          status: "reuse_distance",
          gridKey,
          deviceId,
          reason,
          distance,
        };
      }
    }
  }

  const resolved = await resolveReverseGeocode(lat, lng);
  const normalized = normalizeGeocodePayload(resolved, lat, lng);
  const entry = await persistGeocode(lat, lng, { ...normalized, provider: providerName, raw: resolved });
  const formatted = formatResolvedAddress(entry || normalized);
  if (formatted && targetIds.size) {
    await persistPositionAddresses(Array.from(targetIds), formatted, { provider: providerName });
  }

  console.info("[geocode-worker] geocode_success", { gridKey, deviceId, reason });

  return {
    status: "resolved",
    gridKey,
    deviceId,
    reason,
    formattedAddress: formatted || null,
  };
}

export function startGeocodeWorker() {
  const concurrency = Number(process.env.GEOCODE_WORKER_CONCURRENCY || 3);
  const stop = registerGeocodeProcessor(async (job) => {
    try {
      return await handleGeocodeJob(job);
    } catch (error) {
      const attempts = job?.opts?.attempts || 1;
      const isLastAttempt = (job?.attemptsMade ?? 0) + 1 >= attempts;
      if (isLastAttempt) {
        const targetIds = new Set((job?.data?.positionIds || []).filter(Boolean));
        if (job?.data?.positionId) targetIds.add(job.data.positionId);
        await Promise.all(
          Array.from(targetIds).map((id) =>
            markPositionGeocodeFailed(id, { error: error?.message || error }).catch(() => {}),
          ),
        );
        console.warn("[geocode-worker] geocode_failed", {
          gridKey: job?.data?.gridKey,
          deviceId: job?.data?.deviceId,
          attempts,
          message: error?.message || error,
        });
      }
      throw error;
    }
  }, {
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3,
  });

  return typeof stop === "function" ? stop : () => {};
}

export default startGeocodeWorker;
