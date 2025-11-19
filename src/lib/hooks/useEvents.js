import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTenant } from "../tenant-context.jsx";
import { buildParams } from "./events-helpers.js";

export function useEvents({ deviceId, types, from, to, limit = 50, refreshInterval = 15_000 } = {}) {
  const { tenantId } = useTenant();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function fetchEvents() {
      setLoading(true);
      setError(null);
      try {
        const params = buildParams({ deviceId, types, from, to, limit });
        if (tenantId) params.clientId = tenantId;
        const response = await api.get(API_ROUTES.events, { params });
        if (cancelled) return;
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
      } catch (requestError) {
        if (cancelled) return;
        console.error("Failed to load events", requestError);
        const friendly = requestError?.response?.data?.message || requestError.message || "Erro ao carregar eventos";
        setError(new Error(friendly));
        setEvents([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (refreshInterval) {
            timer = setTimeout(fetchEvents, refreshInterval);
          }
        }
      }
    }

    fetchEvents();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [deviceId, types, from, to, limit, refreshInterval, version, tenantId]);

  const refresh = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  return useMemo(
    () => ({ events, loading, error, refresh, lastUpdated }),
    [events, loading, error, refresh, lastUpdated],
  );
}

export default useEvents;
