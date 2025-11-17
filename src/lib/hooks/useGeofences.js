import { useCallback, useEffect, useState } from "react";
import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";

function normaliseGeofences(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.geofences)) return payload.geofences;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function useGeofences({ autoRefreshMs = 60_000 } = {}) {
  const [geofences, setGeofences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function fetchGeofences() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get(API_ROUTES.geofences);
        if (cancelled) return;
        setGeofences(normaliseGeofences(response?.data));
      } catch (requestError) {
        if (cancelled) return;
        console.error("Failed to load geofences", requestError);
        setError(requestError);
        setGeofences([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (autoRefreshMs) {
            timer = setTimeout(fetchGeofences, autoRefreshMs);
          }
        }
      }
    }

    fetchGeofences();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [autoRefreshMs, version]);

  const refresh = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  const createGeofence = useCallback(async (payload) => {
    const response = await api.post(API_ROUTES.geofences, payload);
    refresh();
    return response?.data;
  }, [refresh]);

  const updateGeofence = useCallback(
    async (id, payload) => {
      const response = await api.put(`/geofences/${id}`, payload);
      refresh();
      return response?.data;
    },
    [refresh],
  );

  const assignToDevice = useCallback(
    async ({ geofenceId, deviceId, groupId }) => {
      const payload = {
        geofenceId,
        ...(deviceId ? { deviceId } : {}),
        ...(groupId ? { groupId } : {}),
      };
      const response = await api.post("permissions", payload);
      refresh();
      return response?.data;
    },
    [refresh],
  );

  return {
    geofences,
    loading,
    error,
    refresh,
    createGeofence,
    updateGeofence,
    assignToDevice,
  };
}

export default useGeofences;
