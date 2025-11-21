import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";
import { usePollingTask } from "./usePollingTask.js";

export function useTrips({
  deviceId,
  from,
  to,
  limit = 10,
  refreshInterval,
  maxConsecutiveErrors = 3,
  pauseWhenHidden = true,
} = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const mountedRef = useRef(true);

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const payload = {
        deviceId,
        from: (from ? new Date(from) : defaultFrom).toISOString(),
        to: (to ? new Date(to) : now).toISOString(),
        type: "all",
      };
      if (tenantId) payload.clientId = tenantId;
      const response = await api.post(API_ROUTES.reports.trips, payload);
      if (!mountedRef.current) return;
      const data = response?.data;
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data?.trips)
        ? data.trips
        : Array.isArray(data?.items)
        ? data.items
        : [];
      setTrips(items.slice(0, limit));
      setFetchedAt(new Date());
      setError(null);
    } catch (requestError) {
      if (!mountedRef.current) return;
      const friendly = requestError?.response?.data?.message || requestError.message || t("errors.loadTrips");
      setError(new Error(friendly));
      setTrips([]);
      throw requestError;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [deviceId, from, to, limit, tenantId, t]);

  usePollingTask(fetchTrips, {
    enabled: true,
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
      void fetchTrips();
    },
    [fetchTrips],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { trips, loading, error, fetchedAt, refresh };
}

export default useTrips;
