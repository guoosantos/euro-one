import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api.js";

function normaliseCommands(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.commands)) return payload.commands;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function useCommands({ params = {}, autoRefreshMs = 60_000 } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const paramsKey = useMemo(() => JSON.stringify(params || {}), [params]);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function fetchCommands() {
      setLoading(true);
      setError(null);
      try {
        const parsedParams = paramsKey ? JSON.parse(paramsKey) : {};
        const response = await api.get("/commands", { params: parsedParams });
        if (cancelled) return;
        setData(normaliseCommands(response?.data));
      } catch (requestError) {
        if (cancelled) return;
        console.error("Failed to load commands", requestError);
        setError(requestError instanceof Error ? requestError : new Error("Erro ao carregar comandos"));
        setData([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (autoRefreshMs) {
            timer = globalThis.setTimeout(fetchCommands, autoRefreshMs);
          }
        }
      }
    }

    fetchCommands();

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

  const sendCommand = useCallback(async (payload) => {
    const response = await api.post("/commands", payload);
    reload();
    return response?.data;
  }, [reload]);

  const updateCommand = useCallback(
    async (id, payload) => {
      const response = await api.put(`/commands/${id}`, payload);
      reload();
      return response?.data;
    },
    [reload],
  );

  const deleteCommand = useCallback(
    async (id) => {
      await api.delete(`/commands/${id}`);
      reload();
    },
    [reload],
  );

  return useMemo(
    () => ({ commands: data, loading, error, reload, sendCommand, updateCommand, deleteCommand }),
    [data, loading, error, reload, sendCommand, updateCommand, deleteCommand],
  );
}

export default useCommands;
