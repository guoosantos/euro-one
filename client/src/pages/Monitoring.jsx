import React, { useMemo, useState, useEffect } from "react";
import { useTranslation } from "../lib/i18n";
import { useNavigate } from "react-router-dom";

// Components
import MonitoringMap from "../components/map/MonitoringMap";
import MonitoringTable from "../components/monitoring/MonitoringTable";
import MonitoringToolbar from "../components/monitoring/MonitoringToolbar";
import MonitoringColumnSelector from "../components/monitoring/MonitoringColumnSelector";
import MonitoringLayoutSelector from "../components/monitoring/MonitoringLayoutSelector";

// Hooks
import useMonitoringSettings from "../lib/hooks/useMonitoringSettings";
import useGeofences from "../lib/hooks/useGeofences";
import useUserPreferences from "../lib/hooks/useUserPreferences";
import useTelemetry from "../lib/hooks/useTelemetry";

// Helpers & Constants
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
} from "../lib/monitoring-helpers";
import { TELEMETRY_COLUMNS } from "../features/telemetry/telemetryColumns";

const COLUMN_STORAGE_KEY = "monitoring.table.columns";
const DEFAULT_MAP_ZOOM = 12;

function getStatusBadge(position, t) {
  const status = deriveStatus(position);
  switch (status) {
    case "online": return { label: t("monitoring.status.online"), status, className: "text-emerald-400" };
    case "alert": return { label: t("monitoring.status.alert"), status, className: "text-amber-400" };
    case "blocked": return { label: t("monitoring.status.blocked"), status, className: "text-purple-400" };
    default: return { label: t("monitoring.status.offline"), status, className: "text-gray-400" };
  }
}

export default function Monitoring() {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const { telemetry, loading } = useTelemetry();
  const { geofences } = useGeofences({ autoRefreshMs: 60000 });
  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();

  // Local State
  const [filterMode, setFilterMode] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  
  // Popups State
  const [activePopup, setActivePopup] = useState(null);

  const [layoutVisibility, setLayoutVisibility] = useState({
    showMap: true,
    showTable: true,
  });

  // --- Sync Preferences ---
  useEffect(() => {
    if (!preferences) return;
    if (preferences.monitoringDefaultFilters?.mode) setFilterMode(preferences.monitoringDefaultFilters.mode);
    if (preferences.monitoringMapViewport?.center?.length === 2) {
      setMapViewport({
        center: preferences.monitoringMapViewport.center,
        zoom: preferences.monitoringMapViewport.zoom ?? DEFAULT_MAP_ZOOM,
      });
    }
    if (preferences.monitoringLayoutVisibility) {
      setLayoutVisibility((prev) => ({ ...prev, ...preferences.monitoringLayoutVisibility }));
    }
  }, [preferences]);

  // --- Data Processing ---
  const safeTelemetry = useMemo(() => (Array.isArray(telemetry) ? telemetry : []), [telemetry]);

  const searchFilteredDevices = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = safeTelemetry.map((item) => item.device || item);
    if (!term) return list;
    return list.filter((d) => {
      const name = (d.name ?? d.alias ?? "").toLowerCase();
      const plate = (d.plate ?? d.registrationNumber ?? "").toLowerCase();
      return name.includes(term) || plate.includes(term);
    });
  }, [query, safeTelemetry]);

  const rows = useMemo(() => {
    return searchFilteredDevices.map((device) => {
      const key = getDeviceKey(device);
      const telemetryItem = safeTelemetry.find((x) => getDeviceKey(x.device || x) === key);
      const position = telemetryItem?.position;
      const lat = pickCoordinate([position?.lat, position?.latitude]);
      const lng = pickCoordinate([position?.lng, position?.longitude]);

      return {
        key,
        device,
        deviceId: key,
        position,
        lat,
        lng,
        deviceName: device.name || device.alias || "—",
        plate: device.plate || device.registrationNumber || "—",
        address: typeof position?.address === 'string' 
          ? position.address 
          : position?.address?.formattedAddress || "Endereço não disponível",
        statusBadge: getStatusBadge(position, t),
        lastUpdate: getLastUpdate(position),
        speed: pickSpeed(position),
        onFocus: setSelectedDeviceId,
        onReplay: (id) => {
           const to = new Date().toISOString();
           const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
           navigate(`/trips?deviceId=${id}&from=${from}&to=${to}`);
        },
      };
    });
  }, [searchFilteredDevices, safeTelemetry, t, navigate]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const pos = row.position;
      const online = isOnline(pos);
      const lastUpdate = getLastUpdate(pos);
      const offlineFor = minutesSince(lastUpdate);

      switch (filterMode) {
        case "online": return online;
        case "offline": return !online && offlineFor > 5;
        case "ignition": return getIgnition(pos, row.device) === true;
        default: return true;
      }
    });
  }, [rows, filterMode]);

  // --- Summary ---
  const summary = useMemo(() => {
    const online = rows.filter((r) => isOnline(r.position)).length;
    const moving = rows.filter((r) => r.speed > 0).length;
    return { online, offline: rows.length - online, moving, total: rows.length };
  }, [rows]);

  // --- Markers ---
  const markers = useMemo(() => {
    return filteredRows
      .map((row) => {
        if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
        return {
          id: row.deviceId,
          lat: row.lat,
          lng: row.lng,
          color: row.statusBadge?.status === "online" ? "#34d399" : "#f87171",
          label: row.deviceName,
          plate: row.plate,
          address: row.address,
          speedLabel: `${row.speed} km/h`,
          statusLabel: row.statusBadge?.label,
          lastUpdateLabel: formatDateTime(row.lastUpdate, locale),
        };
      })
      .filter(Boolean);
  }, [filteredRows, locale]);

  // --- Columns ---
  const telemetryColumns = useMemo(() => 
    TELEMETRY_COLUMNS.map((col) => ({
      ...col,
      label: t(col.labelKey),
      render: (row) => col.getValue(row, { t, locale }),
    })), [t, locale]);

  const actionsColumn = useMemo(() => ({
    key: "actions",
    label: t("monitoring.columns.actions"),
    defaultVisible: true,
    fixed: true,
    render: (row) => (
      <div className="flex gap-2">
        <button className="text-primary hover:text-primary-light text-xs font-bold uppercase tracking-wide" onClick={() => row.onFocus?.(row.deviceId)}>
          Mapa
        </button>
      </div>
    ),
  }), [t]);

  const allColumns = useMemo(() => [...telemetryColumns, actionsColumn], [telemetryColumns, actionsColumn]);
  
  const { visibleColumns, columnPrefs, toggleColumn, restoreColumns, moveColumn } =
    useMonitoringSettings({
      columns: allColumns,
      remotePreferences: preferences,
      loadingPreferences,
      storageKey: COLUMN_STORAGE_KEY,
      savePreferences,
    });

  return (
    // =========================================================================================
    // CSS "BREAKOUT" HACK
    // -m-6: Margem negativa para anular o padding de 1.5rem (24px) do componente pai.
    // w-[calc(100%+3rem)]: Aumenta a largura para compensar a margem negativa.
    // h-[calc(100vh-64px)]: Força a altura a ser o Viewport Height total MENOS o header (aprox 64px).
    // =========================================================================================
    <div 
      className="flex flex-col bg-[#0b0f17] relative -m-6 w-[calc(100%+3rem)]"
      style={{ height: 'calc(100vh - 64px)' }} 
    >
      
      {/* 1. MAP AREA */}
      {layoutVisibility.showMap && (
        <div 
            className="flex-none w-full border-b border-white/5 relative z-0 transition-all" 
            style={{ 
              height: layoutVisibility.showTable ? '55%' : '100%' // Usando % relativo ao pai que agora tem altura definida
            }}
        >
          <MonitoringMap
            markers={markers}
            geofences={geofences}
            focusMarkerId={selectedDeviceId}
            mapViewport={mapViewport}
            onViewportChange={setMapViewport}
          />
        </div>
      )}

      {/* 2. TOOLBAR */}
      <div className="flex-none z-20 bg-[#0b0f17] shadow-lg border-b border-white/5">
        <MonitoringToolbar
          query={query}
          onQueryChange={setQuery}
          filterMode={filterMode}
          onFilterChange={setFilterMode}
          summary={summary}
          activePopup={activePopup}
          onTogglePopup={(name) => setActivePopup(activePopup === name ? null : name)}
        />
        
        {/* Popups */}
        {activePopup === 'columns' && (
           <div className="absolute right-4 top-14 z-[9999]">
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
           <div className="absolute right-4 top-14 z-[9999]">
             <MonitoringLayoutSelector
               layoutVisibility={layoutVisibility}
               onToggle={(key) => setLayoutVisibility(p => ({...p, [key]: !p[key]}))}
               onClose={() => setActivePopup(null)}
             />
           </div>
        )}
      </div>

      {/* 3. TABLE AREA */}
      {layoutVisibility.showTable && (
        <div className="flex-1 min-h-0 w-full relative z-10 bg-[#0b0f17]">
          <div className="h-full w-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
            <MonitoringTable
              rows={filteredRows}
              columns={visibleColumns}
              loading={loading}
              selectedDeviceId={selectedDeviceId}
              onSelect={setSelectedDeviceId}
              emptyText={t("monitoring.emptyState")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
