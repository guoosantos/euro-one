import React, { useMemo, useState, useEffect } from "react";
import { useTranslation } from "../lib/i18n.js";
import { useNavigate } from "react-router-dom";

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
  minutesSince,
  pickCoordinate,
  pickSpeed,
} from "../lib/monitoring-helpers.js";

import { TELEMETRY_COLUMNS } from "../features/telemetry/telemetryColumns.js";

const MAP_HEIGHT_STORAGE_KEY = "monitoring:mapHeightPercent";
const DEFAULT_MAP_HEIGHT = 65;
const MIN_MAP_HEIGHT = 10;
const MAX_MAP_HEIGHT = 100;

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
  const navigate = useNavigate();

  const { telemetry, loading } = useTelemetry();
  const safeTelemetry = useMemo(() => Array.isArray(telemetry) ? telemetry : [], [telemetry]);

  const { geofences } = useGeofences({ autoRefreshMs: 60_000 });
  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();

  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);

  // Controle visual entre mapa e grade
  const [mapHeightPercent, setMapHeightPercent] = useState(getStoredMapHeight()); // Mapa ocupa 65% por padrão

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
  const searchFiltered = useMemo(() => {
    const term = query.toLowerCase().trim();
    const list = safeTelemetry.map(item => item.device || item);
    if (!term) return list;
    return list.filter(device => {
      const name = (device.name ?? device.alias ?? "").toLowerCase();
      const plate = (device.plate ?? device.registrationNumber ?? "").toLowerCase();
      return name.includes(term) || plate.includes(term);
    });
  }, [query, safeTelemetry]);

  const rows = useMemo(() => {
    return searchFiltered.map(device => {
      const key = getDeviceKey(device);
      const item = safeTelemetry.find(x => getDeviceKey(x.device || x) === key);
      const pos = item?.position;

      return {
        key,
        device,
        deviceId: key,
        position: pos,
        lat: pickCoordinate([pos?.lat, pos?.latitude]),
        lng: pickCoordinate([pos?.lng, pos?.longitude]),
        deviceName: device.name ?? "—",
        plate: device.plate ?? "—",
        address: typeof pos?.address === "string" ? pos.address : pos?.address?.formattedAddress || "Endereço não disponível",
        speed: pickSpeed(pos),
        lastUpdate: getLastUpdate(pos),
        statusBadge: deriveStatus(pos),
        onFocus: setSelectedDeviceId,
      };
    });
  }, [searchFiltered, safeTelemetry]);

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
      label: t(col.labelKey),
      render: row => col.getValue(row, { t, locale }),
    })), [t, locale]);

  const actionsColumn = useMemo(() => ({
    key: "actions",
    label: t("monitoring.columns.actions"),
    defaultVisible: true,
    fixed: true,
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

  return (
    // CSS HACK: Margens negativas (-m-8) para anular o padding do layout pai.
    // Ajuste o -m-8 para -m-6 se ainda sobrar borda branca.
    <div
      className="relative bg-[#0b0f17] overflow-hidden -m-8 w-[calc(100%+4rem)]"
      style={{ height: 'calc(100vh - 64px)' }}
    >

      {/* --- ÁREA DO MAPA (fundo) --- */}
      {layoutVisibility.showMap && (
        <div className="absolute inset-0 z-0">
          <MonitoringMap
            markers={markers}
            geofences={geofences}
            focusMarkerId={selectedDeviceId}
            mapViewport={mapViewport}
            onViewportChange={setMapViewport}
          />

          {/* TOOLBAR FLUTUANTE (Overlay) */}
          <div className="absolute top-4 left-4 right-4 z-[400] pointer-events-none">
            <div className="pointer-events-auto inline-block w-full">
              <MonitoringToolbar
                query={query}
                onQueryChange={setQuery}
                filterMode={filterMode}
                onFilterChange={setFilterMode}
                summary={summary}
                activePopup={activePopup}
                onTogglePopup={(name) => setActivePopup(activePopup === name ? null : name)}
              />
            </div>

            {/* Popups Flutuantes */}
            {activePopup === 'columns' && (
              <div className="absolute right-0 top-14 pointer-events-auto">
                <MonitoringColumnSelector
                  columns={allColumns}
                  visibleState={columnPrefs.visible}
                  onToggle={toggleColumn}
                  onReorder={moveColumn}
                  onRestore={restoreColumns}
                  onClose={() => setActivePopup(null)}
                />
              </div>
            )}
            {activePopup === 'layout' && (
              <div className="absolute right-0 top-14 pointer-events-auto">
                <MonitoringLayoutSelector
                  layoutVisibility={layoutVisibility}
                  onToggle={key => setLayoutVisibility(prev => ({ ...prev, [key]: !prev[key] }))}
                  onClose={() => setActivePopup(null)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- ÁREA DA TABELA FLUTUANTE --- */}
      {layoutVisibility.showTable && (
        <div
          className={`${layoutVisibility.showMap ? "absolute left-4 right-4" : "relative w-full px-4"} z-30 transition-all duration-300`}
          style={layoutVisibility.showMap
            ? { bottom: '1rem', height: `${tableHeightPercent}%` }
            : { height: '100%', paddingTop: '1rem', paddingBottom: '1rem' }
          }
        >
          <div className="relative h-full rounded-2xl bg-[#0b0f17]/95 border border-white/10 shadow-2xl backdrop-blur-xl overflow-hidden">
            {layoutVisibility.showMap && (
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/5">
                <span className="text-[11px] font-semibold text-white/60 uppercase tracking-[0.12em]">Lista de veículos</span>
                <div className="flex items-center gap-2 text-[11px] text-white/70">
                  <button
                    type="button"
                    onClick={toggleTableEmphasis}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/80 transition hover:border-primary/70 hover:text-white"
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

                  <div className="hidden sm:flex items-center gap-2">
                    <span className="hidden md:inline">Altura do mapa</span>
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
                  </div>

                  <span className="font-semibold text-white/90 min-w-[3ch] text-right">{mapHeightPercent}%</span>
                </div>
              </div>
            )}

            <div className="h-full overflow-auto">
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
        </div>
      )}
    </div>
  );
}
