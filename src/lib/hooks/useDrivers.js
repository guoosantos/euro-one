import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api.js";

function normaliseDrivers(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.drivers)) return payload.drivers;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function useDrivers({ params = {}, autoRefreshMs = 60_000 } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const paramsKey = useMemo(() => JSON.stringify(params || {}), [params]);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function fetchDrivers() {
      setLoading(true);
      setError(null);
      try {
        const parsedParams = paramsKey ? JSON.parse(paramsKey) : {};
        const response = await api.get("/drivers", { params: parsedParams });
        if (cancelled) return;
        setData(normaliseDrivers(response?.data));
      } catch (requestError) {
        if (cancelled) return;
        console.error("Failed to load drivers", requestError);
        setError(requestError instanceof Error ? requestError : new Error("Erro ao carregar motoristas"));
        setData([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (autoRefreshMs) {
            timer = globalThis.setTimeout(fetchDrivers, autoRefreshMs);
          }
        }
      }
    }

    fetchDrivers();

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

  const createDriver = useCallback(async (payload) => {
    const response = await api.post("/drivers", payload);
    reload();
    return response?.data;
  }, [reload]);

  const updateDriver = useCallback(
    async (id, payload) => {
      const response = await api.put(`/drivers/${id}`, payload);
      reload();
      return response?.data;
    },
    [reload],
  );

  const deleteDriver = useCallback(
    async (id) => {
      await api.delete(`/drivers/${id}`);
      reload();
    },
    [reload],
  );

  return useMemo(
    () => ({ drivers: data, loading, error, reload, createDriver, updateDriver, deleteDriver }),
    [data, loading, error, reload, createDriver, updateDriver, deleteDriver],
  );
}

export default useDrivers;
