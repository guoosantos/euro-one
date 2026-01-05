import { registerGeocodeProcessor } from "../jobs/geocode.queue.js";
import { formatFullAddress, getCachedGeocode, initGeocodeCache, normalizeGeocodePayload, persistGeocode } from "../utils/address.js";
import { resolveReverseGeocode } from "../services/geocode-provider.js";
import { updatePositionFullAddress } from "../services/traccar-db.js";

function formatResolvedAddress(payload) {
  if (!payload) return null;
  const formatted = formatFullAddress(payload.formattedAddress || payload.address || payload.shortAddress || null);
  return formatted && formatted !== "—" ? formatted : null;
}

async function persistPositionAddresses(positionIds = [], formattedAddress) {
  if (!formattedAddress) return;
  const uniqueIds = Array.from(new Set((positionIds || []).filter(Boolean)));
  const tasks = uniqueIds.map((id) =>
    updatePositionFullAddress(id, formattedAddress).catch((error) => {
      console.warn("[geocode-worker] Failed to persist position address", { id, error: error?.message || error });
    }),
  );
  await Promise.all(tasks);
}

async function handleGeocodeJob(job) {
  const { lat, lng, positionId = null, positionIds = [], deviceId = null, reason = "warm_fill", gridKey = null } =
    job.data || {};
  const targetIds = new Set((positionIds || []).filter(Boolean));
  if (positionId !== null && positionId !== undefined) targetIds.add(positionId);

  await initGeocodeCache();

  const cached = getCachedGeocode(lat, lng);
  if (cached) {
    const formatted = formatResolvedAddress(cached);
    if (formatted && targetIds.size) {
      await persistPositionAddresses(Array.from(targetIds), formatted);
    }
    return {
      status: "cached",
      gridKey,
      deviceId,
      reason,
      cachedAt: cached?.cachedAt || null,
    };
  }

  const resolved = await resolveReverseGeocode(lat, lng);
  const normalized = normalizeGeocodePayload(resolved, lat, lng);
  const entry = await persistGeocode(lat, lng, normalized);
  const formatted = formatResolvedAddress(entry || normalized);
  if (formatted && targetIds.size) {
    await persistPositionAddresses(Array.from(targetIds), formatted);
  }

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
  const stop = registerGeocodeProcessor(handleGeocodeJob, {
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3,
  });

  return typeof stop === "function" ? stop : () => {};
}

export default startGeocodeWorker;
