import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import api from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTenant } from "../tenant-context.jsx";

const STORAGE_KEY_PREFIX = "userPrefs:monitoring";

const MONITORING_CONTEXT_KEYS = new Set([
  "monitoringTableColumns",
  "monitoringColumnWidths",
  "monitoringDefaultFilters",
  "monitoringLayoutVisibility",
  "monitoringMapLayerKey",
  "monitoringMapHeight",
  "monitoringSearchRadius",
  "monitoringPanelRatio",
]);

const DEFAULT_PREFERENCES = {
  monitoringTableColumns: null,
  monitoringColumnWidths: null,
  routeReportColumns: null,
  tripsReportColumns: null,
  monitoringDefaultFilters: null,
  monitoringLayoutVisibility: null,
  monitoringMapLayerKey: null,
  monitoringMapHeight: null,
  monitoringSearchRadius: null,
  monitoringPanelRatio: null,
  monitoringContexts: null,
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
    monitoringMapLayerKey: typeof raw.monitoringMapLayerKey === "string" ? raw.monitoringMapLayerKey : null,
    monitoringMapHeight: Number.isFinite(Number(raw.monitoringMapHeight)) ? Number(raw.monitoringMapHeight) : null,
    monitoringSearchRadius: Number.isFinite(Number(raw.monitoringSearchRadius)) ? Number(raw.monitoringSearchRadius) : null,
    monitoringPanelRatio: Number.isFinite(Number(raw.monitoringPanelRatio)) ? Number(raw.monitoringPanelRatio) : null,
    monitoringContexts:
      raw.monitoringContexts && typeof raw.monitoringContexts === "object" && !Array.isArray(raw.monitoringContexts)
        ? { ...raw.monitoringContexts }
        : null,
    reportEventScope: raw.reportEventScope === "all" ? "all" : "active",
  };
}

function normaliseContextEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const base = normalisePreferences(raw);
  const entry = {};
  MONITORING_CONTEXT_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      entry[key] = base[key];
    }
  });
  return Object.keys(entry).length ? entry : null;
}

function resolveContextOverrides(preferences, contextKey) {
  if (!contextKey) return null;
  const contexts = preferences?.monitoringContexts;
  if (!contexts || typeof contexts !== "object") return null;
  const entry = contexts[contextKey];
  return normaliseContextEntry(entry);
}

function getLocalStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch (_error) {
    // noop
  }
  return null;
}

function buildStorageKey(userId) {
  return `${STORAGE_KEY_PREFIX}:${userId ? String(userId) : "anon"}`;
}

function readStoredPreferences(storageKey) {
  const storage = getLocalStorage();
  if (!storage) return { ...DEFAULT_PREFERENCES };

  try {
    const stored = storage.getItem(storageKey);
    return stored ? normalisePreferences(JSON.parse(stored)) : { ...DEFAULT_PREFERENCES };
  } catch (_error) {
    return { ...DEFAULT_PREFERENCES };
  }
}

function stripUndefinedValues(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => typeof entryValue !== "undefined"),
  );
}

function buildNextPreferences(base, updates, scopedContextKey = null) {
  const safeUpdates = updates && typeof updates === "object" ? updates : {};
  if (!scopedContextKey) {
    return {
      next: normalisePreferences({ ...base, ...safeUpdates }),
      payload: stripUndefinedValues(safeUpdates),
    };
  }

  const contextMap =
    base.monitoringContexts && typeof base.monitoringContexts === "object"
      ? { ...base.monitoringContexts }
      : {};
  const existingEntry = contextMap[scopedContextKey];
  const entryBase = normaliseContextEntry(existingEntry) || {};
  const entryUpdates = normaliseContextEntry(safeUpdates) || {};
  const nextEntry = { ...entryBase, ...entryUpdates };
  if (Object.keys(nextEntry).length) {
    contextMap[scopedContextKey] = nextEntry;
  }

  const globalUpdates = { ...safeUpdates };
  MONITORING_CONTEXT_KEYS.forEach((key) => {
    delete globalUpdates[key];
  });

  return {
    next: normalisePreferences({
      ...base,
      ...globalUpdates,
      monitoringContexts: Object.keys(contextMap).length ? contextMap : null,
    }),
    payload: stripUndefinedValues({
      ...globalUpdates,
      monitoringContexts: Object.keys(contextMap).length ? contextMap : null,
    }),
  };
}

export default function useUserPreferences({ contextKey } = {}) {
  const { isAuthenticated, contextSwitching, contextSwitchKey, contextAbortSignal, user } = useTenant();
  const storageKey = useMemo(() => buildStorageKey(user?.id), [user?.id]);
  const [rawPreferences, setRawPreferences] = useState(() => readStoredPreferences(storageKey));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const isMountedRef = useRef(true);
  const forbiddenRef = useRef(false);
  const contextKeyRef = useRef(contextKey);
  const rawPreferencesRef = useRef(readStoredPreferences(storageKey));
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);
  useEffect(() => {
    forbiddenRef.current = false;
  }, [user?.id]);
  useEffect(() => {
    const stored = readStoredPreferences(storageKey);
    rawPreferencesRef.current = stored;
    setRawPreferences(stored);
  }, [storageKey]);
  useEffect(() => {
    rawPreferencesRef.current = normalisePreferences(rawPreferences);
  }, [rawPreferences]);

  const persistLocally = useCallback((next) => {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      storage.setItem(storageKey, JSON.stringify(next));
    } catch (_error) {
      // Ignore persistence failures; keep in-memory state
    }
  }, [storageKey]);

  const clearLocalPreferences = useCallback(() => {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      storage.removeItem(storageKey);
    } catch (_error) {
      // Ignore persistence failures; keep in-memory state
    }
  }, [storageKey]);

  const refresh = useCallback(async () => {
    if (!isAuthenticated || contextSwitching || forbiddenRef.current) {
      return readStoredPreferences(storageKey);
    }
    setLoading(true);
    setError(null);

    const localPreferences = readStoredPreferences(storageKey);
    if (isMountedRef.current) {
      rawPreferencesRef.current = localPreferences;
      setRawPreferences(localPreferences);
    }

    try {
      const response = await api.get(API_ROUTES.userPreferences, { signal: contextAbortSignal });
      const remotePreferences = normalisePreferences(response?.data?.preferences);

      if (isMountedRef.current) {
        rawPreferencesRef.current = remotePreferences;
        setRawPreferences(remotePreferences);
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
  }, [contextAbortSignal, contextSwitching, isAuthenticated, persistLocally, storageKey]);

  useEffect(() => {
    if (!isAuthenticated || contextSwitching) return;
    refresh();
  }, [contextSwitchKey, contextSwitching, isAuthenticated, refresh]);

  const savePreferences = useCallback(
    async (updates = {}, options = {}) => {
      const scopedContextKey = options.contextKey ?? contextKeyRef.current ?? null;
      const base = normalisePreferences(rawPreferencesRef.current);
      const { next, payload } = buildNextPreferences(base, updates, scopedContextKey);
      const hasPayload = Object.keys(payload).length > 0;

      rawPreferencesRef.current = next;
      setRawPreferences(next);
      persistLocally(next);
      setError(null);
      if (!hasPayload) {
        return next;
      }

      const runSave = async () => {
        if (!isMountedRef.current) {
          return next;
        }

        setSaving(true);
        const response = await api.put(API_ROUTES.userPreferences, payload);
        const persisted = normalisePreferences(response?.data?.preferences || next);

        if (isMountedRef.current) {
          rawPreferencesRef.current = persisted;
          setRawPreferences(persisted);
          persistLocally(persisted);
        }

        return persisted;
      };

      const pending = saveQueueRef.current
        .catch(() => null)
        .then(runSave)
        .catch((saveError) => {
          if (isMountedRef.current) {
            setError(saveError);
          }
          throw saveError;
        })
        .finally(() => {
          if (isMountedRef.current) {
            setSaving(false);
          }
        });

      saveQueueRef.current = pending;

      try {
        return await pending;
      } catch (saveError) {
        if (isMountedRef.current) {
          setError(saveError);
        }
        throw saveError;
      }
    },
    [persistLocally],
  );

  const resetPreferences = useCallback(async () => {
    rawPreferencesRef.current = { ...DEFAULT_PREFERENCES };
    setRawPreferences({ ...DEFAULT_PREFERENCES });
    clearLocalPreferences();
    setError(null);

    try {
      setSaving(true);
      const response = await api.delete(API_ROUTES.userPreferences);
      const cleared = normalisePreferences(response?.data?.preferences || DEFAULT_PREFERENCES);

      if (isMountedRef.current) {
        rawPreferencesRef.current = cleared;
        setRawPreferences(cleared);
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

  const resolvedContextKey = contextKey || null;
  useEffect(() => {
    contextKeyRef.current = resolvedContextKey;
  }, [resolvedContextKey]);

  const preferences = useMemo(() => {
    const base = normalisePreferences(rawPreferences);
    const overrides = resolveContextOverrides(base, resolvedContextKey);
    if (!overrides) return base;
    return normalisePreferences({ ...base, ...overrides });
  }, [rawPreferences, resolvedContextKey]);

  return useMemo(
    () => ({
      preferences: preferences || { ...DEFAULT_PREFERENCES },
      rawPreferences: rawPreferences || { ...DEFAULT_PREFERENCES },
      loading,
      isSaving: saving,
      error,
      refresh,
      savePreferences,
      resetPreferences,
    }),
    [error, loading, preferences, rawPreferences, refresh, resetPreferences, savePreferences, saving],
  );
}
