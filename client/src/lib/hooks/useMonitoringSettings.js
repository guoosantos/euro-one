import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildColumnDefaults,
  loadColumnPreferences,
  mergeColumnPreferences,
  reorderColumns,
  resolveVisibleColumns,
  saveColumnPreferences,
} from "../column-preferences.js";

const DEFAULT_STORAGE_KEY = "monitoring.table.columns";
const PANEL_STORAGE_KEY = "monitoring.panel.ratio";
const MAP_HEIGHT_KEY = "monitoring.map.height";
const SEARCH_RADIUS_KEY = "monitoring.search.radius";
const DEFAULT_RADIUS = 500;

export default function useMonitoringSettings({
  columns,
  storageKey = DEFAULT_STORAGE_KEY,
  remotePreferences = null,
  loadingPreferences = false,
  savePreferences = null,
  defaultColumnKeys = null,
}) {
  const defaults = useMemo(() => {
    const base = buildColumnDefaults(columns);
    if (Array.isArray(defaultColumnKeys) && defaultColumnKeys.length) {
      const orderFromDefaults = defaultColumnKeys.filter((key) => base.order.includes(key));
      const missing = base.order.filter((key) => !orderFromDefaults.includes(key));
      const visible = Object.fromEntries(
        base.order.map((key) => [key, orderFromDefaults.includes(key)]),
      );

      return {
        ...base,
        visible,
        order: [...orderFromDefaults, ...missing],
      };
    }
    return base;
  }, [columns, defaultColumnKeys]);

  // memo estável
  const mergePrefs = useCallback(
    (saved) => mergeColumnPreferences(defaults, saved),
    [defaults]
  );

  const [columnPrefs, setColumnPrefs] = useState(defaults);
  const [panelRatio, setPanelRatio] = useState(0.55);
  const [mapHeightPercent, setMapHeightPercent] = useState(null);
  const [searchRadius, setSearchRadius] = useState(DEFAULT_RADIUS);

  // --- CARREGAMENTO INICIAL SEGURO (sem loops) ---
  useEffect(() => {
    if (!columns?.length) return;

    const localPrefs = loadColumnPreferences(storageKey, defaults);

    const baseRemote =
      remotePreferences?.monitoringTableColumns && !loadingPreferences
        ? remotePreferences.monitoringTableColumns
        : null;

    const merged = mergePrefs(baseRemote || localPrefs);

    // evita loop: só atualiza se mudou
    setColumnPrefs((prev) =>
      JSON.stringify(prev) !== JSON.stringify(merged) ? merged : prev
    );

    // painéis
    const remoteRatio =
      !loadingPreferences &&
      Number(remotePreferences?.monitoringPanelRatio);

    if (Number.isFinite(remoteRatio) && remoteRatio > 0 && remoteRatio < 1) {
      setPanelRatio((prev) => (prev !== remoteRatio ? remoteRatio : prev));
    } else {
      const storedRatio = Number(localStorage.getItem(PANEL_STORAGE_KEY));
      if (Number.isFinite(storedRatio) && storedRatio > 0 && storedRatio < 1) {
        setPanelRatio((prev) => (prev !== storedRatio ? storedRatio : prev));
      }
    }

    const storedMapHeight = Number(localStorage.getItem(MAP_HEIGHT_KEY));
    const remoteMapHeight = Number(remotePreferences?.monitoringMapHeight);
    if (Number.isFinite(remoteMapHeight) && remoteMapHeight > 10 && remoteMapHeight < 90) {
      setMapHeightPercent((prev) => (prev !== remoteMapHeight ? remoteMapHeight : prev));
    } else if (Number.isFinite(storedMapHeight) && storedMapHeight > 10 && storedMapHeight < 90) {
      setMapHeightPercent((prev) => (prev !== storedMapHeight ? storedMapHeight : prev));
    }

    const remoteRadius = Number(remotePreferences?.monitoringSearchRadius);
    const storedRadius = Number(localStorage.getItem(SEARCH_RADIUS_KEY));
    const resolvedRadius = Number.isFinite(remoteRadius) ? remoteRadius : storedRadius;
    if (Number.isFinite(resolvedRadius) && resolvedRadius >= 50 && resolvedRadius <= 5000) {
      setSearchRadius((prev) => (prev !== resolvedRadius ? resolvedRadius : prev));
    }
  }, [
    columns?.length,
    defaults,
    loadingPreferences,
    mergePrefs,
    remotePreferences,
    storageKey,
  ]);

  // --- PERSISTÊNCIA ---
  const persistColumns = useCallback(
    (nextPrefs) => {
      saveColumnPreferences(storageKey, nextPrefs);

      if (typeof savePreferences === "function" && !loadingPreferences) {
        savePreferences({
          monitoringTableColumns: {
            visible: nextPrefs.visible,
            order: nextPrefs.order,
            widths: nextPrefs.widths,
          },
          monitoringColumnWidths: nextPrefs.widths,
        }).catch((error) => {
          console.warn("Falha ao salvar preferências de colunas", error);
        });
      }
    },
    [loadingPreferences, savePreferences, storageKey]
  );

  const toggleColumn = useCallback(
    (key) => {
      setColumnPrefs((current) => {
        const isVisible = current.visible?.[key] !== false;
        const next = {
          ...current,
          visible: { ...current.visible, [key]: !isVisible },
        };
        persistColumns(next);
        return next;
      });
    },
    [persistColumns]
  );

  const restoreColumns = useCallback(() => {
    setColumnPrefs(defaults);
    persistColumns(defaults);
  }, [defaults, persistColumns]);

  const moveColumn = useCallback(
    (fromKey, toKey) => {
      setColumnPrefs((current) => {
        const next = reorderColumns(current, fromKey, toKey, defaults);
        if (!next || next === current) return current;
        persistColumns(next);
        return next;
      });
    },
    [defaults, persistColumns]
  );

  const visibleColumns = useMemo(
    () => resolveVisibleColumns(columns, columnPrefs),
    [columnPrefs, columns]
  );

  const updateColumnWidth = useCallback(
    (key, width) => {
      if (!key || !Number.isFinite(width)) return;
      setColumnPrefs((current) => {
        const currentWidth = current.widths?.[key];
        if (currentWidth === width) return current;
        const next = {
          ...current,
          widths: { ...current.widths, [key]: width },
        };
        persistColumns(next);
        return next;
      });
    },
    [persistColumns],
  );

  const updatePanelRatio = useCallback(
    (ratio) => {
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return;

      setPanelRatio((prev) => (prev !== ratio ? ratio : prev));
      localStorage.setItem(PANEL_STORAGE_KEY, ratio);

      if (typeof savePreferences === "function" && !loadingPreferences) {
        savePreferences({ monitoringPanelRatio: ratio }).catch((error) => {
          console.warn("Falha ao salvar altura do painel", error);
        });
      }
    },
    [loadingPreferences, savePreferences]
  );

  const updateMapHeight = useCallback(
    (heightPercent) => {
      if (!Number.isFinite(heightPercent) || heightPercent <= 0 || heightPercent >= 100) return;
      setMapHeightPercent((prev) => (prev !== heightPercent ? heightPercent : prev));
      try {
        localStorage.setItem(MAP_HEIGHT_KEY, String(heightPercent));
      } catch (_error) {
        // ignore local persistence failures
      }

      if (typeof savePreferences === "function" && !loadingPreferences) {
        savePreferences({ monitoringMapHeight: heightPercent }).catch((error) => {
          console.warn("Falha ao salvar altura do mapa", error);
        });
      }
    },
    [loadingPreferences, savePreferences],
  );

  const applyColumns = useCallback(
    (nextPrefs) => {
      if (!nextPrefs) return;
      const merged = mergePrefs(nextPrefs);
      setColumnPrefs(merged);
      persistColumns(merged);
    },
    [mergePrefs, persistColumns],
  );

  return {
    columnDefaults: defaults,
    columnPrefs,
    visibleColumns,
    moveColumn,
    toggleColumn,
    restoreColumns,
    panelRatio,
    updatePanelRatio,
    updateColumnWidth,
    mapHeightPercent,
    updateMapHeight,
    applyColumns,
    searchRadius,
    updateSearchRadius: useCallback(
      (radius) => {
        if (!Number.isFinite(radius)) return;
        const clamped = Math.min(5000, Math.max(50, radius));
        setSearchRadius((prev) => (prev !== clamped ? clamped : prev));
        try {
          localStorage.setItem(SEARCH_RADIUS_KEY, String(clamped));
        } catch (_err) {
          // ignore
        }

        if (typeof savePreferences === "function" && !loadingPreferences) {
          savePreferences({ monitoringSearchRadius: clamped }).catch((error) => {
            console.warn("Falha ao salvar raio de busca", error);
          });
        }
      },
      [loadingPreferences, savePreferences],
    ),
  };
}
