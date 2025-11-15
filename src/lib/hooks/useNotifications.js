import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api.js";

function normaliseNotifications(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.notifications)) return payload.notifications;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function useNotifications({ params = {}, autoRefreshMs = 60_000 } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const paramsKey = useMemo(() => JSON.stringify(params || {}), [params]);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function fetchNotifications() {
      setLoading(true);
      setError(null);
      try {
        const parsedParams = paramsKey ? JSON.parse(paramsKey) : {};
        const response = await api.get("/notifications", { params: parsedParams });
        if (cancelled) return;
        setData(normaliseNotifications(response?.data));
      } catch (requestError) {
        if (cancelled) return;
        console.error("Failed to load notifications", requestError);
        setError(requestError instanceof Error ? requestError : new Error("Erro ao carregar notificações"));
        setData([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (autoRefreshMs) {
            timer = globalThis.setTimeout(fetchNotifications, autoRefreshMs);
          }
        }
      }
    }

    fetchNotifications();

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

  const createNotification = useCallback(async (payload) => {
    const response = await api.post("/notifications", payload);
    reload();
    return response?.data;
  }, [reload]);

  const updateNotification = useCallback(
    async (id, payload) => {
      const response = await api.put(`/notifications/${id}`, payload);
      reload();
      return response?.data;
    },
    [reload],
  );

  const deleteNotification = useCallback(
    async (id) => {
      await api.delete(`/notifications/${id}`);
      reload();
    },
    [reload],
  );

  return useMemo(
    () => ({ notifications: data, loading, error, reload, createNotification, updateNotification, deleteNotification }),
    [data, loading, error, reload, createNotification, updateNotification, deleteNotification],
  );
}

export default useNotifications;
