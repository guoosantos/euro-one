import React, { useMemo, useState, useEffect } from "react";
import { useTranslation } from "../lib/i18n.js";

import MonitoringMap from "../components/map/MonitoringMap.jsx";
import MonitoringTable from "../components/monitoring/MonitoringTable.jsx";
import MonitoringToolbar from "../components/monitoring/MonitoringToolbar.jsx";
import MonitoringColumnSelector from "../components/monitoring/MonitoringColumnSelector.jsx";
import MonitoringLayoutSelector from "../components/monitoring/MonitoringLayoutSelector.jsx";

import useMonitoringSettings from "../lib/hooks/useMonitoringSettings.js";
import useGeofences from "../lib/hooks/useGeofences.js";
import useUserPreferences from "../lib/hooks/useUserPreferences.js";
import useTelemetry from "../lib/hooks/useTelemetry.js";

import {
  deriveStatus,
  formatDateTime,
  getDeviceKey,
  getIgnition,
  getLastUpdate,
  isOnline,
  pickCoordinate,
  pickSpeed,
} from "../lib/monitoring-helpers.js";

import { TELEMETRY_COLUMNS } from "../features/telemetry/telemetryColumns.js";

const MAP_HEIGHT_STORAGE_KEY = "monitoring:mapHeightPercent";
const DEFAULT_MAP_HEIGHT = 65;
const MIN_MAP_HEIGHT = 10;
const MAX_MAP_HEIGHT = 100;

const COLUMN_WIDTH_HINTS = {
  vehicle: 180,
  plate: 110,
  deviceId: 120,
  protocol: 120,
  serverTime: 150,
  deviceTime: 150,
  gpsTime: 150,
  lastEvent: 140,
  valid: 90,
  latitude: 120,
  longitude: 120,
  speed: 90,
  address: 260,
  status: 120,
  ignition: 110,
  actions: 90,
};

function getStoredMapHeight() {
  if (typeof window === "undefined") return DEFAULT_MAP_HEIGHT;

  try {
    const storedValue = window.localStorage?.getItem(MAP_HEIGHT_STORAGE_KEY);
    const parsed = Number(storedValue);
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_MAP_HEIGHT, Math.max(MIN_MAP_HEIGHT, parsed));
    }
  } catch (_error) {
    // Se o localStorage não estiver disponível, apenas retorna o padrão.
  }

  return DEFAULT_MAP_HEIGHT;
}

function persistMapHeight(value) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage?.setItem(MAP_HEIGHT_STORAGE_KEY, String(value));
  } catch (_error) {
    // Persistência local não é essencial; ignore falhas silenciosamente.
  }
}

export default function Monitoring() {
  const { t, locale } = useTranslation();

  const { telemetry, loading } = useTelemetry();
  const safeTelemetry = useMemo(() => (Array.isArray(telemetry) ? telemetry : []), [telemetry]);

  const { geofences } = useGeofences({ autoRefreshMs: 60_000 });
  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();

  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);

  // Controle visual entre mapa e grade
  const [mapHeightPercent, setMapHeightPercent] = useState(getStoredMapHeight());

  // Controle de Popups
  const [activePopup, setActivePopup] = useState(null); // 'columns' | 'layout' | null

  const [layoutVisibility, setLayoutVisibility] = useState({
    showMap: true,
    showTable: true,
  });

  useEffect(() => {
    persistMapHeight(mapHeightPercent);
  }, [mapHeightPercent]);

  const clampMapHeight = value => Math.min(
    MAX_MAP_HEIGHT,
    Math.max(MIN_MAP_HEIGHT, Number.isFinite(Number(value)) ? Number(value) : DEFAULT_MAP_HEIGHT),
  );
  const tableHeightPercent = useMemo(
    () => (layoutVisibility.showMap ? Math.max(10, 100 - mapHeightPercent) : 100),
    [layoutVisibility.showMap, mapHeightPercent],
  );
  const handleMapHeightChange = value => setMapHeightPercent(clampMapHeight(value));
  const toggleTableEmphasis = () => setMapHeightPercent(prev => clampMapHeight(prev >= 60 ? 35 : 75));

  // --- Lógica de Dados ---
  const normalizedTelemetry = useMemo(() => safeTelemetry.map(item => ({
    device: item.device || item,
    source: item,
  })), [safeTelemetry]);

  const searchFiltered = useMemo(() => {
    const term = query.toLowerCase().trim();
    if (!term) return normalizedTelemetry;

    return normalizedTelemetry.filter(({ device }) => {
      const name = (device.name ?? device.alias ?? "").toLowerCase();
      const plate = (device.plate ?? device.registrationNumber ?? "").toLowerCase();
      return name.includes(term) || plate.includes(term);
    });
  }, [query, normalizedTelemetry]);

  const filteredDevices = useMemo(() => {
    return searchFiltered.filter(({ source, device }) => {
      if (filterMode === "online") return isOnline(source?.position);
      if (filterMode === "offline") return !isOnline(source?.position);
      if (filterMode === "ignition") return getIgnition(source?.position, device) === true;
      return true;
    });
  }, [searchFiltered, filterMode]);

  const resolveAddress = (position, lat, lng) => {
    const rawAddress = position?.address || position?.attributes?.formattedAddress;
    if (typeof rawAddress === "string" && rawAddress.trim()) return rawAddress.trim();
    if (typeof position?.address === "object") {
      if (typeof position.address.formattedAddress === "string" && position.address.formattedAddress.trim()) {
        return position.address.formattedAddress.trim();
      }
      if (typeof position.address.address === "string" && position.address.address.trim()) {
        return position.address.address.trim();
      }
    }

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }

    return "Endereço não disponível";
  };

  const rows = useMemo(() => {
    return filteredDevices.map(({ device, source }) => {
      const key = getDeviceKey(device);
      const pos = source?.position;
      const lat = pickCoordinate([pos?.lat, pos?.latitude]);
      const lng = pickCoordinate([pos?.lng, pos?.longitude]);

      return {
        key,
        device,
        deviceId: key,
        position: pos,
        lat,
        lng,
        deviceName: device.name ?? "—",
        plate: device.plate ?? "—",
        address: resolveAddress(pos, lat, lng),
        speed: pickSpeed(pos),
        lastUpdate: getLastUpdate(pos),
        statusBadge: deriveStatus(pos),
        onFocus: setSelectedDeviceId,
      };
    });
  }, [filteredDevices]);

  const markers = useMemo(() => {
    return rows
      .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
      .map(r => ({
        id: r.deviceId,
        lat: r.lat,
        lng: r.lng,
        label: r.deviceName,
        plate: r.plate,
        address: r.address,
        speedLabel: `${r.speed ?? 0} km/h`,
        lastUpdateLabel: formatDateTime(r.lastUpdate, locale),
        color: r.statusBadge === "online" ? "#22c55e" : "#f87171",
      }));
  }, [rows, locale]);

  const summary = useMemo(() => {
    const online = rows.filter(r => isOnline(r.position)).length;
    const moving = rows.filter(r => (r.speed ?? 0) > 0).length;
    return { online, offline: rows.length - online, moving, total: rows.length };
  }, [rows]);

  // --- Configuração de Colunas ---
  const telemetryColumns = useMemo(() =>
    TELEMETRY_COLUMNS.map(col => ({
      ...col,
      width: COLUMN_WIDTH_HINTS[col.key] ?? col.width,
      label: t(col.labelKey),
      render: row => col.getValue(row, { t, locale }),
    })), [t, locale]);

  const actionsColumn = useMemo(() => ({
    key: "actions",
    label: t("monitoring.columns.actions"),
    defaultVisible: true,
    fixed: true,
    width: COLUMN_WIDTH_HINTS.actions,
    render: row => (
      <button
        className="text-primary hover:text-primary-light text-xs font-bold uppercase tracking-wide"
        onClick={() => row.onFocus?.(row.deviceId)}
      >
        Mapa
      </button>
    ),
  }), [t]);

  const allColumns = useMemo(() => [...telemetryColumns, actionsColumn], [telemetryColumns, actionsColumn]);

  const { visibleColumns, columnPrefs, toggleColumn, restoreColumns, moveColumn } =
    useMonitoringSettings({
      columns: allColumns,
      remotePreferences: preferences,
      loadingPreferences,
      storageKey: "monitoring.table.columns",
      savePreferences,
    });

  const gridTemplateRows = useMemo(() => {
    if (layoutVisibility.showMap && layoutVisibility.showTable) {
      return `${mapHeightPercent}fr auto ${tableHeightPercent}fr`;
    }
    if (layoutVisibility.showMap) return "1fr";
    if (layoutVisibility.showTable) return "auto 1fr";
    return "1fr";
  }, [layoutVisibility.showMap, layoutVisibility.showTable, mapHeightPercent, tableHeightPercent]);

  return (
    <div
      className="relative grid w-full bg-[#0b0f17]"
      style={{ minHeight: "calc(100vh - 64px)", gridTemplateRows }}
    >
      {layoutVisibility.showMap && (
        <div className="relative border-b border-white/10">
          <MonitoringMap
            markers={markers}
            geofences={geofences}
            focusMarkerId={selectedDeviceId}
            mapViewport={mapViewport}
            onViewportChange={setMapViewport}
          />
        </div>
      )}

      {layoutVisibility.showTable && (
        <div className="relative z-20 border-b border-white/10 bg-[#0f141c] px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <MonitoringToolbar
              query={query}
              onQueryChange={setQuery}
              filterMode={filterMode}
              onFilterChange={setFilterMode}
              summary={summary}
              activePopup={activePopup}
              onTogglePopup={(name) => setActivePopup(activePopup === name ? null : name)}
            />

            {layoutVisibility.showMap && (
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/70">
                <button
                  type="button"
                  onClick={toggleTableEmphasis}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/80 transition hover:border-primary/70 hover:text-white"
                  title="Alternar foco entre mapa e tabela"
                  aria-label="Alternar foco entre mapa e tabela"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M16 15l-4 4-4-4" />
                  </svg>
                </button>

                <div className="flex items-center gap-2">
                  <span className="hidden xl:inline">Altura do mapa</span>
                  <input
                    type="range"
                    min={MIN_MAP_HEIGHT}
                    max={MAX_MAP_HEIGHT}
                    step="1"
                    value={mapHeightPercent}
                    onChange={(e) => handleMapHeightChange(e.target.value)}
                    className="h-2 w-28 md:w-36 accent-primary bg-white/10 rounded-full overflow-hidden cursor-pointer"
                  />
                  <input
                    type="number"
                    min={MIN_MAP_HEIGHT}
                    max={MAX_MAP_HEIGHT}
                    value={mapHeightPercent}
                    onChange={(e) => handleMapHeightChange(e.target.value)}
                    className="hidden lg:block w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/90 outline-none transition focus:border-primary"
                  />
                  <span className="font-semibold text-white/90 min-w-[3ch] text-right">{mapHeightPercent}%</span>
                </div>
              </div>
            )}
          </div>

          {activePopup === "layout" && (
            <div className="absolute right-4 top-full mt-2 z-30">
              <MonitoringLayoutSelector
                layoutVisibility={layoutVisibility}
                onToggle={key => setLayoutVisibility(prev => ({ ...prev, [key]: !prev[key] }))}
                onClose={() => setActivePopup(null)}
              />
            </div>
          )}
        </div>
      )}

      {layoutVisibility.showTable && (
        <div className="relative z-10 overflow-hidden">
          <div className="h-full overflow-hidden">
            <MonitoringTable
              rows={rows}
              columns={visibleColumns}
              selectedDeviceId={selectedDeviceId}
              onSelect={setSelectedDeviceId}
              loading={loading}
              emptyText={t("monitoring.emptyState")}
            />
          </div>
        </div>
      )}

      {activePopup === "columns" && (
        <MonitoringColumnSelector
          columns={allColumns}
          visibleState={columnPrefs.visible}
          onToggle={toggleColumn}
          onReorder={moveColumn}
          onRestore={restoreColumns}
          onClose={() => setActivePopup(null)}
        />
      )}
    </div>
  );
}
