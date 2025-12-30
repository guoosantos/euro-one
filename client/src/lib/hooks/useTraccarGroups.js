import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";

function normaliseGroups(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.groups)) return payload.groups;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function useTraccarGroups({ params = {}, autoRefreshMs = 60_000 } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const paramsKey = useMemo(() => JSON.stringify(params || {}), [params]);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function fetchGroups() {
      setLoading(true);
      setError(null);
      try {
        const parsedParams = paramsKey ? JSON.parse(paramsKey) : {};
        const response = await api.get(API_ROUTES.traccar.groups, { params: parsedParams });
        if (cancelled) return;
        setData(normaliseGroups(response?.data));
      } catch (requestError) {
        if (cancelled) return;
        console.error("Failed to load Traccar groups", requestError);
        setError(requestError instanceof Error ? requestError : new Error("Erro ao carregar grupos"));
        setData([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (autoRefreshMs) {
            timer = globalThis.setTimeout(fetchGroups, autoRefreshMs);
          }
        }
      }
    }

    fetchGroups();

    return () => {
      cancelled = true;
      if (timer) {
        globalThis.clearTimeout(timer);
      }
    };
  }, [autoRefreshMs, paramsKey, version]);

  const reload = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  return useMemo(
    () => ({ groups: data, loading, error, reload }),
    [data, loading, error, reload],
  );
}

export default useTraccarGroups;
