import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTenant } from "../tenant-context.jsx";

const STORAGE_KEY = "userPrefs:monitoring";

const DEFAULT_PREFERENCES = {
  monitoringTableColumns: null,
  monitoringColumnWidths: null,
  routeReportColumns: null,
  tripsReportColumns: null,
  monitoringDefaultFilters: null,
  monitoringLayoutVisibility: null,
  monitoringMapHeight: null,
  reportEventScope: "active",
};

function normaliseColumns(columns) {
  if (!columns || typeof columns !== "object") return null;
  const visible = columns.visible && typeof columns.visible === "object" ? { ...columns.visible } : undefined;
  const order = Array.isArray(columns.order) ? [...columns.order] : undefined;
  const widths = columns.widths && typeof columns.widths === "object" ? { ...columns.widths } : undefined;

  if (!visible && !order && !widths) return null;

  return {
    ...(visible ? { visible } : {}),
    ...(order ? { order } : {}),
    ...(widths ? { widths } : {}),
  };
}

function normalisePreferences(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFERENCES };

  return {
    ...DEFAULT_PREFERENCES,
    ...raw,
    monitoringTableColumns: normaliseColumns(raw.monitoringTableColumns),
    routeReportColumns: normaliseColumns(raw.routeReportColumns),
    tripsReportColumns: normaliseColumns(raw.tripsReportColumns),
    monitoringDefaultFilters:
      typeof raw.monitoringDefaultFilters === "object" ? { ...raw.monitoringDefaultFilters } : null,
    monitoringLayoutVisibility:
      typeof raw.monitoringLayoutVisibility === "object"
        ? { ...raw.monitoringLayoutVisibility }
        : null,
    reportEventScope: raw.reportEventScope === "all" ? "all" : "active",
  };
}

function getLocalStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch (_error) {
    // noop
  }
  return null;
}

function readStoredPreferences() {
  const storage = getLocalStorage();
  if (!storage) return { ...DEFAULT_PREFERENCES };

  try {
    const stored = storage.getItem(STORAGE_KEY);
    return stored ? normalisePreferences(JSON.parse(stored)) : { ...DEFAULT_PREFERENCES };
  } catch (_error) {
    return { ...DEFAULT_PREFERENCES };
  }
}

export default function useUserPreferences() {
  const { isAuthenticated, contextSwitching, contextSwitchKey, contextAbortSignal, user } = useTenant();
  const [preferences, setPreferences] = useState(() => readStoredPreferences());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const isMountedRef = useRef(true);
  const forbiddenRef = useRef(false);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);
  useEffect(() => {
    forbiddenRef.current = false;
  }, [user?.id]);

  const persistLocally = useCallback((next) => {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (_error) {
      // Ignore persistence failures; keep in-memory state
    }
  }, []);

  const clearLocalPreferences = useCallback(() => {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      storage.removeItem(STORAGE_KEY);
    } catch (_error) {
      // Ignore persistence failures; keep in-memory state
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!isAuthenticated || contextSwitching || forbiddenRef.current) {
      return readStoredPreferences();
    }
    setLoading(true);
    setError(null);

    const localPreferences = readStoredPreferences();
    if (isMountedRef.current) {
      setPreferences(localPreferences);
    }

    try {
      const response = await api.get(API_ROUTES.userPreferences, { signal: contextAbortSignal });
      const remotePreferences = normalisePreferences(response?.data?.preferences);

      if (isMountedRef.current) {
        setPreferences(remotePreferences);
        persistLocally(remotePreferences);
      }

      return remotePreferences;
    } catch (fetchError) {
      const status = Number(fetchError?.status || fetchError?.response?.status);
      if (status === 403) {
        forbiddenRef.current = true;
      }
      if (isMountedRef.current) {
        setError(fetchError);
      }
      return localPreferences;
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [contextAbortSignal, contextSwitching, isAuthenticated, persistLocally]);

  useEffect(() => {
    if (!isAuthenticated || contextSwitching) return;
    refresh();
  }, [contextSwitchKey, contextSwitching, isAuthenticated, refresh]);

  const savePreferences = useCallback(
    async (updates) => {
      const next = normalisePreferences({ ...preferences, ...(updates || {}) });
      setPreferences(next);
      persistLocally(next);
      setError(null);

      try {
        setSaving(true);
        const response = await api.put(API_ROUTES.userPreferences, next);
        const persisted = normalisePreferences(response?.data?.preferences || next);

        if (isMountedRef.current) {
          setPreferences(persisted);
          persistLocally(persisted);
        }

        return persisted;
      } catch (saveError) {
        if (isMountedRef.current) {
          setError(saveError);
        }
        return Promise.reject(saveError);
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [preferences, persistLocally],
  );

  const resetPreferences = useCallback(async () => {
    setPreferences({ ...DEFAULT_PREFERENCES });
    clearLocalPreferences();
    setError(null);

    try {
      setSaving(true);
      const response = await api.delete(API_ROUTES.userPreferences);
      const cleared = normalisePreferences(response?.data?.preferences || DEFAULT_PREFERENCES);

      if (isMountedRef.current) {
        setPreferences(cleared);
        persistLocally(cleared);
      }

      return cleared;
    } catch (resetError) {
      if (isMountedRef.current) {
        setError(resetError);
      }
      return Promise.reject(resetError);
    } finally {
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  }, [clearLocalPreferences, persistLocally]);

  return useMemo(
    () => ({
      preferences: preferences || { ...DEFAULT_PREFERENCES },
      loading,
      isSaving: saving,
      error,
      refresh,
      savePreferences,
      resetPreferences,
    }),
    [error, loading, preferences, refresh, resetPreferences, savePreferences, saving],
  );
}
