import { useCallback, useEffect, useMemo, useState } from "react";

import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";

const DEFAULT_PREFERENCES = {
  monitoringTableColumns: null,
  monitoringDefaultFilters: null,
};

export default function useUserPreferences() {
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPreferences = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(API_ROUTES.userPreferences);
      setPreferences(response.data?.preferences || DEFAULT_PREFERENCES);
    } catch (fetchError) {
      const friendly =
        fetchError?.response?.data?.message || fetchError?.message || "Não foi possível carregar preferências.";
      setError(new Error(friendly));
    } finally {
      setLoading(false);
    }
  }, []);

  const savePreferences = useCallback(async (updates) => {
    const nextPayload = { ...DEFAULT_PREFERENCES, ...(preferences || {}), ...(updates || {}) };
    setPreferences(nextPayload);
    try {
      const response = await api.put(API_ROUTES.userPreferences, nextPayload);
      if (response?.data?.preferences) {
        setPreferences(response.data.preferences);
      }
      return response?.data?.preferences || nextPayload;
    } catch (saveError) {
      const friendly =
        saveError?.response?.data?.message || saveError?.message || "Não foi possível salvar preferências.";
      const wrapped = new Error(friendly);
      setError(wrapped);
      throw wrapped;
    }
  }, [preferences]);

  const resetPreferences = useCallback(async () => {
    setPreferences(DEFAULT_PREFERENCES);
    try {
      await api.delete(API_ROUTES.userPreferences);
    } catch (resetError) {
      const friendly =
        resetError?.response?.data?.message || resetError?.message || "Não foi possível restaurar preferências.";
      setError(new Error(friendly));
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const value = useMemo(
    () => ({
      preferences: preferences || DEFAULT_PREFERENCES,
      loading,
      error,
      refresh: fetchPreferences,
      savePreferences,
      resetPreferences,
    }),
    [preferences, loading, error, fetchPreferences, savePreferences, resetPreferences],
  );

  return value;
}
