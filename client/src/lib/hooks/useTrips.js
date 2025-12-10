import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import safeApi from "../safe-api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";
import { usePollingTask } from "./usePollingTask.js";
import { ensureHookResult } from "./hook-shape.js";

export function useTrips({
  deviceId,
  from,
  to,
  limit = 10,
  refreshInterval,
  maxConsecutiveErrors = 3,
  pauseWhenHidden = true,
  enabled = true,
} = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const mountedRef = useRef(true);
  const abortRef = useRef(null);
  const initialLoadRef = useRef(true);

  const shouldFetch = Boolean(enabled);

  const fetchTrips = useCallback(async () => {
    if (!shouldFetch || !mountedRef.current) {
      setLoading(false);
      return;
    }
    setLoading((current) => current || initialLoadRef.current);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const payload = {
        from: (from ? new Date(from) : defaultFrom).toISOString(),
        to: (to ? new Date(to) : now).toISOString(),
        type: "all",
      };
      if (deviceId) payload.deviceId = deviceId;
      if (tenantId) payload.clientId = tenantId;

      const { data: responseData, error: requestError } = await safeApi.get(
        API_ROUTES.traccar.reports.trips,
        {
          params: payload,
          signal: controller.signal,
        },
      );

      if (!mountedRef.current || controller.signal?.aborted) return;
      if (requestError) {
        if (safeApi.isAbortError(requestError)) return;
        const friendly = requestError?.response?.data?.message || requestError.message || t("errors.loadTrips");
        const normalised = new Error(friendly);
        setError(normalised);
        setTrips([]);
        if (requestError?.permanent) {
          throw normalised;
        }
        return;
      }
      const payloadData = responseData?.data ?? responseData;
      const items = Array.isArray(payloadData)
        ? payloadData
        : Array.isArray(payloadData?.trips)

        ? payloadData.trips
        : Array.isArray(payloadData?.data?.trips)
        ? payloadData.data.trips
        : Array.isArray(payloadData?.items)
        ? payloadData.items
        : [];

      setTrips(items.slice(0, limit));
      setFetchedAt(new Date());
      setError(null);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      initialLoadRef.current = false;
    }
  }, [shouldFetch, deviceId, from, to, limit, tenantId, t]);

  const pollingEnabled = shouldFetch && typeof refreshInterval === "number" && Number.isFinite(refreshInterval);

  usePollingTask(fetchTrips, {
    enabled: pollingEnabled,
    intervalMs: refreshInterval,
    maxConsecutiveErrors,
    pauseWhenHidden,
    onPermanentFailure: (err) => {
      if (!err || !mountedRef.current) return;
      console.error("Trips polling halted after consecutive failures", err);
    },
  });

  const refresh = useMemo(
    () => () => {
      void fetchTrips().catch(() => {});
    },
    [fetchTrips],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (shouldFetch && !pollingEnabled) {
      void fetchTrips().catch(() => {});
    }
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [fetchTrips, pollingEnabled, shouldFetch]);

  const data = Array.isArray(trips) ? trips : [];
  return ensureHookResult({ data, trips: data, loading, error, fetchedAt, refresh }, { defaultData: [] });
}

export default useTrips;
