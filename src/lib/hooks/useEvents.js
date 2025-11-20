import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";
import { useTenant } from "../tenant-context.jsx";
import { buildParams } from "./events-helpers.js";
import { usePollingTask } from "./usePollingTask.js";

export function useEvents({
  deviceId,
  types,
  from,
  to,
  limit = 50,
  refreshInterval = 15_000,
  autoRefreshMs,
  maxConsecutiveErrors = 3,
  pauseWhenHidden = true,
} = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const mountedRef = useRef(true);

  const resolvedInterval = autoRefreshMs ?? refreshInterval;

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = buildParams({ deviceId, types, from, to, limit });
      if (tenantId) params.clientId = tenantId;
      const response = await api.get(API_ROUTES.events, { params });
      if (!mountedRef.current) return;
      const payload = response?.data;
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.events)
        ? payload.events
        : Array.isArray(payload?.data)
        ? payload.data
        : [];
      setEvents(list.slice(0, limit));
      setLastUpdated(new Date());
      setError(null);
    } catch (requestError) {
      if (!mountedRef.current) return;
      console.error("Failed to load events", requestError);
      const friendly = requestError?.response?.data?.message || requestError.message || t("errors.loadEvents");
      setError(new Error(friendly));
      setEvents([]);
      throw requestError;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [deviceId, types, from, to, limit, tenantId, t]);

  usePollingTask(fetchEvents, {
    enabled: true,
    intervalMs: resolvedInterval,
    maxConsecutiveErrors,
    pauseWhenHidden,
    onPermanentFailure: (err) => {
      if (!err || !mountedRef.current) return;
      console.error("Events polling halted after consecutive failures", err);
    },
  });

  const refresh = useCallback(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return useMemo(
    () => ({ events, loading, error, refresh, lastUpdated }),
    [events, loading, error, refresh, lastUpdated],
  );
}

export default useEvents;
