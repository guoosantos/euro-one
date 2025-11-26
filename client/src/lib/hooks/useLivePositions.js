import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";
import { usePollingTask } from "./usePollingTask.js";

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
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const mountedRef = useRef(true);
  const abortRef = useRef(null);
  const initialLoadRef = useRef(true);

  const ids = useMemo(() => {
    if (!deviceIds) return [];
    if (Array.isArray(deviceIds)) return deviceIds;
    return [deviceIds];
  }, [deviceIds]);

  const fetchPositions = useCallback(async () => {
    if (!enabled || !mountedRef.current) return;
    setError(null);
    setLoading((current) => current || initialLoadRef.current);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const params = {};
      if (ids.length) params.deviceId = ids;
      if (tenantId) params.clientId = tenantId;

      const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.lastPositions, {
        params: Object.keys(params).length ? params : undefined,
        signal: controller.signal,
      });

      if (!mountedRef.current || controller.signal?.aborted) return;
      if (requestError) {
        if (safeApi.isAbortError(requestError)) return;
        const friendly = requestError?.response?.data?.message || requestError.message || t("errors.loadPositions");
        const normalised = new Error(friendly);
        setError(normalised);
        throw normalised;
      }
      const merged = dedupeByDevice(normalise(payload));
      setPositions(merged);
      setFetchedAt(new Date());
      setError(null);
    } finally {
      if (abortRef.current === controller && mountedRef.current) {
        setLoading(false);
      }
      initialLoadRef.current = false;
    }
  }, [enabled, ids, tenantId, t]);

  const pollingEnabled = enabled && (ids.length > 0 || deviceIds === null || deviceIds === undefined);

  usePollingTask(fetchPositions, {
    enabled: pollingEnabled,
    intervalMs: refreshInterval,
    maxConsecutiveErrors,
    pauseWhenHidden,
    backoffFactor: 2,
    maxIntervalMs: 60_000,
    onPermanentFailure: (err) => {
      if (!err || !mountedRef.current) return;
      console.error("Live positions polling halted after consecutive failures", err);
    },
  });

  const refresh = useCallback(() => {
    void fetchPositions();
  }, [fetchPositions]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      abortRef.current?.abort();
      mountedRef.current = false;
    };
  }, []);

  const data = Array.isArray(positions) ? positions : [];
  return { data, positions: data, loading, error, refresh, fetchedAt };
}

export default useLivePositions;
