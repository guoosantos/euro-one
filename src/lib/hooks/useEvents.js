import { useEffect, useMemo, useState } from "react";
import { API } from "../api";
import { matchesTenant } from "../tenancy";

export function useEvents({ tenantId, limit = 10, autoRefreshMs } = {}) {
  const [state, setState] = useState({ events: [], loading: true, error: null, fetchedAt: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    let timer;

    const load = async () => {
      setState((prev) => ({
        ...prev,
        loading: prev.events.length === 0,
        error: null,
      }));

      try {
        const response = await API.events.list({ tenantId, limit });
        if (!active) return;
        const data = response?.data ?? response;
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data?.events)
          ? data.events
          : [];
        const filtered = tenantId ? items.filter((event) => matchesTenant(event, tenantId)) : items;
        setState({
          events: filtered.slice(0, limit),
          loading: false,
          error: null,
          fetchedAt: new Date(),
        });
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
