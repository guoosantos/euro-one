import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api";

function buildParams({ deviceId, types, from, to, limit }) {
  const params = {};
  if (deviceId) params.deviceId = deviceId;
  if (Array.isArray(types) && types.length) {
    params.type = types.join(",");
  } else if (typeof types === "string") {
    params.type = types;
  }
  if (from) params.from = from;
  if (to) params.to = to;
  if (limit) params.limit = limit;
  return params;
}

export function useEvents({ deviceId, types, from, to, limit = 50, refreshInterval = 15_000 } = {}) {
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
        const response = await api.get("/events", { params });
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
        setError(requestError);
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
  }, [deviceId, types, from, to, limit, refreshInterval, version]);

  const refresh = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  return useMemo(
    () => ({ events, loading, error, refresh, lastUpdated }),
    [events, loading, error, refresh, lastUpdated],
  );
}

export default useEvents;
