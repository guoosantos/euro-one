import { useEffect, useMemo, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTenant } from "../tenant-context.jsx";

export function useTrips({ deviceId, from, to, limit = 10, refreshInterval } = {}) {
  const { tenantId } = useTenant();
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
        if (tenantId) payload.clientId = tenantId;
        const response = await api.post(API_ROUTES.reports.trips, payload);
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
        const friendly = requestError?.response?.data?.message || requestError.message || "Erro ao carregar viagens";
        setError(new Error(friendly));
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
  }, [deviceId, from, to, limit, refreshInterval, version, tenantId]);

  const refresh = useMemo(
    () => () => {
      setVersion((value) => value + 1);
    },
    [],
  );

  return { trips, loading, error, fetchedAt, refresh };
}

export default useTrips;
