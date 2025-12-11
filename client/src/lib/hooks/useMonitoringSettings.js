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

export default function useMonitoringSettings({
  columns,
  storageKey = DEFAULT_STORAGE_KEY,
  remotePreferences = null,
  loadingPreferences = false,
  savePreferences = null,
}) {
  const defaults = useMemo(() => buildColumnDefaults(columns), [columns]);

  // memo estável
  const mergePrefs = useCallback(
    (saved) => mergeColumnPreferences(defaults, saved),
    [defaults]
  );

  const [columnPrefs, setColumnPrefs] = useState(defaults);
  const [panelRatio, setPanelRatio] = useState(0.55);

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
          },
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

  return {
    columnPrefs,
    visibleColumns,
    moveColumn,
    toggleColumn,
    restoreColumns,
    panelRatio,
    updatePanelRatio,
  };
}
