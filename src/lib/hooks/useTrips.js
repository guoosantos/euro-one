import { useEffect, useMemo, useState } from "react";
import { API } from "../api";
import { matchesTenant } from "../tenancy";

export function useTrips({ tenantId, limit = 10, autoRefreshMs } = {}) {
  const [state, setState] = useState({ trips: [], loading: true, error: null, fetchedAt: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    let timer;

    const load = async () => {
      setState((prev) => ({
        ...prev,
        loading: prev.trips.length === 0,
        error: null,
      }));

      try {
        const response = await API.trips.list({ tenantId, limit });
        if (!active) return;
        const data = response?.data ?? response;
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data?.trips)
          ? data.trips
          : Array.isArray(data?.items)
          ? data.items
          : [];
        const filtered = tenantId ? items.filter((trip) => matchesTenant(trip, tenantId)) : items;
        setState({ trips: filtered.slice(0, limit), loading: false, error: null, fetchedAt: new Date() });
      } catch (error) {
        if (!active) return;
        setState((prev) => ({ ...prev, loading: false, error }));
      } finally {
        if (!active || !autoRefreshMs) return;
        timer = setTimeout(() => {
          setVersion((value) => value + 1);
        }, autoRefreshMs);
      }
    };

    load();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [tenantId, limit, version, autoRefreshMs]);

  const refresh = useMemo(
    () => () => {
      setVersion((value) => value + 1);
    },
    [],
  );

  return { ...state, refresh };
}
