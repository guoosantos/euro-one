import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import safeApi from "../safe-api.js";
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
  enabled = true,
} = {}) {
  const { tenantId } = useTenant();
  const { t } = useTranslation();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const mountedRef = useRef(true);
  const abortRef = useRef(null);
  const initialLoadRef = useRef(true);

  const resolvedInterval = autoRefreshMs ?? refreshInterval;

  const fetchEvents = useCallback(async () => {
    if (!enabled || !mountedRef.current) return;
    setLoading((current) => current || initialLoadRef.current);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const params = buildParams({ deviceId, types, from, to, limit });
      if (tenantId) params.clientId = tenantId;

      const { data: payload, error: requestError } = await safeApi.get(API_ROUTES.events, {
        params,
        signal: controller.signal,
      });

      if (!mountedRef.current || controller.signal?.aborted) return;
      if (requestError) {
        if (safeApi.isAbortError(requestError)) return;
        console.error("Failed to load events", requestError);
        const friendly = requestError?.response?.data?.message || requestError.message || t("errors.loadEvents");
        const normalised = new Error(friendly);
        setError(normalised);
        setEvents([]);
        throw normalised;
      }

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
    } finally {
      if (mountedRef.current && abortRef.current === controller) {
        setLoading(false);
      }
      initialLoadRef.current = false;
    }
  }, [deviceId, types, from, to, limit, tenantId, enabled, t]);

  usePollingTask(fetchEvents, {
    enabled,
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
      abortRef.current?.abort();
      mountedRef.current = false;
    };
  }, []);

  return useMemo(
    () => ({ events, loading, error, refresh, lastUpdated }),
    [events, loading, error, refresh, lastUpdated],
  );
}

export default useEvents;
