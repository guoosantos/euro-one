import { useEffect, useMemo, useState } from "react";
import api from "../api.js";

export function useTrips({ deviceId, from, to, limit = 10, refreshInterval } = {}) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [fetchedAt, setFetchedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function fetchTrips() {
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
        const response = await api.post("/reports/trips", payload);
        if (cancelled) return;
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
      } catch (requestError) {
        if (cancelled) return;
        setError(requestError);
        setTrips([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (refreshInterval) {
            timer = setTimeout(fetchTrips, refreshInterval);
          }
        }
      }
    }

    fetchTrips();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [deviceId, from, to, limit, refreshInterval, version]);

  const refresh = useMemo(
    () => () => {
      setVersion((value) => value + 1);
    },
    [],
  );

  return { trips, loading, error, fetchedAt, refresh };
}

export default useTrips;
