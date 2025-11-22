import { useCallback, useMemo, useState } from "react";

const STORAGE_KEY = "userPrefs:monitoring";

const DEFAULT_PREFERENCES = {
  monitoringTableColumns: null,
  monitoringDefaultFilters: null,
};

function readStoredPreferences() {
  if (typeof localStorage === "undefined") return DEFAULT_PREFERENCES;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) } : DEFAULT_PREFERENCES;
  } catch (_error) {
    return DEFAULT_PREFERENCES;
  }
}

export default function useUserPreferences() {
  const [preferences, setPreferences] = useState(() => readStoredPreferences());
  const [loading, setLoading] = useState(false);

  const savePreferences = useCallback((updates) => {
    const next = { ...DEFAULT_PREFERENCES, ...(preferences || {}), ...(updates || {}) };
    setPreferences(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (_error) {
      // Ignore persistence failures; keep in-memory state
    }
    return next;
  }, [preferences]);

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_error) {
      // Ignore persistence failures; keep in-memory state
    }
  }, []);

  return useMemo(
    () => ({
      preferences: preferences || DEFAULT_PREFERENCES,
      loading,
      error: null,
      refresh: () => preferences,
      savePreferences,
      resetPreferences,
    }),
    [preferences, loading, savePreferences, resetPreferences],
  );
}
