import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api.js";
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

export function useLivePositions({
  deviceIds,
  refreshInterval = 5_000,
  maxConsecutiveErrors = 3,
  pauseWhenHidden = true,
} = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const mountedRef = useRef(true);
  const abortRef = useRef(null);

  const ids = useMemo(() => {
    if (!deviceIds) return [];
    if (Array.isArray(deviceIds)) return deviceIds;
    return [deviceIds];
  }, [deviceIds]);

  const fetchPositions = useCallback(async () => {
    setError(null);
    setLoading((current) => current || !fetchedAt);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const targets = ids.length ? ids : [null];
      const requests = targets.map((deviceId) => {
        const params = deviceId ? { deviceId } : {};
        if (tenantId) params.clientId = tenantId;
        return api
          .get(API_ROUTES.lastPositions, {
            params: Object.keys(params).length ? params : undefined,
            signal: controller.signal,
          })
          .then((response) => normalise(response?.data))
          .catch((requestError) => {
            console.warn("Failed to load live position", deviceId, requestError);
            return [];
          });
      });
      const results = await Promise.all(requests);
      if (!mountedRef.current) return;
      const merged = [].concat(...results).filter(Boolean);
      setPositions(merged);
      setFetchedAt(new Date());
      setError(null);
    } catch (requestError) {
      if (controller.signal?.aborted || !mountedRef.current) return;
      if (!mountedRef.current) return;
      const friendly = requestError?.response?.data?.message || requestError.message || t("errors.loadPositions");
      setError(new Error(friendly));
      throw requestError;
    } finally {
      if (abortRef.current === controller && mountedRef.current) {
        setLoading(false);
      }
    }
  }, [fetchedAt, ids, tenantId, t]);

  usePollingTask(fetchPositions, {
    enabled: true,
    intervalMs: refreshInterval,
    maxConsecutiveErrors,
    pauseWhenHidden,
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

  return { positions, loading, error, refresh, fetchedAt };
}

export default useLivePositions;
