import { useCallback, useEffect, useState } from "react";

import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";

function normaliseGroups(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.groups)) return payload.groups;
  return [];
}

export function useGeofenceGroups({ includeGeofences = true } = {}) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchGroups() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get(API_ROUTES.geofenceGroups, {
          params: { includeGeofences: includeGeofences ? "true" : "false" },
        });
        if (cancelled) return;
        setGroups(normaliseGroups(response?.data));
      } catch (requestError) {
        if (cancelled) return;
        console.error("Failed to load geofence groups", requestError);
        setError(requestError);
        setGroups([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchGroups();
    return () => {
      cancelled = true;
    };
  }, [includeGeofences, version]);

  const refresh = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  const createGroup = useCallback(
    async (payload) => {
      const response = await api.post(API_ROUTES.geofenceGroups, payload);
      refresh();
      return response?.data;
    },
    [refresh],
  );

  const updateGroup = useCallback(
    async (id, payload) => {
      const response = await api.put(`${API_ROUTES.geofenceGroups}/${id}`, payload);
      refresh();
      return response?.data;
    },
    [refresh],
  );

  const deleteGroup = useCallback(
    async (id) => {
      const response = await api.delete(`${API_ROUTES.geofenceGroups}/${id}`);
      refresh();
      return response?.data;
    },
    [refresh],
  );

  const updateGroupGeofences = useCallback(
    async (id, geofenceIds) => {
      const response = await api.put(`${API_ROUTES.geofenceGroups}/${id}/geofences`, { geofenceIds });
      refresh();
      return response?.data;
    },
    [refresh],
  );

  return {
    groups,
    loading,
    error,
    refresh,
    createGroup,
    updateGroup,
    deleteGroup,
    updateGroupGeofences,
  };
}

export default useGeofenceGroups;
