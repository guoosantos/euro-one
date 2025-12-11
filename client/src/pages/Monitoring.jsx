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

  // Controle de Popups
  const [activePopup, setActivePopup] = useState(null); // 'columns' | 'layout' | null

  const [layoutVisibility, setLayoutVisibility] = useState({
    showMap: true,
    showTable: true,
  });

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
      className="flex flex-col relative bg-[#0b0f17] overflow-hidden -m-8 w-[calc(100%+4rem)]"
      style={{ height: 'calc(100vh - 64px)' }} 
    >
      
      {/* --- ÁREA DO MAPA (Topo) --- */}
      {layoutVisibility.showMap && (
        <div 
          className="relative w-full z-0 transition-all duration-300" 
          style={{ height: layoutVisibility.showTable ? '60%' : '100%' }}
        >
          {/* Mapa Base */}
          <MonitoringMap
            markers={markers}
            geofences={geofences}
            focusMarkerId={selectedDeviceId}
            mapViewport={mapViewport}
            onViewportChange={setMapViewport}
          />

          {/* TOOLBAR FLUTUANTE (Overlay) */}
          <div className="absolute top-4 left-4 right-4 z-[400] pointer-events-none">
            {/* O container interno precisa ter pointer-events-auto para ser clicável */}
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

      {/* --- ÁREA DA TABELA (Base) --- */}
      {layoutVisibility.showTable && (
        <div className="flex-1 w-full relative z-10 bg-[#0b0f17] border-t border-white/10">
          <MonitoringTable
            rows={rows}
            columns={visibleColumns}
            selectedDeviceId={selectedDeviceId}
            onSelect={setSelectedDeviceId}
            loading={loading}
            emptyText={t("monitoring.emptyState")}
          />
        </div>
      )}
    </div>
  );
}
