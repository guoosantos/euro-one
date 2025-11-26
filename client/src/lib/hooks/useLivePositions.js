import { useCallback, useMemo } from "react";
import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";
import { useSharedPollingResource } from "./useSharedPollingResource.js";

function normalise(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  if (Array.isArray(payload?.data)) return payload.data;
  return payload ? [payload] : [];
}

function dedupeByDevice(positions = []) {
  const latestByDevice = new Map();
  positions.forEach((pos) => {
    const deviceId = pos?.deviceId ?? pos?.device_id ?? pos?.deviceid ?? pos?.deviceID;
    const key = deviceId != null ? String(deviceId) : null;
    if (!key) return;
    const time = Date.parse(pos.fixTime ?? pos.serverTime ?? pos.deviceTime ?? pos.time ?? 0);
    const current = latestByDevice.get(key);
    if (!current || (!Number.isNaN(time) && time > current.time)) {
      latestByDevice.set(key, { pos, time });
    }
  });
  return Array.from(latestByDevice.values())
    .map((entry) => entry.pos)
    .filter(Boolean);
}

export function useLivePositions({
  deviceIds,
  refreshInterval = 5_000,
  maxConsecutiveErrors = 3,
  pauseWhenHidden = true,
  enabled = true,
} = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();

  const ids = useMemo(() => {
    if (!deviceIds) return [];
    if (Array.isArray(deviceIds)) return deviceIds;
    return [deviceIds];
  }, [deviceIds]);

  const pollingEnabled = enabled && (ids.length > 0 || deviceIds === null || deviceIds === undefined);

  const cacheKey = useMemo(() => {
    const idsKey = ids
      .map((value) => (value === null || value === undefined ? "null" : String(value)))
      .sort()
      .join(",");
    return `last-positions:${tenantId || "global"}:${idsKey || "all"}`;
  }, [ids, tenantId]);

  const { data: positions = [], loading, error, fetchedAt, refresh } = useSharedPollingResource(
    cacheKey,
    useCallback(
      async ({ signal }) => {
        const params = {};
        if (ids.length) params.deviceId = ids;
        if (tenantId) params.clientId = tenantId;

        const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.lastPositions, {
          params: Object.keys(params).length ? params : undefined,
          signal,
        });

        if (requestError) {
          if (safeApi.isAbortError(requestError)) throw requestError;
          const friendly = requestError?.response?.data?.message || requestError.message || t("errors.loadPositions");
          throw new Error(friendly);
        }
        return dedupeByDevice(normalise(payload));
      },
      [ids, t, tenantId],
    ),
    {
      enabled: pollingEnabled,
      intervalMs: refreshInterval,
      maxConsecutiveErrors,
      pauseWhenHidden,
      backoffFactor: 2,
      maxIntervalMs: 60_000,
      initialData: [],
    },
  );

  const data = Array.isArray(positions) ? positions : [];
  return { data, positions: data, loading, error, refresh, fetchedAt };
}

export default useLivePositions;
